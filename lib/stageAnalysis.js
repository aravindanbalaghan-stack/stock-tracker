// Stage analysis for the Stage 2 screener.
//
// ATTRIBUTION, because these two frameworks get conflated constantly and
// the difference changes what "where would he have entered" means:
//
//   * The four-stage model (1 Basing → 2 Advancing → 3 Topping →
//     4 Declining) judged against the 30-WEEK moving average is STAN
//     WEINSTEIN's, from "Secrets for Profiting in Bull and Bear Markets"
//     (1988). The 30-week MA and the "Stage 2" label are his.
//   * RICHARD WYCKOFF's schema is Accumulation → Markup → Distribution →
//     Markdown, with lettered phases (A-E) inside accumulation and named
//     events: Preliminary Support, Selling Climax, Automatic Rally,
//     Secondary Test, Spring/Shakeout, Sign of Strength (SOS), and Last
//     Point of Support (LPS). Wyckoff never used a 30-week MA.
//
// They describe the same transition — a base resolving into an uptrend —
// so this module computes the stage Weinstein's way and then reports the
// entry points BOTH men would have taken, labelled by whose method each
// one comes from. That's why a single stock can show several entries.

import { toWeeklyBars } from "@/lib/screenerIndicators";

export const MA_WEEKS = 30;
// Slope is measured over 4 weeks and expressed as a % of the MA, so the
// "is it rising" test means the same thing for a ₹50 stock and a ₹5,000
// one.
const SLOPE_LOOKBACK_WEEKS = 4;
const FLAT_SLOPE_PCT = 0.5; // |4-week change| under this % counts as flat
const BASE_MAX_WEEKS = 26; // how far back to look for the Stage 1 base
const BASE_MIN_WEEKS = 5;
// A stock is "entering" Stage 2 rather than already in it if the breakout
// is this recent — roughly five weeks, while the move is still actionable.
export const ENTERING_MAX_DAYS = 25;

function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
}

/**
 * Cheap, deliberately LOOSE pre-filter used to decide whether a stock is
 * worth fetching full daily history for.
 *
 * It runs on Yahoo's native weekly bars, which may not bucket bar-for-bar
 * identically to toWeeklyBars around holidays. So the thresholds here are
 * slacker than classifyStage's: anything near the boundary passes and gets
 * judged properly on daily-derived data by analyzeStage2. The cost of a
 * false positive is one wasted fetch; the cost of a false negative is a
 * missed stock, so this errs toward including.
 */
export function mightBeStage2(weeklyBars) {
  if (!weeklyBars || weeklyBars.length < MA_WEEKS + SLOPE_LOOKBACK_WEEKS) return false;
  const closes = weeklyBars.map((w) => w.c);
  const i = closes.length - 1;
  const maNow = mean(closes.slice(i + 1 - MA_WEEKS, i + 1));
  const maPrev = mean(closes.slice(i + 1 - MA_WEEKS - SLOPE_LOOKBACK_WEEKS, i + 1 - SLOPE_LOOKBACK_WEEKS));
  if (maNow == null || maPrev == null) return false;
  const slopePct = ((maNow - maPrev) / maPrev) * 100;
  // Within 2% below the MA still counts as "maybe", and a slope merely not
  // clearly falling is enough to look closer.
  return closes[i] > maNow * 0.98 && slopePct > -1;
}

/** 30-week MA series aligned to weeklyBars (null until enough history). */
export function ma30Series(weeklyBars) {
  const closes = weeklyBars.map((w) => w.c);
  return closes.map((_, i) =>
    i + 1 >= MA_WEEKS ? mean(closes.slice(i + 1 - MA_WEEKS, i + 1)) : null
  );
}

/**
 * Weinstein stage at the most recent completed week, plus the raw inputs
 * so callers can explain the verdict rather than just assert it.
 */
export function classifyStage(weeklyBars) {
  const ma = ma30Series(weeklyBars);
  const i = weeklyBars.length - 1;
  const maNow = ma[i];
  const maPrev = ma[i - SLOPE_LOOKBACK_WEEKS];
  if (maNow == null || maPrev == null) return null;

  const close = weeklyBars[i].c;
  const slopePct = ((maNow - maPrev) / maPrev) * 100;
  const above = close > maNow;
  const rising = slopePct > FLAT_SLOPE_PCT;
  const falling = slopePct < -FLAT_SLOPE_PCT;

  let stage;
  if (above && rising) stage = 2;
  else if (!above && falling) stage = 4;
  else if (above && !rising) stage = 3; // advanced but momentum gone — topping
  else stage = 1; // below or at a flat MA — basing
  return { stage, ma30: maNow, slopePct, above, rising, falling, close };
}

