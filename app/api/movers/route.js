import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { computePeriodMetrics } from "@/lib/deliveryMetrics";
import { getOccurrenceHistory, getCurrentMembers } from "@/lib/screenerMembership";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// WHAT THIS DOES
//
// Previously this route auto-tagged every 4%+ move with a generic
// fingerprint ("volume dried up", "tight 21-day range", "near 21-day
// high", etc.) and reported hit-rate/lift per tag. Replaced with three
// specific, named setups instead:
//
//   a) Accumulation onset — the day a stock's delivery-based accumulation
//      read (see lib/deliveryMetrics.js) first turns Yes.
//   b) Delivery streak — the day a stock's trailing 30-day count of
//      delivery % above 70% first exceeds 5 days.
//   c) Pocket Pivot repeaters — stocks currently in the Pocket Pivot
//      screen that have appeared there more than twice in the last 10
//      trading days, with delivery % above 60%.
//
// (a) and (b) are genuine walk-forward backtests, computed the same
// honest way the old engine was: every ONSET (the day a condition first
// becomes true, not every day it stays true) is a denominator entry,
// whether or not it was followed by a good move, and forward return is
// measured over the FOLLOW_DAYS trading days after.
//
// (c) is NOT a backtest — see its own section below for why it can't be
// one yet, and what it is instead.
// ---------------------------------------------------------------------------

const MIN_PRICE = 20; // sub-₹20 stocks are excluded — tick-size noise dominates the % math
const MIN_AVG_VOLUME = 10000; // liquidity floor, same reasoning as the old engine
const FOLLOW_DAYS = 10; // trading days of forward return measured after each event

// --- (a) Accumulation onset ------------------------------------------------
// Matches lookbackDaysFor("daily") in lib/deliveryMetrics.js — the same
// trailing window the LIVE Delivery tab uses for this exact heuristic, so
// a backtested "Yes" here means what production would actually have
// shown on that day, not a number computed with the benefit of hindsight
// (extra days of history the live app wouldn't have had at the time).
const ACCUM_LOOKBACK = 36;

// --- (b) Delivery streak ----------------------------------------------------
const STREAK_WINDOW = 30;
const STREAK_THRESHOLD = 70; // %
const STREAK_MIN_DAYS = 5; // "more than 5" => strictly greater than 5

// --- (c) Pocket Pivot repeaters ---------------------------------------------
const POCKET_PIVOT_WINDOW_DAYS = 10;
const POCKET_PIVOT_MIN_APPEARANCES = 2; // "more than twice" => strictly greater than 2
const POCKET_PIVOT_DELIVERY_MIN = 60;

const DEFAULT_WINDOW = 66; // ~3 months of evaluation days
const MAX_WINDOW = 90;

function round(n, d = 2) {
  return n == null ? null : Math.round(n * 10 ** d) / 10 ** d;
}
function median(values) {
  const v = values.filter((x) => x != null).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return round(m);
}

/** Close-to-close return from day `i` to the last available close within
 * the next FOLLOW_DAYS trading days. Null (not zero) when there isn't
 * enough forward history yet — e.g. an event from three days ago — so it
 * can be excluded from the aggregate stats rather than silently treated
 * as a 0% outcome. */
function forwardReturn(days, symbol, i) {
  const cur = days[i]?.bySymbol.get(symbol);
  if (!cur?.close) return { pct: null, sample: 0 };
  let last = null;
  let sample = 0;
  for (let k = i + 1; k <= i + FOLLOW_DAYS && k < days.length; k++) {
    const row = days[k]?.bySymbol.get(symbol);
    if (row?.close != null) {
      last = row.close;
      sample++;
    }
  }
  if (last == null) return { pct: null, sample: 0 };
  return { pct: round(((last - cur.close) / cur.close) * 100), sample };
}

/**
 * Scenario (a): the day a symbol's accumulation read first turns Yes.
 * `days` is the FULL fetched bhavcopy array; each evaluation day's
 * accumulation status is computed from a trailing ACCUM_LOOKBACK-day
 * slice ending on that day — never looking forward — so this can't
 * "know" about future data the live app wouldn't have had either.
 */
function findAccumulationOnsets(days, symbols, firstEval) {
  const events = [];
  for (const symbol of symbols) {
    let wasAccum = false;
    for (let i = firstEval; i < days.length; i++) {
      const windowStart = Math.max(0, i + 1 - ACCUM_LOOKBACK);
      const metrics = computePeriodMetrics(symbol, days.slice(windowStart, i + 1), 1);
      const isAccum = metrics?.inAccumulation ?? false;
      if (isAccum && !wasAccum && metrics.close >= MIN_PRICE) {
        events.push({ symbol, date: days[i].date, index: i, close: metrics.close, deliveryPct: metrics.deliveryPct });
      }
      wasAccum = isAccum;
    }
  }
  return events;
}

/**
 * Scenario (b): the day a symbol's trailing 30-day count of delivery %
 * above 70% first exceeds 5 — i.e. crosses from "5 or fewer" to "more
 * than 5". Counting only the crossing day (not every day the streak
 * continues) avoids one long qualifying stretch dominating the sample as
 * if it were dozens of independent setups.
 */
