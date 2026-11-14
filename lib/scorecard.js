// Grades screener picks by what happened next.
//
// A "signal" is (stock, session): the screen flagged it at that session's
// close. Its return over N sessions is close(t+N) / close(t) − 1, using
// split-adjusted closes from the market panel — so it's the return of
// buying at the close the day the screen showed it and holding N sessions.
// No stops, no costs.
//
// The benchmark for each signal is the equal-weight return of the 500 most
// traded stocks over the same N sessions, so "excess" asks: did the
// screen beat simply owning the market?
//
// "Fresh only" (the default) counts a stock once when it first appears,
// not again on every day it stays in the screen — otherwise a stock that
// sat in a screen for 30 days would count 30 times.

import { benchmarkForward, universeRows } from "@/lib/marketPanel";

export const HORIZONS = [5, 10, 20];
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Summary stats for one horizon from graded rows {ret, excess}. */
export function summarise(rows) {
  const g = rows.filter((r) => r.ret != null);
  if (!g.length) return { n: 0 };
  const rets = g.map((r) => r.ret);
  const ex = g.filter((r) => r.excess != null).map((r) => r.excess);
  return {
    n: g.length,
    winRate: r2((g.filter((r) => r.ret > 0).length / g.length) * 100),
    avg: r2(rets.reduce((a, b) => a + b, 0) / g.length),
    median: r2(median(rets)),
    avgExcess: ex.length ? r2(ex.reduce((a, b) => a + b, 0) / ex.length) : null,
    beatRate: ex.length ? r2((ex.filter((x) => x > 0).length / ex.length) * 100) : null,
    best: r2(Math.max(...rets)),
    worst: r2(Math.min(...rets)),
  };
}

export function makeBench(panel) {
  const rows = universeRows(panel, "top500");
  const memo = new Map();
  return (t, n) => {
    const k = `${t}:${n}`;
    if (!memo.has(k)) memo.set(k, benchmarkForward(panel, rows, t, n));
    return memo.get(k);
  };
}

/**
 * signalsByT: Map(sessionIndex → Set(symbols)) — the screen's picks per
 * session (already restricted to sessions in the panel).
 * Returns { stats: {5:{…},10:{…},20:{…}}, signals: [...newest first], open }
 */
export function gradeSignals(panel, signalsByT, { fresh = true, bench = makeBench(panel), sinceT = 0 } = {}) {
  const T = panel.dates.length;
  const ts = [...signalsByT.keys()].sort((a, b) => a - b);
  const signals = [];
  let prevSet = null;
  let prevT = -Infinity;
  for (const t of ts) {
    const set = signalsByT.get(t);
    // "Already showing" only if it was in the screen within the last few
    // sessions — a stock that drops out and comes back weeks later is a
    // new signal. (A few sessions' grace covers days the screen didn't run.)
    const recent = t - prevT <= 3 ? prevSet : null;
    if (t >= sinceT) {
      for (const sym of set) {
        if (fresh && recent?.has(sym)) continue;
        const i = panel.idx.get(sym);
        if (i == null) continue;
        const entry = panel.c[i][t];
        if (!Number.isFinite(entry) || entry <= 0) continue;
        const row = { date: panel.dates[t], symbol: sym, entry: r2(entry) };
        for (const n of HORIZONS) {
          const x = t + n < T ? panel.c[i][t + n] : NaN;
          const ret = Number.isFinite(x) ? ((x / entry - 1) * 100) : null;
          const b = ret != null ? bench(t, n) : null;
          row[`ret${n}`] = r2(ret);
          row[`excess${n}`] = ret != null && b != null ? r2(ret - b) : null;
        }
        signals.push(row);
      }
    }
    prevSet = set;
    prevT = t;
  }
  const stats = {};
  for (const n of HORIZONS) stats[n] = summarise(signals.map((s) => ({ ret: s[`ret${n}`], excess: s[`excess${n}`] })));
  const open = signals.filter((s) => s.ret5 == null).length;
  signals.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.symbol.localeCompare(b.symbol)));
  return { stats, signals, open };
}

/** Converts a { date: [symbols] } log into Map(t → Set) for the panel's sessions. */
export function logToT(panel, log) {
  const tOf = new Map(panel.dates.map((d, t) => [d, t]));
  const out = new Map();
  for (const [d, syms] of Object.entries(log ?? {})) {
    const t = tOf.get(d);
    if (t != null && Array.isArray(syms)) out.set(t, new Set(syms));
  }
  return out;
}
