import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { getSessionCookies, nseApiFetchWithCookies } from "@/lib/nseSession";
import { fetchDailyOHLCV, fetchIndexOHLCV, sma, ema, toWeeklyBars } from "@/lib/screenerIndicators";
import { getSectorsForSymbol } from "@/lib/sectorOverrides";
import { analyzeStage2, classifyStageTransition, WEINSTEIN_STAGE_INFO } from "@/lib/stageAnalysis";
import {
  computeMetrics,
  ACCUMULATION_DELIVERY_THRESHOLD,
  ACCUMULATION_MIN_DAYS,
} from "@/lib/deliveryMetrics";
import { APPEARANCE_WINDOW_TRADING_DAYS, matchesBucket } from "@/lib/deliveryBuckets";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const NSE_TIMEOUT_MS = 6000;
// The accumulation table's window — "1m" (the original, default) or "3m".
// Selectable via ?window= on the request; anything else falls back to 1m.
const WINDOW_TRADING_DAYS = { "1m": 22, "3m": 66 };
// Every row in the accumulation table shows volume against ITS OWN
// trailing 30-day average, so the oldest displayed day still needs 30
// sessions behind it: the window + 30, plus slack for holidays. The
// per-date bhavcopy files are cached for a week, so the wider window is
// mostly a first-load cost.
const VOLUME_AVG_DAYS = 30;
// A day counts as a volume spike when it trades this many times its own
// trailing 30-day average.
const VOLUME_SPIKE_MULTIPLE = 2;
// How many trading days make up one "week" when the accumulation table is
// viewed as Weekly rather than Daily — a trading week, same convention
// PERIOD_TRADING_DAYS.weekly uses elsewhere in the app (lib/deliveryMetrics.js).
const WEEKLY_TRADING_DAYS = 5;

/**
 * One day's full accumulation-table row for `symbol`: close, change %,
 * delivery %, volume, and that day's volume against its own trailing
 * 30-day average — everything the accumulation table's columns need.
 * Shared between the accumulation rows themselves and the threshold-
 * appearance detail below, so a "which bucket did it land in, and what
 * did that day actually look like" question can be answered with the
 * exact same numbers, not a lighter recomputation. Returns null if the
 * symbol didn't trade that day.
 */
function buildDayRow(days, i, symbol) {
  const day = days[i];
  const r = day.bySymbol.get(symbol);
  if (!r) return null;

  // Trailing average of the 30 sessions BEFORE this one — each day is
  // measured against the norm as it stood at the time, not against a
  // single average taken from the end of the window.
  const priorVols = days
    .slice(Math.max(0, i - VOLUME_AVG_DAYS), i)
    .map((d) => d.bySymbol.get(symbol)?.volume)
    .filter((v) => v > 0);
  const avgVol = priorVols.length ? priorVols.reduce((a, b) => a + b, 0) / priorVols.length : null;

  return {
    date: day.date,
    // Same as `date` for a single day — these only diverge once a row
    // represents an aggregated period (see buildWeeklyRows below), but
    // carrying them here too means the frontend can treat every row the
    // same way regardless of which granularity built it.
    startDate: day.date,
    endDate: day.date,
    close: r.close,
    changePercent:
      r.prevClose && r.close ? Math.round(((r.close - r.prevClose) / r.prevClose) * 10000) / 100 : null,
    deliveryPct: r.deliveryPct,
    volume: r.volume,
    // Traded value for the day, in ₹ Crores (NSE reports it in Lakhs;
    // 1 Cr = 100 Lakhs).
    turnoverCr: r.turnoverLacs != null ? Math.round((r.turnoverLacs / 100) * 100) / 100 : null,
    avgVolume: avgVol != null ? Math.round(avgVol) : null,
    // How many times its own recent norm the day traded. Null rather
    // than 0 when there isn't enough history to judge.
    volumeRatio: avgVol && avgVol > 0 ? Math.round((r.volume / avgVol) * 100) / 100 : null,
    // Days with too few prior sessions are flagged so the UI doesn't
    // present a thin average as if it were a full one.
    avgVolumeDays: priorVols.length,
  };
}

/**
 * Aggregates the daily rows for `symbol` from index `startIdx` onward in
 * `days` into weekly buckets (trading weeks, not calendar weeks — see
 * WEEKLY_TRADING_DAYS), for the accumulation table's Weekly view. Chunks
 * from the END backward so only the OLDEST bucket can be a short week —
 * the most recent week shown is always a full one.
 *
 * Delivery % is volume-weighted across the week (summed delivered shares
 * ÷ summed traded shares), the same math buildRecentPeriodHistory uses,
 * rather than averaging each day's already-rounded percentage — a week
 * with one huge low-delivery day and four quiet high-delivery days should
 * read as what it actually was, not get smoothed away by a simple mean.
 * Each week's volume ratio is judged against the trailing 30-trading-day
 * average daily volume AS OF that week's first day, scaled up by however
 * many days actually traded that week — the same basis computePeriodMetrics
 * uses for Weekly in the Delivery tab, so a "2.1×" here and a "2.1×" there
 * mean the same thing.
 */