function findDeliveryStreakOnsets(days, symbols, firstEval) {
  const events = [];
  function countAboveThreshold(symbol, endIdx) {
    const start = Math.max(0, endIdx + 1 - STREAK_WINDOW);
    let count = 0;
    for (let k = start; k <= endIdx; k++) {
      const row = days[k]?.bySymbol.get(symbol);
      if (row?.series === "EQ" && row.deliveryPct != null && row.deliveryPct > STREAK_THRESHOLD) count++;
    }
    return count;
  }
  for (const symbol of symbols) {
    let wasQualifying = false;
    for (let i = firstEval; i < days.length; i++) {
      const cur = days[i]?.bySymbol.get(symbol);
      if (!cur || cur.series !== "EQ" || !cur.close) continue;
      const count = countAboveThreshold(symbol, i);
      const isQualifying = count > STREAK_MIN_DAYS;
      if (isQualifying && !wasQualifying && cur.close >= MIN_PRICE) {
        events.push({
          symbol,
          date: days[i].date,
          index: i,
          close: cur.close,
          deliveryPct: cur.deliveryPct,
          daysAboveThreshold: count,
        });
      }
      wasQualifying = isQualifying;
    }
  }
  return events;
}

/** Turns a raw event list into the summary block the UI renders: sample
 * size, win rate, median/average forward return, and the individual
 * events (most recent first, capped so the payload stays reasonable). */
