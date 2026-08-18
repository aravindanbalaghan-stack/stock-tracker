import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { getSessionCookies, nseApiFetchWithCookies } from "@/lib/nseSession";
import { fetchDailyOHLCV, sma, ema, toWeeklyBars } from "@/lib/screenerIndicators";
import { getSectorsForSymbol } from "@/lib/sectorOverrides";
import {
  computeMetrics,
  ACCUMULATION_WINDOW,
  ACCUMULATION_DELIVERY_THRESHOLD,
  ACCUMULATION_MIN_DAYS,
} from "@/lib/deliveryMetrics";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const NSE_TIMEOUT_MS = 6000;
const MONTH_TRADING_DAYS = 22;
// Every row in the accumulation table shows volume against ITS OWN
// trailing 30-day average, so the oldest displayed day still needs 30
// sessions behind it: 22 + 30, plus slack for holidays. The per-date
// bhavcopy files are cached for a week, so the wider window is mostly a
// first-load cost.
const VOLUME_AVG_DAYS = 30;
const BHAV_WINDOW = MONTH_TRADING_DAYS + VOLUME_AVG_DAYS + 5;
// A day counts as a volume spike when it trades this many times its own
// trailing 30-day average.
const VOLUME_SPIKE_MULTIPLE = 2;

/**
 * Recent block deals for this symbol. NSE's block-deal endpoint only
 * carries the CURRENT session's deals — there's no public historical block
 * deal archive behind it — so an empty result means "none today", not
 * "none recently". The UI says so rather than implying a clean history.
 */
async function fetchBlockDeals(symbol, cookies) {
  const data = await nseApiFetchWithCookies("/api/block-deal", cookies, NSE_TIMEOUT_MS);
  const rows = data?.data;
  if (!Array.isArray(rows)) return null;
  const matches = rows
    .filter((r) => String(r?.symbol || "").toUpperCase() === symbol)
    .map((r) => ({
      client: r.clientName ?? null,
      type: r.buySell ?? null,
      quantity: Number(r.quantityTraded) || null,
      price: Number(r.tradePrice) || null,
    }));
  return { available: true, deals: matches, sessionOnly: true };
}

/**
 * Sector/industry label. NSE carries this on the plain quote-equity
 * payload; like everything else behind that endpoint it's session-gated
 * and often blocked, so it degrades to null rather than failing the page.
 */
