// "Reclaim" detection: price dipped below its 30-week moving average and
// closed back above it. Two variants, which are genuinely different events
// and so are reported separately.
//
// WHICH 30-WEEK MA: this uses the real 30-week MA — the average of the last
// 30 COMPLETED weekly closes — and compares daily bars against it. Some
// platforms approximate it on a daily chart as a 150-day SMA instead. The
// two track closely but aren't identical, and the rest of this app (see
// lib/wma.js, the 30WMA column everywhere) already uses the weekly-close
// definition, so this stays consistent with that rather than introducing a
// second, subtly different "30WMA" into the same UI.
//
// AVOIDING LOOKAHEAD: the MA in force at any moment is computed from weeks
// that had already CLOSED at that moment. The current, still-forming week's
// own close is never folded into the MA that judges it — otherwise the
// signal would partly depend on the very bar it's evaluating.

import { toWeeklyBars } from "@/lib/screenerIndicators";

export const MA_WEEKS = 30;

function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
}

/**
 * MA value in force DURING week index `i` — the mean of the 30 weekly
 * closes strictly before it. Returns null until there's enough history.
 */
function maDuringWeek(weeklyCloses, i) {
  const start = i - MA_WEEKS;
  if (start < 0) return null;
  return mean(weeklyCloses.slice(start, i));
}

/**
 * Both reclaim conditions for one symbol.
 *
 * `dailyBars` is oldest-first OHLCV (see lib/screenerIndicators.js).
 * Returns null when there isn't enough history or neither condition fires.
 */
export function analyzeReclaim(dailyBars) {
  if (!dailyBars || dailyBars.length < 40) return null;

  const weekly = toWeeklyBars(dailyBars);
  if (weekly.length < MA_WEEKS + 2) return null;
  const weeklyCloses = weekly.map((w) => w.c);

  // Week index for a given daily bar, by matching the ISO-week key that
  // toWeeklyBars assigns. Built once as a lookup rather than searched per
  // bar.
  const weekKeyToIndex = new Map(weekly.map((w, i) => [w.key, i]));
  function weekIndexOf(bar) {
    const d = new Date(bar.t * 1000);
    const monday = new Date(d);
    const dow = (monday.getUTCDay() + 6) % 7;
    monday.setUTCDate(monday.getUTCDate() - dow);
    return weekKeyToIndex.get(monday.toISOString().slice(0, 10)) ?? null;
  }

  const today = dailyBars[dailyBars.length - 1];
  const prev = dailyBars[dailyBars.length - 2];

  // ---- Condition 1: daily reclaim -------------------------------------
  // Yesterday CLOSED below the 30-week MA; today CLOSED back above it.
  let daily = null;
  const iToday = weekIndexOf(today);
  const iPrev = weekIndexOf(prev);
  if (iToday != null && iPrev != null) {
    const maToday = maDuringWeek(weeklyCloses, iToday);
    const maPrev = maDuringWeek(weeklyCloses, iPrev);
    if (maToday != null && maPrev != null && prev.c < maPrev && today.c > maToday) {
      daily = {
        maPrev: Math.round(maPrev * 100) / 100,
        maToday: Math.round(maToday * 100) / 100,
        prevClose: Math.round(prev.c * 100) / 100,
        close: Math.round(today.c * 100) / 100,
        // How far above the MA it closed — a bigger number is a more
        // decisive reclaim than a close sitting right on the line.
        abovePct: Math.round(((today.c - maToday) / maToday) * 10000) / 100,
      };
    }
  }

  // ---- Condition 2: weekly reclaim ------------------------------------
  // The current week TRADED below the 30-week MA at some point (its low
  // pierced the line) but CLOSED the week back above it. On a mid-week
  // day this reads as "so far this week", which is the live version of
  // the same signal.
  let weeklyHit = null;
  const iCur = weekly.length - 1;
  const maCur = maDuringWeek(weeklyCloses, iCur);
  const curWeek = weekly[iCur];
  if (maCur != null && curWeek.l < maCur && curWeek.c > maCur) {
    weeklyHit = {
      ma: Math.round(maCur * 100) / 100,
      weekLow: Math.round(curWeek.l * 100) / 100,
      weekClose: Math.round(curWeek.c * 100) / 100,
      // How deep the dip went below the line before recovering.
      dipPct: Math.round(((curWeek.l - maCur) / maCur) * 10000) / 100,
      abovePct: Math.round(((curWeek.c - maCur) / maCur) * 10000) / 100,
      weekStart: curWeek.key,
      // A week is only complete once its Friday has printed; before then
      // the close is provisional and the signal can still be lost.
      weekInProgress: new Date(today.t * 1000).getUTCDay() !== 5,
    };
  }

  if (!daily && !weeklyHit) return null;

  const which = daily && weeklyHit ? "both" : daily ? "daily" : "weekly";
  return {
    reclaimType: which,
    reclaimLabel:
      which === "both"
        ? "Both"
        : which === "daily"
        ? "Daily reclaim"
        : "Weekly reclaim",
    // One sortable "how decisive was it" figure for the table column.
    // When both conditions fired these are usually within a whisker of
    // each other (same MA, same latest close); the daily one is preferred
    // because it's the more precisely-dated of the two.
    reclaimAbovePct: daily ? daily.abovePct : weeklyHit.abovePct,
    daily,
    weekly: weeklyHit,
    ma30Now: Math.round((maDuringWeek(weeklyCloses, weekly.length - 1) ?? 0) * 100) / 100,
  };
}

/**
 * Cheap, deliberately LOOSE pre-filter on weekly bars, used to decide
 * whether a stock is worth fetching full daily history for. Anything
 * trading within 12% of its 30-week MA is a possible reclaim candidate;
 * a stock 40% above or below it plainly isn't. As with the Stage 2
 * pre-filter, a false positive costs one wasted fetch while a false
 * negative costs a missed stock, so this errs toward including.
 */
export function mightReclaim(weeklyBars) {
  if (!weeklyBars || weeklyBars.length < MA_WEEKS + 2) return false;
  const closes = weeklyBars.map((w) => w.c);
  const i = closes.length - 1;
  const ma = mean(closes.slice(i - MA_WEEKS, i));
  if (ma == null || ma <= 0) return false;
  const last = weeklyBars[i];
  // Either the close is near the line, or the week's range straddles it.
  const nearLine = Math.abs(last.c - ma) / ma < 0.12;
  const straddles = last.l <= ma && last.h >= ma;
  return nearLine || straddles;
}
