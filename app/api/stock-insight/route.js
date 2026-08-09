import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { getSessionCookies, nseApiFetchWithCookies } from "@/lib/nseSession";
import { fetchDailyOHLCV, sma, ema, toWeeklyBars } from "@/lib/screenerIndicators";
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
const BHAV_WINDOW = 31;
// A day counts as a volume spike when it trades this many times its own
// trailing 30-day average.
const VOLUME_SPIKE_MULTIPLE = 2;

/**
 * Shareholding pattern (promoter / FII / DII / public).
 *
 * This comes from NSE's corp-info endpoint, which is both session-gated
 * and frequently blocked from hosted servers. It is also QUARTERLY data —
 * companies file it after each quarter ends, so the newest figures can be
 * up to ~3 months old. There is no live shareholding feed; anything
 * claiming otherwise is showing stale data without saying so. Returns null
 * on any failure, and the UI states plainly when it's unavailable.
 */
async function fetchShareholding(symbol, cookies) {
  const data = await nseApiFetchWithCookies(
    `/api/quote-equity?symbol=${encodeURIComponent(symbol)}&section=corp_info`,
    cookies,
    NSE_TIMEOUT_MS
  );
  const rows = data?.corporate?.shareholdingPatterns?.data;
  if (!rows || typeof rows !== "object") return null;

  // The payload is keyed by period, each holding an array of
  // { category: value } pairs. Take the most recent period present.
  const periods = Object.keys(rows);
  if (periods.length === 0) return null;
  const latestPeriod = periods[0];
  const entries = rows[latestPeriod];
  if (!Array.isArray(entries)) return null;

  const pick = (needles) => {
    for (const entry of entries) {
      for (const [k, v] of Object.entries(entry)) {
        const key = k.toLowerCase();
        if (needles.some((n) => key.includes(n))) {
          const num = parseFloat(String(v).replace(/[^0-9.]/g, ""));
          if (Number.isFinite(num)) return num;
        }
      }
    }
    return null;
  };

  const promoter = pick(["promoter"]);
  const fii = pick(["foreign", "fii"]);
  const dii = pick(["domestic", "dii", "institution"]);
  const publicHolding = pick(["public"]);

  if (promoter == null && fii == null && dii == null && publicHolding == null) return null;
  return { period: latestPeriod, promoter, fii, dii, public: publicHolding };
}

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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();
  if (!symbol) return Response.json({ error: "A symbol is required" }, { status: 400 });

  try {
    const [days, hist] = await Promise.all([
      getRecentBhavcopies(BHAV_WINDOW, BHAV_WINDOW * 2 + 20).catch(() => []),
      fetchDailyOHLCV(symbol, "2y").catch(() => null),
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
      };
    }

    // ---- One month of accumulation data (bhavcopy) --------------------
    let accumulation = null;
    if (days.length > 0) {
      const rows = [];
      for (const day of days.slice(-MONTH_TRADING_DAYS)) {
        const r = day.bySymbol.get(symbol);
        if (!r) continue;
        rows.push({
          date: day.date,
          close: r.close,
          changePercent:
            r.prevClose && r.close ? Math.round(((r.close - r.prevClose) / r.prevClose) * 10000) / 100 : null,
          deliveryPct: r.deliveryPct,
          volume: r.volume,
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
          .slice(Math.max(0, i - 30), i)
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
    let shareholding = null;
    let blockDeals = null;
    try {
      const cookies = await getSessionCookies();
      [shareholding, blockDeals] = await Promise.all([
        fetchShareholding(symbol, cookies).catch(() => null),
        fetchBlockDeals(symbol, cookies).catch(() => null),
      ]);
    } catch {
      // NSE unreachable — both stay null and the UI says so.
    }

    return Response.json({
      symbol,
      levels,
      accumulation,
      shareholding,
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