function buildWeeklyRows(days, startIdx, symbol) {
  const indices = [];
  for (let i = startIdx; i < days.length; i++) indices.push(i);

  const chunks = [];
  let end = indices.length;
  while (end > 0) {
    const start = Math.max(0, end - WEEKLY_TRADING_DAYS);
    chunks.unshift(indices.slice(start, end));
    end = start;
  }

  return chunks
    .map((idxGroup) => {
      let volume = 0;
      let deliveryQty = 0;
      let turnoverLacs = 0;
      let firstPrevClose = null;
      let lastClose = null;
      let tradedDays = 0;
      for (const i of idxGroup) {
        const row = days[i].bySymbol.get(symbol);
        if (!row || !row.volume) continue;
        volume += row.volume;
        deliveryQty += row.deliveryQty || 0;
        turnoverLacs += row.turnoverLacs || 0;
        if (firstPrevClose == null) firstPrevClose = row.prevClose ?? row.close;
        lastClose = row.close;
        tradedDays++;
      }
      if (tradedDays === 0) return null;

      const firstIdx = idxGroup[0];
      const priorVols = days
        .slice(Math.max(0, firstIdx - VOLUME_AVG_DAYS), firstIdx)
        .map((d) => d.bySymbol.get(symbol)?.volume)
        .filter((v) => v > 0);
      const avgDailyVol = priorVols.length ? priorVols.reduce((a, b) => a + b, 0) / priorVols.length : null;
      const expectedVolume = avgDailyVol != null ? avgDailyVol * tradedDays : null;

      return {
        date: days[idxGroup[idxGroup.length - 1]].date,
        startDate: days[idxGroup[0]].date,
        endDate: days[idxGroup[idxGroup.length - 1]].date,
        close: lastClose,
        changePercent:
          firstPrevClose && lastClose
            ? Math.round(((lastClose - firstPrevClose) / firstPrevClose) * 10000) / 100
            : null,
        deliveryPct: volume > 0 ? Math.round((deliveryQty / volume) * 10000) / 100 : null,
        volume: volume || null,
        turnoverCr: turnoverLacs > 0 ? Math.round((turnoverLacs / 100) * 100) / 100 : null,
        avgVolume: avgDailyVol != null ? Math.round(avgDailyVol) : null,
        volumeRatio:
          expectedVolume && expectedVolume > 0 ? Math.round((volume / expectedVolume) * 100) / 100 : null,
        avgVolumeDays: priorVols.length,
        tradedDays,
      };
    })
    .filter(Boolean);
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

  const windowParam = searchParams.get("window");
  const windowId = WINDOW_TRADING_DAYS[windowParam] ? windowParam : "1m";
  const windowTradingDays = WINDOW_TRADING_DAYS[windowId];
  // Accumulation table granularity — "daily" (every trading day, the
  // original behavior and the default) or "weekly" (trading weeks, see
  // buildWeeklyRows). Independent of windowId: either granularity can be
  // viewed across either the 1-month or 3-month window.
  const granularityParam = searchParams.get("granularity");
  const granularity = granularityParam === "weekly" ? "weekly" : "daily";
  // Wide enough for both the accumulation table's own window AND the
  // 2-month threshold-appearance history (see lib/deliveryBuckets.js) —
  // bhavcopy day-files are cached individually, so asking for the wider
  // of the two costs nothing extra once both are warm.
  const bhavWindow = Math.max(windowTradingDays, APPEARANCE_WINDOW_TRADING_DAYS) + VOLUME_AVG_DAYS + 5;

  try {
    const [days, hist, sectors] = await Promise.all([
      getRecentBhavcopies(bhavWindow, bhavWindow * 2 + 20).catch(() => []),
      fetchDailyOHLCV(symbol, "2y").catch(() => null),
      // Every sector this stock belongs to — a stock can genuinely sit in
      // several, so all of them are returned rather than just the first.
      getSectorsForSymbol(symbol).catch(() => []),
    ]);

    // ---- Price levels & indicators (Yahoo) ----------------------------
    let levels = null;
    let weinstein = null;
    let wyckoff = null;
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
        // The real trading day this price and the indicators below belong
        // to — see the placeholder-bar trim in fetchDailyOHLCV. Shown in
        // the page header so a holiday (or any day Yahoo hasn't published
        // a fresh close for yet) reads as "price data as of <date>"
        // rather than silently implying it's today's.
        asOf: hist.asOf ?? null,
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

      // ---- Weinstein stage (weekly bars only) --------------------------
      const transition = classifyStageTransition(weekly);
      if (transition) {
        const info = WEINSTEIN_STAGE_INFO[transition.stage];
        weinstein = {
          stage: transition.stage,
          stageLabel: info.name,
          tone: info.tone,
          weeksInStage: transition.weeksInStage,
          isEntering: transition.isEntering,
          transitionWeekKey: transition.transitionWeekKey,
          transitionPrice: round(transition.transitionPrice),
          ma30: round(transition.ma30),
          ma30SlopePct: round(transition.slopePct),
        };
      }

      // ---- Wyckoff / Stage-2 entries ------------------------------------
      // Only meaningful when the stock is CURRENTLY in a Stage-2 run —
      // analyzeStage2 returns null otherwise, same rule the Stage 2/Wyckoff
      // screens use, so this page and those tabs never disagree.
      let benchmarkBars = null;
      try {
        const nifty = await fetchIndexOHLCV("^NSEI");
        benchmarkBars = nifty?.bars ?? null;
      } catch {
        // RS column just won't be available — not worth failing the page.
      }
      const stage2 = analyzeStage2(bars, benchmarkBars);
      wyckoff = stage2
        ? {
            inStage2: true,
            stagePhase: stage2.stagePhase,
            daysSinceEntry: stage2.daysSinceEntry,
            baseSupport: stage2.baseSupport,
            baseResistance: stage2.baseResistance,
            baseWeeks: stage2.baseWeeks,
            breakoutVolumeRatio: stage2.breakoutVolumeRatio,
            rsVsBenchmark: stage2.rsVsBenchmark,
            entries: stage2.entries,
          }
        : { inStage2: false, entries: [] };
    }

    // ---- One month of accumulation data (bhavcopy) --------------------
    let accumulation = null;
    if (days.length > 0) {
      const rows = [];
      const firstShown = Math.max(0, days.length - windowTradingDays);
      for (let i = firstShown; i < days.length; i++) {
        const row = buildDayRow(days, i, symbol);
        if (row) rows.push(row);
      }

      // Volume spikes over the same window, each measured against that
      // day's own trailing 30-day average rather than a single fixed one.
      const spikes = [];
      for (let i = days.length - windowTradingDays; i < days.length; i++) {
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

      // The app-wide "is this currently accumulating" read — always the
      // standard fixed 20-trading-day heuristic (see lib/deliveryMetrics.js),
      // independent of whichever window is selected above, since that's a
      // single ongoing judgment call, not something that makes sense to ask
      // "for the last 3 months" separately. Shown as the section's "reads
      // as accumulation" badge, not tied to the stats row below.
      const metrics = computeMetrics(symbol, days);
      const withDelivery = rows.filter((r) => r.deliveryPct != null);
      // "Days above X%" and the average delivery % above it should describe
      // the SAME population — both scoped to whichever window (1M/3M) is
      // currently selected — so they never disagree the way a fixed
      // 20-day count sitting next to a 1M/3M-scoped average could.
      const daysAboveThresholdInWindow = withDelivery.filter(
        (r) => r.deliveryPct > ACCUMULATION_DELIVERY_THRESHOLD
      ).length;
      accumulation = {
        windowId,
        windowTradingDays,
        granularity,
        rows: granularity === "weekly" ? buildWeeklyRows(days, firstShown, symbol) : rows,
        spikes,
        avgDeliveryPct: withDelivery.length
          ? Math.round((withDelivery.reduce((a, r) => a + r.deliveryPct, 0) / withDelivery.length) * 100) / 100
          : null,
        // Trailing 30-trading-day average volume as of the latest session —
        // a fixed basis regardless of the window/granularity selectors
        // above, matching VOLUME_AVG_DAYS used for the Vol× column.
        avgVolume30d: rows.length ? rows[rows.length - 1].avgVolume : null,
        daysAboveThreshold: daysAboveThresholdInWindow,
        accumulationWindow: windowTradingDays,
        accumulationThreshold: ACCUMULATION_DELIVERY_THRESHOLD,
        accumulationMinDays: ACCUMULATION_MIN_DAYS,
        inAccumulation: metrics?.inAccumulation ?? null,
        // How many of the last ~2 months' trading days fell in each
        // delivery-% bucket (see lib/deliveryBuckets.js), AND the full
        // detail behind each one (date, close, chg%, delivery%, volume,
        // vol×) — the same columns the accumulation table above uses —
        // so clicking a count can show exactly which days and what they
        // looked like, not just a number. Always the trailing
        // APPEARANCE_WINDOW_TRADING_DAYS of `days`, independent of
        // whichever window (1M/3M) is selected for the table above.
        thresholdAppearances: (() => {
          const bucketIds = ["90", "80", "70", "60", "50"];
          const counts = Object.fromEntries(bucketIds.map((id) => [id, 0]));
          const daysDetail = Object.fromEntries(bucketIds.map((id) => [id, []]));
          const start = Math.max(0, days.length - APPEARANCE_WINDOW_TRADING_DAYS);
          let tradedDays = 0;
          for (let i = start; i < days.length; i++) {
            const row = buildDayRow(days, i, symbol);
            if (!row || row.deliveryPct == null) continue;
            tradedDays++;
            for (const id of bucketIds) {
              if (matchesBucket(row.deliveryPct, id)) {
                counts[id]++;
                daysDetail[id].push(row);
              }
            }
          }
          for (const id of bucketIds) daysDetail[id].reverse(); // most recent first
          return {
            counts,
            daysDetail,
            tradedDays,
            windowStart: days[start]?.date ?? null,
            windowEnd: days[days.length - 1]?.date ?? null,
          };
        })(),
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
      weinstein,
      wyckoff,
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
