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

// classifyStageTransition runs on whichever weekly bars the caller has —
// toWeeklyBars() output (which carries a Monday-aligned `.key`) for
// Stage 2/Wyckoff, but Yahoo's native weekly bars (`.t` only, no `.key`)
// for the Weinstein screen, which skips the daily-history fetch entirely.
// This derives the same Monday-aligned ISO date from `.t` when `.key`
// isn't present, so callers get a real date either way instead of
// silently falling through to null.
function weekKeyOf(bar) {
  if (bar.key) return bar.key;
  const d = new Date(bar.t * 1000);
  const monday = new Date(d);
  const dayOfWeek = (monday.getUTCDay() + 6) % 7; // 0 = Monday
  monday.setUTCDate(monday.getUTCDate() - dayOfWeek);
  return monday.toISOString().slice(0, 10);
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
  return { ...stageFrom(close, maNow, maPrev), ma30: maNow, close };
}

/**
 * The one place the four-stage rule lives. Every caller — the current
 * verdict, the week-by-week history, and the "what close would change
 * it" invalidation levels — goes through this, so they can't drift apart.
 */
function stageFrom(close, maNow, maPrev) {
  const slopePct = ((maNow - maPrev) / maPrev) * 100;
  const above = close > maNow;
  const rising = slopePct > FLAT_SLOPE_PCT;
  const falling = slopePct < -FLAT_SLOPE_PCT;
  let stage;
  if (above && rising) stage = 2;
  else if (!above && falling) stage = 4;
  else if (above && !rising) stage = 3; // advanced but momentum gone — topping
  else stage = 1; // below or at a flat MA — basing
  return { stage, slopePct, above, rising, falling };
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
export function analyzeStage2(dailyBars, benchmarkBars, { asOfEpoch } = {}) {
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
  // had established SO FAR, that closes back above it the same session or
  // within the next five.
  //
  // The comparison has to be against prior bars only. Comparing against the
  // base's overall low can never fire, because the spring's own low IS that
  // low — which is exactly the bug this loop is written to avoid.
  const baseStartTime = new Date(`${weekly[baseFrom].key}T00:00:00Z`).getTime() / 1000;
  const baseDaily = dailyBars.filter((b) => b.t >= baseStartTime && b.t < runStartTime);
  const spring = findSpring(baseDaily);
  if (spring) {
    const sameDay = spring.confirm === spring.low;
    entries.push({
      method: "Wyckoff — Spring / Shakeout (Phase C)",
      stance: "Aggressive",
      // Dated to the session that CONFIRMED the spring (closed back above
      // the undercut support), not the session that made the low. On the
      // low day itself nobody yet knows it's a spring rather than a
      // breakdown — reporting that date was the "shows a day in the past"
      // bug. The low is kept separately as the stop reference.
      date: iso(spring.confirm.t),
      price: r2(spring.confirm.c),
      signalDate: iso(spring.low.t),
      signalLow: r2(spring.low.l),
      rationale: `Undercut the ₹${r2(spring.undercut)} support the range had held (low ₹${r2(spring.low.l)} on ${iso(
        spring.low.t
      )}), then closed back above it ${sameDay ? "the same session" : `on ${iso(spring.confirm.t)}`} — a shakeout of weak holders. Earliest entry, taken before the breakout confirms.`,
      invalidation: {
        price: r2(spring.low.l),
        rule: `A close below the ₹${r2(spring.low.l)} spring low — the shakeout failed and the range is breaking down.`,
      },
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
    invalidation: {
      price: r2(resistance),
      rule: `A close back below the ₹${r2(resistance)} base resistance — a failed breakout.`,
    },
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
  let lpsIdx = -1;
  let advanced = false;
  for (let i = breakoutIdx + 1; i < dailyBars.length; i++) {
    const b = dailyBars[i];
    if (!advanced) {
      if (b.h >= resistance * LPS_MIN_ADVANCE) advanced = true;
      continue;
    }
    if (b.l <= resistance * 1.02 && b.c > resistance) {
      lps = b;
      lpsIdx = i;
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
      invalidation: {
        price: r2(resistance),
        rule: `A close back below ₹${r2(resistance)} — old resistance failed to hold as support.`,
      },
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
      invalidation: {
        price: null,
        rule: "A weekly close below the 30-week MA — see the stage invalidation level.",
      },
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

  // --- Where in Wyckoff's schedule it is NOW, and since when ----------
  // Each event is dated to the session that confirmed it. The latest one
  // is the current phase — so a stock that sprang in Phase C and has since
  // broken out reads as Phase D from the breakout day, not as the older
  // Phase C it has already left behind.
  const phaseEvents = [];
  if (spring) {
    phaseEvents.push({ phase: "Phase C", name: "Spring / Shakeout", idx: dailyBars.indexOf(spring.confirm) });
  }
  phaseEvents.push({ phase: "Phase D", name: "Sign of Strength — breakout", idx: breakoutIdx });
  if (lps) {
    phaseEvents.push({ phase: "Phase D", name: "Last Point of Support", idx: lpsIdx });
    // Phase E (markup) starts when price leaves the LPS area behind —
    // the first close above the high of the reaction it pulled back from.
    const reactionHigh = Math.max(...dailyBars.slice(breakoutIdx, lpsIdx + 1).map((b) => b.h));
    for (let i = lpsIdx + 1; i < dailyBars.length; i++) {
      if (dailyBars[i].c > reactionHigh) {
        phaseEvents.push({ phase: "Phase E", name: "Markup", idx: i, level: r2(reactionHigh) });
        break;
      }
    }
  }
  phaseEvents.sort((a, b) => a.idx - b.idx);
  const lastIdx = dailyBars.length - 1;
  const phaseHistory = phaseEvents.map((e) => ({
    phase: e.phase,
    name: e.name,
    label: `${e.phase} — ${e.name}`,
    since: iso(dailyBars[e.idx].t),
    sessionsSince: lastIdx - e.idx,
  }));
  const wyckoffCurrent = phaseHistory[phaseHistory.length - 1];

  // --- Daily closes under the 30-week MA since the breakout ------------
  // The stage itself is a WEEKLY verdict, so a single bad day doesn't
  // change it — but those days are exactly the near-misses worth seeing.
  // Judged against the MA of the last COMPLETED week, so a day is never
  // measured against an average that includes its own week's close.
  const weekIdxByKey = new Map(weekly.map((w, i) => [w.key, i]));
  let belowCount = 0;
  let lastBelow = null;
  for (let i = breakoutIdx; i < dailyBars.length; i++) {
    const wi = weekIdxByKey.get(weekKeyOf({ t: dailyBars[i].t }));
    const maThen = wi != null && wi > 0 ? ma[wi - 1] : null;
    if (maThen != null && dailyBars[i].c < maThen) {
      belowCount++;
      lastBelow = iso(dailyBars[i].t);
    }
  }

  const journey = stageJourney(weekly, { asOfEpoch, anchorEpoch: breakout.t });

  return {
    ...journeyFlatFields(journey),
    journey,
    wyckoffCurrent,
    wyckoffPhaseHistory: phaseHistory,
    dailyClosesBelowMa: { count: belowCount, lastDate: lastBelow },
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
    const stageHere = stageFrom(weeklyBars[i].c, maNow, maPrev).stage;
    if (stageHere !== current.stage) break;
    transitionIdx = i;
  }

  const weeksInStage = weeklyBars.length - 1 - transitionIdx;
  return {
    ...current,
    transitionWeekKey: weekKeyOf(weeklyBars[transitionIdx]),
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

    // Aggressive — Spring/Shakeout inside this episode's base. Signalled
    // on the CONFIRMATION session (close back above the undercut level),
    // the same date the live screens now report. Using the low day here
    // let the backtest "know" the spring would recover before it had.
    const baseDaily = dailyBars.filter((b) => b.t >= baseStartTime && b.t < runStartTime);
    const spring = findSpring(baseDaily);
    if (spring && spring.confirm.t >= sinceEpoch) {
      results.push({
        stance: "Aggressive",
        date: iso(spring.confirm.t),
        price: spring.confirm.c,
        idx: dailyBars.indexOf(spring.confirm),
      });
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

// ---------------------------------------------------------------------
// Shared helpers added for the stage "journey": previous stage, changes
// inside the current stage, and the close that would invalidate it.
// ---------------------------------------------------------------------

function r2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

function isoDay(t) {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

const MIN_BARS_BEFORE_SPRING = 10;
const SPRING_RECOVERY_SESSIONS = 5;

/**
 * Most recent Wyckoff spring in a base: a session that undercuts the
 * lowest low the range had printed SO FAR, followed by a close back above
 * that level — on the same session or within the next five.
 *
 * Every later candidate necessarily undercuts every earlier low, so the
 * last one found is both the latest and the deepest — the Phase C test
 * that immediately precedes markup.
 *
 * Returns { low, undercut, confirm }: `low` is the bar that made the
 * spring low, `confirm` the bar whose close confirmed it (may be the same
 * bar). Null when the base has no spring.
 */
function findSpring(baseDaily) {
  let spring = null;
  let runningLow = Infinity;
  for (let i = 0; i < baseDaily.length; i++) {
    const priorLow = runningLow;
    runningLow = Math.min(runningLow, baseDaily[i].l);
    if (i < MIN_BARS_BEFORE_SPRING) continue;
    if (baseDaily[i].l >= priorLow) continue;
    let confirm = null;
    for (let k = i; k <= i + SPRING_RECOVERY_SESSIONS && k < baseDaily.length; k++) {
      if (baseDaily[k].c > priorLow) {
        confirm = baseDaily[k];
        break;
      }
    }
    if (!confirm) continue;
    spring = { low: baseDaily[i], undercut: priorLow, confirm };
  }
  return spring;
}

// A week can be extended past BLIP_MAX_WEEKS of a different stage and
// still count as the same stage "episode" — that dip is reported as an
// interruption rather than a fresh start. Longer than this and the old
// stage is considered over.
const BLIP_MAX_WEEKS = 3;
// How many past stage segments the journey path shows.
const PATH_SEGMENTS = 8;

// NSE's weekly close is Friday 15:30 IST = 10:00 UTC.
function weekCloseEpoch(bar) {
  const key = weekKeyOf(bar);
  const fri = new Date(`${key}T10:00:00Z`);
  fri.setUTCDate(fri.getUTCDate() + 4);
  return fri.getTime() / 1000;
}

function weekStartEpoch(bar) {
  return new Date(`${weekKeyOf(bar)}T00:00:00Z`).getTime() / 1000;
}

/**
 * The trading day a weekly close belongs to. Daily-derived weeks know it
 * exactly (lastT); Yahoo's native weekly bars don't, so those fall back to
 * the week's Friday, never later than the as-of date.
 */
function weekEndDate(bar, asOfEpoch) {
  if (bar.lastT) return isoDay(bar.lastT);
  let d = isoDay(weekCloseEpoch(bar));
  if (asOfEpoch) {
    const a = new Date(asOfEpoch * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    if (a < d) d = a;
  }
  return d;
}

export const STAGE_SHORT = { 1: "Stage 1", 2: "Stage 2", 3: "Stage 3", 4: "Stage 4" };

/** Weekly stage for every bar (null during the MA warm-up). */
export function weeklyStageSeries(weeklyBars) {
  const ma = ma30Series(weeklyBars);
  const stages = weeklyBars.map((w, i) => {
    const maNow = ma[i];
    const maPrev = i - SLOPE_LOOKBACK_WEEKS >= 0 ? ma[i - SLOPE_LOOKBACK_WEEKS] : null;
    if (maNow == null || maPrev == null) return null;
    return stageFrom(w.c, maNow, maPrev).stage;
  });
  return { stages, ma };
}

function toSegments(stages) {
  const segs = [];
  for (let i = 0; i < stages.length; i++) {
    const st = stages[i];
    if (st == null) continue;
    const last = segs[segs.length - 1];
    if (last && last.stage === st && last.toIdx === i - 1) last.toIdx = i;
    else segs.push({ stage: st, fromIdx: i, toIdx: i });
  }
  return segs;
}

/**
 * The close (for the week being decided) at which the stage stops being
 * what it is now, in each direction.
 *
 * The stage of a week is a function of that week's close alone once the
 * other 29 closes in the MA window are fixed, and it only changes at three
 * prices: where the close equals the MA it pulls along with it, and where
 * it pushes the 4-week MA slope across +0.5% or −0.5%. Those are solved
 * exactly, then the stage is tested just either side of each one — so the
 * levels can never disagree with classifyStage.
 *
 * "The week being decided" is the in-progress week when the latest week
 * hasn't closed yet, otherwise next week's close. Levels move a little
 * each week as the MA window rolls, so they're re-derived on every run.
 */
function stageInvalidation(weeklyBars, ma, stage, weekInProgress) {
  const closes = weeklyBars.map((w) => w.c);
  const n = closes.length;
  const j = weekInProgress ? n - 1 : n;
  if (j - (MA_WEEKS - 1) < 0 || j - SLOPE_LOOKBACK_WEEKS < 0) return null;
  const ma4 = ma[j - SLOPE_LOOKBACK_WEEKS];
  if (ma4 == null) return null;
  const S = closes.slice(j - (MA_WEEKS - 1), j).reduce((a, b) => a + b, 0);
  const stageAtClose = (c) => stageFrom(c, (S + c) / MA_WEEKS, ma4).stage;

  const lines = [
    { price: S / (MA_WEEKS - 1), reason: "the 30-week MA" },
    { price: MA_WEEKS * (1 + FLAT_SLOPE_PCT / 100) * ma4 - S, reason: `the MA's 4-week slope crossing +${FLAT_SLOPE_PCT}%` },
    { price: MA_WEEKS * (1 - FLAT_SLOPE_PCT / 100) * ma4 - S, reason: `the MA's 4-week slope crossing −${FLAT_SLOPE_PCT}%` },
  ].filter((l) => l.price > 0);

  const ref = closes[n - 1];
  const EPS = 1e-6;
  const downExits = [];
  const upExits = [];
  for (const l of lines) {
    const below = stageAtClose(l.price * (1 - EPS));
    const above = stageAtClose(l.price * (1 + EPS));
    if (above === stage && below !== stage) downExits.push({ ...l, becomes: below });
    if (below === stage && above !== stage) upExits.push({ ...l, becomes: above });
  }
  const pct = (p) => r2(((p - ref) / ref) * 100);
  const fmtExit = (e, dir) =>
    e && {
      price: r2(e.price),
      becomes: e.becomes,
      becomesLabel: WEINSTEIN_STAGE_INFO[e.becomes].name,
      pctFromClose: pct(e.price),
      rule: `Weekly close ${dir === "down" ? "below" : "above"} ₹${r2(e.price)} → ${WEINSTEIN_STAGE_INFO[e.becomes].name} (${e.reason})`,
    };

  const curAtRef = stageAtClose(ref);
  const down = downExits.filter((e) => e.price <= ref).sort((a, b) => b.price - a.price)[0] ?? null;
  const up = upExits.filter((e) => e.price >= ref).sort((a, b) => a.price - b.price)[0] ?? null;

  // If even an unchanged close would flip the stage (the MA is about to
  // roll over / turn up on its own), say so — that's the most urgent case.
  let atRisk = null;
  if (curAtRef !== stage) {
    const keepAbove = upExits.length ? null : downExits.filter((e) => e.price > ref).sort((a, b) => a.price - b.price)[0];
    const keepBelow = downExits.length ? null : upExits.filter((e) => e.price < ref).sort((a, b) => b.price - a.price)[0];
    atRisk = {
      becomes: curAtRef,
      becomesLabel: WEINSTEIN_STAGE_INFO[curAtRef].name,
      keepAbove: keepAbove ? r2(keepAbove.price) : null,
      keepBelow: keepBelow ? r2(keepBelow.price) : null,
    };
  }

  const fd = fmtExit(down, "down");
  const fu = fmtExit(up, "up");
  const nearest =
    fd && fu ? (Math.abs(fd.pctFromClose) <= Math.abs(fu.pctFromClose) ? fd : fu) : fd ?? fu ?? null;

  return {
    basis: weekInProgress ? "this week's close" : "next week's close",
    refClose: r2(ref),
    ma30: r2(ma[n - 1]),
    down: fd,
    up: fu,
    nearest,
    atRisk,
  };
}

/**
 * The stock's stage "journey": what it is now, what it was before, and
 * every time it left the current stage and came back.
 *
 * Where the current stage started: walk back through the strict
 * week-by-week segments, folding in excursions of BLIP_MAX_WEEKS or fewer
 * that returned to the same stage. Those excursions become the
 * interruptions; a longer one ends the episode and becomes the previous
 * stage.
 *
 * Every screen and the stock page use this same rule. An earlier version
 * started the Stage 2 / Wyckoff journey at the breakout instead, and that
 * broke on exactly the case it was meant to show: a one-week close under
 * the MA resets the Stage 2 screen's run, so the "new" breakout came AFTER
 * the dip and the dip was reported as the previous stage rather than an
 * interruption. `anchorEpoch` (the breakout) is now only reported back as
 * `breakoutInsideEpisode`, so the UI can say where "Days in St.2" starts.
 *
 * `streak` is the plain unbroken run (what the Weinstein screen's
 * "entering" test uses), kept so both views stay visible.
 */
export function stageJourney(weeklyBars, { asOfEpoch = null, anchorEpoch = null } = {}) {
  if (!weeklyBars?.length) return null;
  const { stages, ma } = weeklyStageSeries(weeklyBars);
  const n = weeklyBars.length;
  const cur = stages[n - 1];
  if (cur == null) return null;
  const segs = toSegments(stages);
  const firstClassified = segs[0].fromIdx;

  let startIdx;
  let mergedBlips = false;
  {
    let k = segs.length - 1;
    startIdx = segs[k].fromIdx;
    while (k > 0) {
      let jx = k - 1;
      let blipWeeks = 0;
      while (jx >= 0 && segs[jx].stage !== cur) {
        blipWeeks += segs[jx].toIdx - segs[jx].fromIdx + 1;
        jx--;
      }
      if (jx < 0 || blipWeeks > BLIP_MAX_WEEKS) break;
      startIdx = segs[jx].fromIdx;
      mergedBlips = true;
      k = jx;
    }
  }

  const describe = (seg) => ({
    stage: seg.stage,
    label: WEINSTEIN_STAGE_INFO[seg.stage].name,
    tone: WEINSTEIN_STAGE_INFO[seg.stage].tone,
    from: weekEndDate(weeklyBars[seg.fromIdx], asOfEpoch),
    to: weekEndDate(weeklyBars[seg.toIdx], asOfEpoch),
    weekOf: weekKeyOf(weeklyBars[seg.fromIdx]),
    weeks: seg.toIdx - seg.fromIdx + 1,
    // The first segment may have started before the data does.
    openStart: seg.fromIdx === firstClassified,
    ongoing: seg.toIdx === n - 1,
  });

  const interruptions = segs
    .filter((sg) => sg.fromIdx >= startIdx && sg.stage !== cur)
    .map(describe);

  const prevSeg = [...segs].reverse().find((sg) => sg.toIdx < startIdx && sg.stage !== cur);
  const lastSeg = segs[segs.length - 1];

  const weekInProgress = (asOfEpoch ?? Date.now() / 1000) < weekCloseEpoch(weeklyBars[n - 1]);

  return {
    stage: cur,
    stageLabel: WEINSTEIN_STAGE_INFO[cur].name,
    weekInProgress,
    episode: {
      enteredOn: weekEndDate(weeklyBars[startIdx], asOfEpoch),
      weekOf: weekKeyOf(weeklyBars[startIdx]),
      weeks: n - startIdx,
      // True when the episode began before the breakout the Stage 2 screen
      // counts its days from (e.g. the screen re-based after a short dip).
      breakoutInsideEpisode:
        anchorEpoch != null && anchorEpoch > weekStartEpoch(weeklyBars[startIdx]) + 7 * 86400,
      mergedBlips,
      openStart: startIdx === firstClassified,
    },
    streak: {
      enteredOn: weekEndDate(weeklyBars[lastSeg.fromIdx], asOfEpoch),
      weekOf: weekKeyOf(weeklyBars[lastSeg.fromIdx]),
      weeks: lastSeg.toIdx - lastSeg.fromIdx + 1,
    },
    previousStage: prevSeg ? describe(prevSeg) : null,
    interruptions,
    path: segs.slice(-PATH_SEGMENTS).map(describe),
    invalidation: stageInvalidation(weeklyBars, ma, cur, weekInProgress),
  };
}

/** Flat, sortable copies of the journey fields for screener tables. */
export function journeyFlatFields(journey) {
  return {
    prevStage: journey?.previousStage?.stage ?? null,
    stageChangeCount: journey ? journey.interruptions.length : null,
    invalidationPrice: journey?.invalidation?.nearest?.price ?? null,
  };
}