/**
 * Walks back to find the start of the current unbroken run of weekly
 * closes above the 30-week MA. That crossover is the Stage 1 → Stage 2
 * boundary; everything before it is the base.
 */
function findRunStart(weeklyBars, ma) {
  let runStart = weeklyBars.length - 1;
  for (let i = weeklyBars.length - 1; i >= 0; i--) {
    if (ma[i] == null) break;
    if (weeklyBars[i].c > ma[i]) runStart = i;
    else break;
  }
  return runStart;
}

/**
 * Full Stage 2 analysis for one symbol.
 *
 * `dailyBars` and `benchmarkBars` are oldest-first OHLCV arrays (see
 * lib/screenerIndicators.js fetchDailyOHLCV). Returns null when the stock
 * isn't in Stage 2 or there isn't enough history to say.
 */
export function analyzeStage2(dailyBars, benchmarkBars) {
  if (!dailyBars || dailyBars.length < 260) return null;

  const weekly = toWeeklyBars(dailyBars);
  if (weekly.length < MA_WEEKS + SLOPE_LOOKBACK_WEEKS + BASE_MIN_WEEKS) return null;

  const current = classifyStage(weekly);
  if (!current || current.stage !== 2) return null;

  const ma = ma30Series(weekly);
  const runStart = findRunStart(weekly, ma);

  // The base is the stretch of weeks immediately before price reclaimed
  // the MA. Its high is the resistance a Stage 2 breakout has to clear —
  // for Wyckoff that same level is the top of the accumulation range.
  const baseFrom = Math.max(0, runStart - BASE_MAX_WEEKS);
  const baseWindow = weekly.slice(baseFrom, runStart);
  if (baseWindow.length < BASE_MIN_WEEKS) return null;
  const resistance = Math.max(...baseWindow.map((w) => w.h));
  const support = Math.min(...baseWindow.map((w) => w.l));

  // Daily bars from the crossover week onward — entries are dated to the
  // day, not the week.
  const runStartTime = new Date(`${weekly[runStart].key}T00:00:00Z`).getTime() / 1000;
  const fromIdx = dailyBars.findIndex((b) => b.t >= runStartTime);
  if (fromIdx === -1) return null;

  // --- Breakout: first daily CLOSE above the base's resistance ---------
  let breakoutIdx = -1;
  for (let i = fromIdx; i < dailyBars.length; i++) {
    if (dailyBars[i].c > resistance) {
      breakoutIdx = i;
      break;
    }
  }
  if (breakoutIdx === -1) return null; // reclaimed the MA but never cleared the base
  const breakout = dailyBars[breakoutIdx];

  const daysSinceEntry = dailyBars.length - 1 - breakoutIdx;

  // Volume confirmation — Weinstein wanted the breakout on a clear volume
  // expansion, so this reports the ratio rather than silently filtering.
  const priorVols = dailyBars
    .slice(Math.max(0, breakoutIdx - 50), breakoutIdx)
    .map((b) => b.v ?? 0)
    .filter((v) => v > 0);
  const avgVolBefore = mean(priorVols);
  const breakoutVolumeRatio =
    avgVolBefore && avgVolBefore > 0 ? Math.round(((breakout.v ?? 0) / avgVolBefore) * 100) / 100 : null;

  // --- Entries, labelled by whose method each comes from ---------------
  const entries = [];
  const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);

  // Wyckoff Phase C — Spring / Shakeout. A dip below the support the range
  // had established SO FAR, that snaps back above it within a few sessions.
  //
  // The comparison has to be against prior bars only. Comparing against the
  // base's overall low can never fire, because the spring's own low IS that
  // low — which is exactly the bug this loop is written to avoid.
  const baseStartTime = new Date(`${weekly[baseFrom].key}T00:00:00Z`).getTime() / 1000;
  const baseDaily = dailyBars.filter((b) => b.t >= baseStartTime && b.t < runStartTime);
  let spring = null;
  let springUndercut = null;
  // Needs a few bars of range first, otherwise "prior low" is meaningless.
  const MIN_BARS_BEFORE_SPRING = 10;
  for (let i = MIN_BARS_BEFORE_SPRING; i < baseDaily.length; i++) {
    const priorLow = Math.min(...baseDaily.slice(0, i).map((b) => b.l));
    if (baseDaily[i].l >= priorLow) continue;
    // Recovered back above the level it undercut, within 5 sessions.
    const recovered = baseDaily.slice(i + 1, i + 6).some((b) => b.c > priorLow);
    if (!recovered) continue;
    if (!spring || baseDaily[i].l < spring.l) {
      spring = baseDaily[i];
      springUndercut = priorLow;
    }
  }
  if (spring) {
    entries.push({
      method: "Wyckoff — Spring / Shakeout (Phase C)",
      stance: "Aggressive",
      date: iso(spring.t),
      price: Math.round(spring.l * 100) / 100,
      rationale: `Undercut the ₹${Math.round(springUndercut * 100) / 100} support the range had held, then closed back above it within days — a shakeout of weak holders. Earliest entry, taken before the breakout confirms.`,
    });
  }

  // Weinstein's primary Stage 2 buy, which is also Wyckoff's Sign of
  // Strength leaving the range.
  entries.push({
    method: "Weinstein — Stage 2 breakout · Wyckoff — Sign of Strength",
    stance: "Standard",
    date: iso(breakout.t),
    price: Math.round(breakout.c * 100) / 100,
    rationale: `Closed above the ₹${Math.round(resistance * 100) / 100} base resistance with the 30-week MA turning up${
      breakoutVolumeRatio ? `, on ${breakoutVolumeRatio}× the prior 50-day average volume` : ""
    }.`,
  });

  // Wyckoff's Last Point of Support / Weinstein's pullback buy: the first
  // retest of the broken resistance that holds. Wyckoff preferred this to
  // chasing the breakout.
  //
  // A real retest requires price to have ADVANCED away from the level first
  // and then come back to it. Without that, the bar immediately after the
  // breakout trivially sits "within 2% of resistance" and gets mislabelled
  // as a retest.
  const LPS_MIN_ADVANCE = 1.03; // must first trade 3% clear of the breakout level
  let lps = null;
  let advanced = false;
  for (let i = breakoutIdx + 1; i < dailyBars.length; i++) {
    const b = dailyBars[i];
    if (!advanced) {
      if (b.h >= resistance * LPS_MIN_ADVANCE) advanced = true;
      continue;
    }
    if (b.l <= resistance * 1.02 && b.c > resistance) {
      lps = b;
      break;
    }
  }
  if (lps) {
    entries.push({
      method: "Wyckoff — Last Point of Support · Weinstein — pullback buy",
      stance: "Conservative",
      date: iso(lps.t),
      price: Math.round(lps.c * 100) / 100,
      rationale:
        "After advancing clear of the breakout, price returned to the broken resistance and closed back above it — old resistance acting as new support.",
    });
  }

  // Weinstein also added on pullbacks into the rising 30-week MA. Checked
  // against the weekly MA value in force at the time.
  let maPullback = null;
  for (let i = breakoutIdx + 1; i < dailyBars.length; i++) {
    const b = dailyBars[i];
    const wIdx = weekly.findIndex((w) => new Date(`${w.key}T00:00:00Z`).getTime() / 1000 > b.t) - 1;
    const maThen = wIdx >= 0 ? ma[wIdx] : null;
    if (maThen != null && b.l <= maThen * 1.01 && b.c > maThen) {
      maPullback = { bar: b, maThen };
      break;
    }
  }
  if (maPullback) {
    entries.push({
      method: "Weinstein — pullback to the rising 30-week MA",
      stance: "Add-on",
      date: iso(maPullback.bar.t),
      price: Math.round(maPullback.bar.c * 100) / 100,
      rationale: `Retreated to the rising 30-week MA (₹${Math.round(maPullback.maThen * 100) / 100}) and held it.`,
    });
  }

  // --- Relative strength vs the benchmark ------------------------------
  // Weinstein insisted a Stage 2 stock should also be OUTPERFORMING the
  // market, not merely rising with it. Measured over 26 weeks.
  let rsVsBenchmark = null;
  if (benchmarkBars && benchmarkBars.length > 130) {
    const stockThen = dailyBars[dailyBars.length - 131]?.c;
    const stockNow = dailyBars[dailyBars.length - 1]?.c;
    const benchThen = benchmarkBars[benchmarkBars.length - 131]?.c;
    const benchNow = benchmarkBars[benchmarkBars.length - 1]?.c;
    if (stockThen && stockNow && benchThen && benchNow) {
      const stockRet = ((stockNow - stockThen) / stockThen) * 100;
      const benchRet = ((benchNow - benchThen) / benchThen) * 100;
      rsVsBenchmark = Math.round((stockRet - benchRet) * 100) / 100;
    }
  }

  return {
    stage: 2,
    stagePhase: daysSinceEntry <= ENTERING_MAX_DAYS ? "Entering" : "In Stage 2",
    daysSinceEntry,
    stage2EntryPrice: Math.round(breakout.c * 100) / 100,
    stage2EntryDate: iso(breakout.t),
    baseResistance: Math.round(resistance * 100) / 100,
    baseSupport: Math.round(support * 100) / 100,
    baseWeeks: baseWindow.length,
    breakoutVolumeRatio,
    ma30: Math.round(current.ma30 * 100) / 100,
    ma30SlopePct: Math.round(current.slopePct * 100) / 100,
    rsVsBenchmark,
    entries,
  };
}

