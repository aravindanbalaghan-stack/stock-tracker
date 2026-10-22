// "Personal learning" screen — all four conditions judged on WEEKLY bars:
//
//   1. RSI(14) > 50 (Wilder's smoothing, the standard RSI)
//   2. Weekly close above the 30-week simple moving average
//   3. A bullish candlestick pattern on this week's or last week's candle
//      (see lib/candlePatterns.js). Reported for every stock; the UI
//      decides whether to require it.
//   4. Relative Strength above its 0 line, or crossing it from below.
//      RS = (stock / stock 52 weeks ago) ÷ (NIFTY 500 / NIFTY 500 52 weeks
//      ago) − 1, the popular "Relative Strength" indicator. Above 0 = the
//      stock has outperformed the NIFTY 500 over the period. NIFTY 500 rather
//      than NIFTY 50 because the screen scans ~500 stocks across large, mid
//      and small caps — beating the broad market is the fairer test for a
//      mid or small cap than beating 50 large caps. "Crossing from below" ends above
//      0 by definition, so the test is RS > 0 — and a stock whose RS was at
//      or below 0 within the last few weeks is tagged as a fresh crossover,
//      since that's the more interesting moment.
//
// The latest weekly bar may be a week still in progress; its candle and
// readings are provisional until Friday's close, and are flagged as such.

import { weekKeyOf } from "@/lib/stageAnalysis";
import { bullishPatternsAt } from "@/lib/candlePatterns";

export const PL = {
  rsiPeriod: 14,
  rsiMin: 50,
  maWeeks: 30,
  rsPeriod: 52,
  freshCrossWeeks: 8, // how far back a 0-line crossover still counts as "fresh"
  // Relative Strength benchmark. ^CRSLDX is Yahoo's symbol for NIFTY 500.
  benchmark: { symbol: "^CRSLDX", label: "NIFTY 500" },
};

function r2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

/** One bar per IST week — Yahoo occasionally returns two for the latest week. */
export function dedupeWeekly(raw) {
  const byKey = new Map();
  for (const b of raw) {
    const k = weekKeyOf(b);
    const prev = byKey.get(k);
    byKey.set(
      k,
      prev
        ? { ...b, key: k, o: prev.o ?? b.o, h: Math.max(prev.h, b.h), l: Math.min(prev.l, b.l), v: Math.max(prev.v ?? 0, b.v ?? 0) }
        : { ...b, key: k }
    );
  }
  return [...byKey.values()];
}

/** Wilder RSI series (null until enough bars). */
export function rsiSeries(closes, n = PL.rsiPeriod) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function weekCloseEpoch(key) {
  const fri = new Date(`${key}T10:00:00Z`); // Friday 15:30 IST
  fri.setUTCDate(fri.getUTCDate() + 4);
  return fri.getTime() / 1000;
}

/**
 * Returns the readings for one stock, or null if there isn't enough
 * history. `passes` says whether conditions 1, 2 and 4 hold; `patterns`
 * carries condition 3 separately.
 */
export function analyzePersonalLearning(rawWeekly, benchByKey, { asOfEpoch } = {}) {
  if (!rawWeekly?.length) return null;
  const bars = dedupeWeekly(rawWeekly);
  const n = bars.length;
  if (n < PL.rsPeriod + 2 || n < PL.maWeeks + 1) return null;
  const closes = bars.map((b) => b.c);
  const last = bars[n - 1];

  const rsi = rsiSeries(closes)[n - 1];
  const ma = closes.slice(n - PL.maWeeks).reduce((a, b) => a + b, 0) / PL.maWeeks;

  const rsAt = (i) => {
    if (i - PL.rsPeriod < 0) return null;
    const nNow = benchByKey.get(bars[i].key);
    const nThen = benchByKey.get(bars[i - PL.rsPeriod].key);
    if (!nNow || !nThen || !(closes[i - PL.rsPeriod] > 0)) return null;
    return closes[i] / closes[i - PL.rsPeriod] / (nNow / nThen) - 1;
  };
  const rs = rsAt(n - 1);

  // Most recent upward crossing of the 0 line, if within freshCrossWeeks.
  let crossedWeeksAgo = null;
  if (rs != null && rs > 0) {
    for (let j = 0; j < PL.freshCrossWeeks; j++) {
      const now = rsAt(n - 1 - j);
      const before = rsAt(n - 2 - j);
      if (now == null || before == null) break;
      if (now > 0 && before <= 0) {
        crossedWeeksAgo = j;
        break;
      }
      if (now <= 0) break;
    }
  }

  const weekInProgress = (asOfEpoch ?? Date.now() / 1000) < weekCloseEpoch(last.key);
  const patterns = [];
  for (const p of bullishPatternsAt(bars, n - 1)) {
    patterns.push({ ...p, when: weekInProgress ? "This week (forming)" : "This week", weeksAgo: 0, provisional: weekInProgress });
  }
  for (const p of bullishPatternsAt(bars, n - 2)) {
    if (patterns.some((x) => x.name === p.name)) continue;
    patterns.push({ ...p, when: weekInProgress ? "Last completed week" : "Last week", weeksAgo: 1, provisional: false });
  }

  const cond = {
    rsi: rsi != null && rsi > PL.rsiMin,
    aboveMa: last.c > ma,
    rs: rs != null && rs > 0,
    pattern: patterns.length > 0,
  };

  return {
    close: last.c,
    weekKey: last.key,
    weekInProgress,
    rsiWeekly: r2(rsi),
    wma30: r2(ma),
    pctAboveWma: r2(((last.c - ma) / ma) * 100),
    rsWeekly: rs != null ? Math.round(rs * 10000) / 10000 : null,
    rsCrossedWeeksAgo: crossedWeeksAgo,
    patterns,
    patternCount: patterns.length,
    cond,
    passes: cond.rsi && cond.aboveMa && cond.rs,
  };
}