function summarize(events, days, label, description) {
  const withForward = events.map((e) => {
    const { pct, sample } = forwardReturn(days, e.symbol, e.index);
    return { ...e, forwardPct: pct, forwardSample: sample };
  });
  const resolved = withForward.filter((e) => e.forwardPct != null);
  const wins = resolved.filter((e) => e.forwardPct > 0);
  const sorted = [...withForward].sort((a, b) => (a.date < b.date ? 1 : -1));
  return {
    label,
    description,
    occurrences: withForward.length,
    resolvedOccurrences: resolved.length,
    winRatePct: resolved.length ? round((wins.length / resolved.length) * 100, 1) : null,
    medianForwardPct: median(resolved.map((e) => e.forwardPct)),
    avgForwardPct: resolved.length ? round(resolved.reduce((a, e) => a + e.forwardPct, 0) / resolved.length) : null,
    events: sorted.slice(0, 200).map((e) => ({
      symbol: e.symbol,
      date: e.date,
      close: e.close,
      deliveryPct: e.deliveryPct,
      forwardPct: e.forwardPct,
      forwardDays: e.forwardSample,
    })),
    truncated: withForward.length > 200,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const windowDays = Math.min(MAX_WINDOW, Math.max(10, Number(searchParams.get("window")) || DEFAULT_WINDOW));

  const need = Math.max(ACCUM_LOOKBACK, STREAK_WINDOW) + windowDays + FOLLOW_DAYS + 10;

  try {
    const days = await getRecentBhavcopies(need, need * 2 + 25);
    if (days.length < Math.max(ACCUM_LOOKBACK, STREAK_WINDOW) + 5) {
      return Response.json({ error: "Not enough trading-day data available from NSE yet" }, { status: 503 });
    }
    const latest = days[days.length - 1];
    const firstEval = Math.max(Math.max(ACCUM_LOOKBACK, STREAK_WINDOW), days.length - windowDays);

    // Universe: every equity-series symbol (ETFs/REITs/InvITs are
    // handled by computePeriodMetrics's own classify() where relevant,
    // but delivery-streak counting here works directly off bhavcopy rows
    // so it's filtered here too) with a full 30-day baseline of volume —
    // illiquid names swing too easily on thin volume to mean anything in
    // a backtest like this.
    const candidateSymbols = [];
    for (const [symbol, row] of latest.bySymbol) {
      if (row.series !== "EQ") continue;
      const baseline = days
        .slice(-STREAK_WINDOW)
        .map((d) => d.bySymbol.get(symbol)?.volume)
        .filter((v) => v > 0);
      const avgVol = baseline.length ? baseline.reduce((a, b) => a + b, 0) / baseline.length : 0;
      if (avgVol >= MIN_AVG_VOLUME) candidateSymbols.push(symbol);
    }

    const accumulationEvents = findAccumulationOnsets(days, candidateSymbols, firstEval);
    const streakEvents = findDeliveryStreakOnsets(days, candidateSymbols, firstEval);

    const scenarioA = summarize(
      accumulationEvents,
      days,
      "Accumulation onset",
      "The day delivery-based accumulation (delivery % above 50 on 10+ of the last 20 sessions, price held or rose over that window, volume above average) first read Yes."
    );
    const scenarioB = summarize(
      streakEvents,
      days,
      "Delivery streak",
      `The day a stock's trailing ${STREAK_WINDOW}-day count of delivery % above ${STREAK_THRESHOLD}% first exceeded ${STREAK_MIN_DAYS} days.`
    );

    // --- (c) Pocket Pivot repeaters ----------------------------------
    // NOT a historical backtest like (a) and (b) above. "How many times
    // has this appeared in Pocket Pivot" is only knowable from the
    // occurrence log lib/screenerMembership.js started keeping once that
    // tracking shipped — there's no way to reconstruct it for earlier
    // dates without re-running the Pocket Pivot screen (which needs
    // per-symbol weekly Yahoo history, market cap, and more) across the
    // whole ~2000-stock universe for every past trading day, which isn't
    // practical to do on request.
    //
    // So this is a live snapshot instead: today's Pocket Pivot members
    // (from the last time that tab was loaded — see
    // lib/screenerMembership.js's recordScreenSnapshot), filtered to the
    // ones that have appeared more than twice in the last 10 trading days
    // AND currently have delivery % above 60, each with its performance
    // since it crossed that appearance threshold. This list — and the
    // Pocket Pivot tab's own "Appeared (30d)" column — both fill in as
    // more trading days pass under this tracking.
    const pocketPivotRepeaters = {
      label: "Pocket Pivot repeaters",
      live: true,
      candidates: 0,
      asOfMembers: null,
      results: [],
      note: null,
    };
    try {
      const current = await getCurrentMembers("pocket-pivot");
      const members = current?.symbols ?? [];
      pocketPivotRepeaters.asOfMembers = current?.asOf ?? null;
      if (members.length === 0) {
        pocketPivotRepeaters.note =
          "No current Pocket Pivot members on file — visit Screeners → Pocket Pivot at least once to populate this.";
      } else {
        const sinceDate =
          days.length >= POCKET_PIVOT_WINDOW_DAYS
            ? days[days.length - POCKET_PIVOT_WINDOW_DAYS].date
            : days[0].date;
        const occurrences = await getOccurrenceHistory("pocket-pivot", members, sinceDate);
        pocketPivotRepeaters.candidates = members.length;
        if (!occurrences) {
          pocketPivotRepeaters.note = "Appearance tracking isn't available on this deployment (KV isn't configured).";
        } else {
          const results = [];
          for (const symbol of members) {
            const occ = occurrences[symbol];
            if (!occ || occ.count <= POCKET_PIVOT_MIN_APPEARANCES) continue;
            const metrics = computePeriodMetrics(symbol, days, 1);
            if (!metrics || metrics.deliveryPct == null || metrics.deliveryPct <= POCKET_PIVOT_DELIVERY_MIN) continue;

            // The date it crossed "more than twice" — the (N+1)th
            // appearance in the window, where N = POCKET_PIVOT_MIN_APPEARANCES.
            const crossingDate = occ.dates[POCKET_PIVOT_MIN_APPEARANCES];
            const crossingDay = days.find((d) => d.date === crossingDate);
            const crossingClose = crossingDay?.bySymbol.get(symbol)?.close ?? null;
            const performanceSinceCrossingPct =
              crossingClose && metrics.close
                ? round(((metrics.close - crossingClose) / crossingClose) * 100)
                : null;

            results.push({
              symbol,
              appearanceCount: occ.count,
              appearanceDates: occ.dates,
              deliveryPct: metrics.deliveryPct,
              close: metrics.close,
              crossingDate,
              performanceSinceCrossingPct,
            });
          }
          results.sort(
            (x, y) => (y.performanceSinceCrossingPct ?? -Infinity) - (x.performanceSinceCrossingPct ?? -Infinity)
          );
          pocketPivotRepeaters.results = results;
          if (results.length === 0) {
            pocketPivotRepeaters.note = `None of today's ${members.length} Pocket Pivot members currently meet all three conditions (appeared more than ${POCKET_PIVOT_MIN_APPEARANCES} times in ${POCKET_PIVOT_WINDOW_DAYS} trading days, delivery % above ${POCKET_PIVOT_DELIVERY_MIN}). This fills in as more trading days pass under appearance tracking.`;
          }
        }
      }
    } catch (err) {
      console.error("movers: pocket-pivot repeaters section failed:", err?.message || err);
      pocketPivotRepeaters.note = "Couldn't compute this section.";
    }

    return Response.json({
      asOf: latest.date,
      windowFirstDate: days[firstEval]?.date ?? null,
      criteria: {
        windowDays,
        followDays: FOLLOW_DAYS,
        minPrice: MIN_PRICE,
        minAvgVolume: MIN_AVG_VOLUME,
        accumLookback: ACCUM_LOOKBACK,
        streakWindow: STREAK_WINDOW,
        streakThreshold: STREAK_THRESHOLD,
        streakMinDays: STREAK_MIN_DAYS,
        pocketPivotWindowDays: POCKET_PIVOT_WINDOW_DAYS,
        pocketPivotMinAppearances: POCKET_PIVOT_MIN_APPEARANCES,
        pocketPivotDeliveryMin: POCKET_PIVOT_DELIVERY_MIN,
      },
      scenarios: {
        accumulation: scenarioA,
        deliveryStreak: scenarioB,
      },
      pocketPivotRepeaters,
    });
  } catch (err) {
    console.error("movers: failed to compute scenarios:", err?.message || err);
    return Response.json(
      { error: "Failed to analyse movers", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