// ---------------------------------------------------------------------
// Weinstein — the four-stage tab.
//
// Stage 2 already gets a full treatment above (base, breakout, RS, every
// entry both men would take). The Weinstein tab wants something broader:
// which of ALL FOUR stages a stock is in, and whether it JUST transitioned
// into that stage — because a stock ten weeks into Stage 3 topping isn't
// "entering" anything, but one that crossed into it last week is worth a
// look either way (Stage 3 = start distributing; Stage 4 = stay out/short).
//
// This runs on WEEKLY bars alone — no daily fetch needed — because the
// stage boundary (close vs. 30-week MA, MA slope) is itself a weekly
// question. That keeps the Weinstein screen a single cheap pass instead of
// a second daily-history fetch on top of Stage 2's.
// ---------------------------------------------------------------------

export const WEINSTEIN_STAGE_INFO = {
  1: { name: "Stage 1 — Basing", tone: "neutral" },
  2: { name: "Stage 2 — Advancing", tone: "bullish" },
  3: { name: "Stage 3 — Topping", tone: "caution" },
  4: { name: "Stage 4 — Declining", tone: "bearish" },
};

/**
 * Walks weekly bars backward from the latest one and finds how long the
 * CURRENT stage classification has held, i.e. the most recent week whose
 * classification differs from today's. Returns null if there isn't enough
 * history to classify at all.
 */