async function fetchIndustry(symbol, cookies) {
  const data = await nseApiFetchWithCookies(
    `/api/quote-equity?symbol=${encodeURIComponent(symbol)}`,
    cookies,
    NSE_TIMEOUT_MS
  );
  return data?.info?.industry ?? data?.industryInfo?.industry ?? data?.metadata?.industry ?? null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();
  if (!symbol) return Response.json({ error: "A symbol is required" }, { status: 400 });

  try {
    const [days, hist, sectors] = await Promise.all([
      getRecentBhavcopies(BHAV_WINDOW, BHAV_WINDOW * 2 + 20).catch(() => []),
      fetchDailyOHLCV(symbol, "2y").catch(() => null),
      // Every sector this stock belongs to — a stock can genuinely sit in
      // several, so all of them are returned rather than just the first.
      getSectorsForSymbol(symbol).catch(() => []),
    ]);

    // ---- Price levels & indicators (Yahoo) ----------------------------
    let levels = null;
    if (hist?.bars?.length) {
      const bars = hist.bars;
      const closes = bars.map((b) => b.c);
      const last = bars[bars.length - 1];

      // 52 weeks of daily bars ~ 250 sessions.
      const yearBars = bars.slice(-250);
      const high52 = Math.max(...yearBars.map((b) => b.h));
      const low52 = Math.min(...yearBars.map((b) => b.l));

      const weekly = toWeeklyBars(bars);
      const completedWeeks = weekly.slice(0, -1); // drop the in-progress week
      const wma30 =
        completedWeeks.length >= 30
          ? completedWeeks.slice(-30).reduce((a, w) => a + w.c, 0) / 30
          : null;

      const ema21 = ema(closes, 21);
      const round = (n) => (n == null ? null : Math.round(n * 100) / 100);

      levels = {
        price: round(last.c),
        high52: round(high52),
        low52: round(low52),
        // Where it sits in its own 52-week range: 0% = at the low,
        // 100% = at the high.
        rangePositionPct:
          high52 > low52 ? Math.round(((last.c - low52) / (high52 - low52)) * 1000) / 10 : null,
        pctFromHigh52: round(((last.c - high52) / high52) * 100),
        pctFromLow52: round(((last.c - low52) / low52) * 100),
        ema21: round(ema21),
        wma30: round(wma30),
        aboveEma21: ema21 != null ? last.c > ema21 : null,
        aboveWma30: wma30 != null ? last.c > wma30 : null,
        sma50: round(sma(closes, 50)),
        sma200: round(sma(closes, 200)),
        aboveSma50: sma(closes, 50) != null ? last.c > sma(closes, 50) : null,
        aboveSma200: sma(closes, 200) != null ? last.c > sma(closes, 200) : null,
      };
    }

    // ---- One month of accumulation data (bhavcopy) --------------------
    let accumulation = null;
    if (days.length > 0) {
      const rows = [];
      const firstShown = Math.max(0, days.length - MONTH_TRADING_DAYS);
      for (let i = firstShown; i < days.length; i++) {
        const day = days[i];
        const r = day.bySymbol.get(symbol);
        if (!r) continue;

        // Trailing average of the 30 sessions BEFORE this one — each day is
        // measured against the norm as it stood at the time, not against a
        // single average taken from the end of the window.
        const priorVols = days
          .slice(Math.max(0, i - VOLUME_AVG_DAYS), i)
          .map((d) => d.bySymbol.get(symbol)?.volume)
          .filter((v) => v > 0);
        const avgVol = priorVols.length ? priorVols.reduce((a, b) => a + b, 0) / priorVols.length : null;

        rows.push({
          date: day.date,
          close: r.close,
          changePercent:
            r.prevClose && r.close ? Math.round(((r.close - r.prevClose) / r.prevClose) * 10000) / 100 : null,
          deliveryPct: r.deliveryPct,
          volume: r.volume,
          avgVolume: avgVol != null ? Math.round(avgVol) : null,
          // How many times its own recent norm the day traded. Null rather
          // than 0 when there isn't enough history to judge.
          volumeRatio: avgVol && avgVol > 0 ? Math.round((r.volume / avgVol) * 100) / 100 : null,
          // Days with too few prior sessions are flagged so the UI doesn't
          // present a thin average as if it were a full one.
          avgVolumeDays: priorVols.length,
        });
      }

      // Volume spikes over the same window, each measured against that
      // day's own trailing 30-day average rather than a single fixed one.
      const spikes = [];
      for (let i = days.length - MONTH_TRADING_DAYS; i < days.length; i++) {
        if (i < 1) continue;
        const day = days[i];
        const r = day.bySymbol.get(symbol);
        if (!r || !r.volume) continue;
        const priorVols = days
          .slice(Math.max(0, i - VOLUME_AVG_DAYS), i)
          .map((d) => d.bySymbol.get(symbol)?.volume)
          .filter((v) => v > 0);
        if (priorVols.length < 5) continue;
        const avg = priorVols.reduce((a, b) => a + b, 0) / priorVols.length;
        if (r.volume > avg * VOLUME_SPIKE_MULTIPLE) {
          spikes.push({
            date: day.date,
            volume: r.volume,
            ratio: Math.round((r.volume / avg) * 100) / 100,
            deliveryPct: r.deliveryPct,
            changePercent:
              r.prevClose && r.close
                ? Math.round(((r.close - r.prevClose) / r.prevClose) * 10000) / 100
                : null,
          });
        }
      }

      const metrics = computeMetrics(symbol, days);
      const withDelivery = rows.filter((r) => r.deliveryPct != null);
      accumulation = {
        rows,
        spikes,
        avgDeliveryPct: withDelivery.length
          ? Math.round((withDelivery.reduce((a, r) => a + r.deliveryPct, 0) / withDelivery.length) * 100) / 100
          : null,
        daysAboveThreshold: metrics?.daysOfAccumulation ?? null,
        accumulationWindow: ACCUMULATION_WINDOW,
        accumulationThreshold: ACCUMULATION_DELIVERY_THRESHOLD,
        accumulationMinDays: ACCUMULATION_MIN_DAYS,
        inAccumulation: metrics?.inAccumulation ?? null,
      };
    }

    // ---- NSE-gated extras --------------------------------------------
    let blockDeals = null;
    let industry = null;
    try {
      const cookies = await getSessionCookies();
      [blockDeals, industry] = await Promise.all([
        fetchBlockDeals(symbol, cookies).catch(() => null),
        fetchIndustry(symbol, cookies).catch(() => null),
      ]);
    } catch {
      // NSE unreachable — both stay null and the UI says so.
    }

    return Response.json({
      symbol,
      name: hist?.name ?? null,
      exchange: hist?.exchange ?? null,
      industry,
      sectors,
      volumeAvgDays: VOLUME_AVG_DAYS,
      levels,
      accumulation,
      blockDeals,
      asOf: days.length ? days[days.length - 1].date : null,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to build insight for this stock", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