export function classifyStageTransition(weeklyBars) {
  const current = classifyStage(weeklyBars);
  if (!current) return null;

  const ma = ma30Series(weeklyBars);
  let transitionIdx = weeklyBars.length - 1;
  for (let i = weeklyBars.length - 1; i >= 0; i--) {
    const maNow = ma[i];
    const maPrev = ma[i - SLOPE_LOOKBACK_WEEKS];
    if (maNow == null || maPrev == null) break;
    const close = weeklyBars[i].c;
    const slopePct = ((maNow - maPrev) / maPrev) * 100;
    const above = close > maNow;
    const rising = slopePct > FLAT_SLOPE_PCT;
    const falling = slopePct < -FLAT_SLOPE_PCT;
    let stageHere;
    if (above && rising) stageHere = 2;
    else if (!above && falling) stageHere = 4;
    else if (above && !rising) stageHere = 3;
    else stageHere = 1;
    if (stageHere !== current.stage) break;
    transitionIdx = i;
  }

  const weeksInStage = weeklyBars.length - 1 - transitionIdx;
  return {
    ...current,
    transitionWeekKey: weeklyBars[transitionIdx]?.key ?? null,
    transitionPrice: Math.round(weeklyBars[transitionIdx].c * 100) / 100,
    weeksInStage,
    isEntering: weeksInStage <= 5, // roughly ENTERING_MAX_DAYS, in weeks
  };
}

// ---------------------------------------------------------------------
// Backtest support — finds every Stage-2 EPISODE (not just the current
// one) inside a stretch of daily history, so entries can be evaluated
// after the fact. An "episode" is one unbroken run of weekly closes above
// a rising 30-week MA; a stock can have several of these across a couple
// of years as it bases, breaks out, tops, and bases again.
//
// This is deliberately a leaner copy of analyzeStage2's base/spring/
// breakout/LPS logic rather than a shared refactor — the live screener
// path always wants exactly the LATEST episode and bails immediately if
// it isn't currently Stage 2, while the backtest wants every episode
// whose entries fall inside a lookback window, current stage or not.
// Keeping them separate avoids threading an "all episodes vs. latest
// only" flag through the hot path just to serve the backtest.
// ---------------------------------------------------------------------

/**
 * All Wyckoff Aggressive (Spring) and Conservative (LPS) entries found in
 * `dailyBars`, across every Stage-2 episode whose entry falls on or after
 * `sinceEpoch` (unix seconds). Returns [] rather than null when nothing
 * qualifies, since callers aggregate across many stocks.
 */
export function findWyckoffEntriesSince(dailyBars, sinceEpoch) {
  if (!dailyBars || dailyBars.length < 260) return [];
  const weekly = toWeeklyBars(dailyBars);
  if (weekly.length < MA_WEEKS + SLOPE_LOOKBACK_WEEKS + BASE_MIN_WEEKS) return [];
  const ma = ma30Series(weekly);

  // Every week index where price crosses from at/below the MA to above it
  // — i.e. every Stage 1 -> Stage 2 boundary in the whole series, not just
  // the most recent.
  const runStarts = [];
  for (let i = 1; i < weekly.length; i++) {
    if (ma[i] == null || ma[i - 1] == null) continue;
    const nowAbove = weekly[i].c > ma[i];
    const prevAbove = weekly[i - 1].c > ma[i - 1];
    if (nowAbove && !prevAbove) runStarts.push(i);
  }

  const results = [];
  const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);

  for (const runStart of runStarts) {
    const baseFrom = Math.max(0, runStart - BASE_MAX_WEEKS);
    const baseWindow = weekly.slice(baseFrom, runStart);
    if (baseWindow.length < BASE_MIN_WEEKS) continue;
    const resistance = Math.max(...baseWindow.map((w) => w.h));

    const runStartTime = new Date(`${weekly[runStart].key}T00:00:00Z`).getTime() / 1000;
    const baseStartTime = new Date(`${weekly[baseFrom].key}T00:00:00Z`).getTime() / 1000;
    const fromIdx = dailyBars.findIndex((b) => b.t >= runStartTime);
    if (fromIdx === -1) continue;

    // Breakout: first daily close above the base's resistance.
    let breakoutIdx = -1;
    for (let i = fromIdx; i < dailyBars.length; i++) {
      if (dailyBars[i].c > resistance) {
        breakoutIdx = i;
        break;
      }
    }
    if (breakoutIdx === -1) continue;

    // Aggressive — Spring/Shakeout inside this episode's base.
    const baseDaily = dailyBars.filter((b) => b.t >= baseStartTime && b.t < runStartTime);
    const MIN_BARS_BEFORE_SPRING = 10;
    let spring = null;
    for (let i = MIN_BARS_BEFORE_SPRING; i < baseDaily.length; i++) {
      const priorLow = Math.min(...baseDaily.slice(0, i).map((b) => b.l));
      if (baseDaily[i].l >= priorLow) continue;
      const recovered = baseDaily.slice(i + 1, i + 6).some((b) => b.c > priorLow);
      if (!recovered) continue;
      if (!spring || baseDaily[i].l < spring.l) spring = baseDaily[i];
    }
    if (spring && spring.t >= sinceEpoch) {
      results.push({ stance: "Aggressive", date: iso(spring.t), price: spring.l, idx: dailyBars.indexOf(spring) });
    }

    // Conservative — Last Point of Support, first genuine retest.
    const LPS_MIN_ADVANCE = 1.03;
    let lps = null;
    let advanced = false;
    for (let i = breakoutIdx + 1; i < dailyBars.length; i++) {
      const b = dailyBars[i];
      if (!advanced) {
        if (b.h >= resistance * LPS_MIN_ADVANCE) advanced = true;
        continue;
      }
      if (b.l <= resistance * 1.02 && b.c > resistance) {
        lps = b;
        break;
      }
    }
    if (lps && lps.t >= sinceEpoch) {
      results.push({ stance: "Conservative", date: iso(lps.t), price: lps.c, idx: dailyBars.indexOf(lps) });
    }
  }

  return results;
}
