// Shakeout — stocks that have just "kicked out the weak hands" and are
// setting up for the next leg higher.
//
// THE PATTERN
// A stock in an uptrend builds a level that everyone can see — the low of
// its base, or its 50-day moving average. Stops cluster just under it. The
// shakeout is a quick break BELOW that level: stops trigger, nervous
// holders sell, the chart looks broken. Then, within a few sessions, price
// closes back ABOVE the level. Supply from weak hands has been absorbed by
// stronger buyers, and the overhead supply that would have capped a rally
// is gone. This is the same idea as Wyckoff's Spring, Minervini's
// "undercut & rally" and O'Neil's shakeout.
//
// HOW IT DIFFERS FROM THE WYCKOFF TAB
// The Wyckoff tab only looks for a Spring inside the base BEFORE a Stage 2
// breakout. This screen also catches shakeouts during the trend (a flush
// through the 50 DMA after a breakout), weighs the evidence with volume
// and NSE delivery %, and only keeps setups that are still "loaded" —
// holding above the level and not yet run away from it.
//
// HARD RULES (fail any → not listed)
//   Trend      close above a rising (or flat) 200 DMA
//   Level      either
//                Base low — the lowest low of the prior 60 sessions, set at
//                least 5 sessions before the shakeout and untouched since
//                50 DMA   — a stock that closed above its 50 DMA on at least
//                15 of the 20 sessions before the shakeout
//   Shakeout   within the last 15 sessions, the day's low broke the level
//              by 0.5%–10% (deeper than 10% is a breakdown, not a shakeout)
//   Reclaim    a close back above the level within 3 sessions of the break
//              (same session counts — an intraday spring)
//   Holding    no close below the level since the reclaim, and no lower low
//              than the shakeout low
//   Not gone   close no more than 15% above the level, and no more than 5%
//              above the base high (pivot) — past that the move has started
//   Base       base depth (pivot high to level) no more than 35%
//
// A stock that broke the level in the last 3 sessions and hasn't reclaimed
// yet is listed separately as "Undercut — watch for reclaim": the shakeout
// may be happening right now, but until it closes back above the level it
// can't be told apart from a real breakdown.
//
// EVIDENCE (scored, out of 7 — never used to drop a row)
//   1 Panic volume on the break            ≥ 1.5× the 50-day average
//   2 Demand on the reclaim                reclaim-day volume ≥ 1.2× average
//   3 Strong reclaim close                 upper 40% of that day's range
//   4 Quick reclaim                        within 1 session of the break
//   5 Delivery shift                       reclaim-day delivery % above the
//                                          shakeout day's AND above its own
//                                          30-session average (bhavcopy)
//   6 Supply dried up                      volume since the reclaim below
//                                          0.8× average (needs 2+ sessions)
//   7 Near the pivot                       close within 10% of the base high

import { sma } from "@/lib/screenerIndicators";
import { istDateOf } from "@/lib/yahooFinance";

export const SK = {
  recentSessions: 15,
  watchSessions: 3,
  baseLookback: 60,
  supportAgeMin: 5,
  minUndercutPct: 0.5,
  maxUndercutPct: 10,
  maxReclaimSessions: 3,
  maxBaseDepthPct: 35,
  maxAboveLevelPct: 15,
  maxAbovePivotPct: 5,
  maRespectSessions: 20,
  maRespectMin: 15,
  ev: { panicVol: 1.5, reclaimVol: 1.2, closeInRange: 60, dryUp: 0.8, nearPivotPct: 10 },
};

const pct = (a, b) => ((a - b) / b) * 100;
const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/**
 * Cheap bhavcopy pre-filter (31-session window). Passes any stock that, in
 * the last 15 sessions, made a 10-session low and is now trading back
 * above — or within 10% below — the low it broke. Every base-low shakeout
 * satisfies this (a break of a 60-session low is also a break of the
 * 10-session low), and most 50-DMA flushes in an uptrend do too.
 */
export function shakeoutPrefilter(series) {
  if (!series || series.length < 22) return false;
  const last = series.length - 1;
  const today = series[last];
  if (today.close == null || today.close < 20) return false;

  let turnover = 0;
  let n = 0;
  for (let i = Math.max(0, last - 19); i <= last; i++) {
    if (series[i].close != null && series[i].volume) {
      turnover += series[i].close * series[i].volume;
      n++;
    }
  }
  if (!n || turnover / n / 1e7 < 2) return false; // ₹2 Cr average daily turnover

  for (let s = last; s >= Math.max(10, last - SK.recentSessions + 1); s--) {
    let priorMin = Infinity;
    for (let k = s - 10; k < s; k++) if (series[k].low != null) priorMin = Math.min(priorMin, series[k].low);
    if (!Number.isFinite(priorMin) || series[s].low == null) continue;
    if (series[s].low < priorMin * (1 - SK.minUndercutPct / 100) && today.close >= priorMin * 0.9) return true;
  }
  return false;
}

// Yahoo bars up to (not including) the as-of date, plus the as-of session
// from the bhavcopy so the latest day matches every other column.
function buildDaily(bars, today, todayDate) {
  const out = [];
  for (const b of bars) {
    const d = istDateOf(b.t);
    if (d >= todayDate) break;
    out.push({ date: d, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 });
  }
  out.push({ date: todayDate, o: today.open, h: today.high, l: today.low, c: today.close, v: today.volume ?? 0 });
  return out;
}

function smaAt(closes, period, idx) {
  if (idx + 1 < period) return null;
  return sma(closes.slice(0, idx + 1), period);
}

function findEvent(d, closes, kind) {
  const n = d.length - 1;
  for (let s = n; s >= n - SK.recentSessions + 1; s--) {
    let level;
    let pivot;
    let baseLow;

    if (kind === "base") {
      const from = s - SK.baseLookback;
      const to = s - SK.supportAgeMin; // level must be at least this old
      if (from < 0) return null;
      level = Infinity;
      for (let k = from; k <= to; k++) level = Math.min(level, d[k].l);
      // ...and untouched between when it was set and the shakeout.
      let held = true;
      for (let k = to + 1; k < s; k++) if (d[k].l < level) held = false;
      if (!held) continue;
      pivot = -Infinity;
      for (let k = from; k < s; k++) pivot = Math.max(pivot, d[k].h);
      baseLow = level;
    } else {
      const ma = smaAt(closes, 50, s);
      if (ma == null) return null;
      let above = 0;
      for (let k = s - SK.maRespectSessions; k < s; k++) {
        const m = smaAt(closes, 50, k);
        if (m != null && d[k].c > m) above++;
      }
      if (above < SK.maRespectMin) continue;
      // The undercut has to START at s — yesterday must have been above.
      const maPrev = smaAt(closes, 50, s - 1);
      if (maPrev == null || d[s - 1].l < maPrev) continue;
      level = ma;
      pivot = -Infinity;
      baseLow = Infinity;
      for (let k = Math.max(0, s - 30); k < s; k++) {
        pivot = Math.max(pivot, d[k].h);
        baseLow = Math.min(baseLow, d[k].l);
      }
    }

    const undercutPct = pct(level, d[s].l);
    if (undercutPct < SK.minUndercutPct || undercutPct > SK.maxUndercutPct) continue;
    const depthPct = ((pivot - Math.min(baseLow, level)) / pivot) * 100;
    if (depthPct > SK.maxBaseDepthPct) continue;

    const levelAt = (k) => (kind === "base" ? level : smaAt(closes, 50, k) ?? level);

    // Reclaim: first close back above the level within the allowed window.
    let r = -1;
    for (let k = s; k <= Math.min(n, s + SK.maxReclaimSessions); k++) {
      if (d[k].c > levelAt(k)) {
        r = k;
        break;
      }
    }

    // Lowest low from the shakeout through today — the shakeout low.
    let shakeLowIdx = s;
    for (let k = s; k <= n; k++) if (d[k].l < d[shakeLowIdx].l) shakeLowIdx = k;

    if (r === -1) {
      // Not reclaimed. Only interesting while it's still fresh and the
      // break hasn't gone deeper than a shakeout would.
      if (n - s >= SK.watchSessions) continue;
      if (pct(level, d[shakeLowIdx].l) > SK.maxUndercutPct) continue;
      return { kind, s, r: -1, level, pivot, shakeLowIdx, watch: true };
    }

    // Holding: the deepest point must come before the reclaim, and no
    // close below the level since.
    if (shakeLowIdx > r) continue;
    let holding = true;
    for (let k = r + 1; k <= n; k++) if (d[k].c < levelAt(k)) holding = false;
    if (!holding) continue;

    return { kind, s, r, level, pivot, shakeLowIdx, watch: false };
  }
  return null;
}

/**
 * Full check for one symbol. `bars` — Yahoo daily bars (oldest-first,
 * truncated to the as-of date). `series` — the bhavcopy rows for the same
 * symbol (for delivery %). Returns null or the row fields.
 */
export function analyzeShakeout({ bars, series, todayDate }) {
  const today = series?.[series.length - 1];
  if (!bars?.length || !today || today.close == null) return null;
  const d = buildDaily(bars, today, todayDate);
  if (d.length < 230) return null;
  const n = d.length - 1;
  const closes = d.map((b) => b.c);

  // Trend
  const sma200 = sma(closes, 200);
  const sma200Prior = sma(closes.slice(0, -20), 200);
  if (sma200 == null || sma200Prior == null) return null;
  if (!(d[n].c > sma200) || sma200 < sma200Prior * 0.995) return null;

  // Prefer the base-low version when both fire — it's the classic pattern
  // and its level doesn't drift.
  const ev = findEvent(d, closes, "base") ?? findEvent(d, closes, "ma50");
  if (!ev) return null;

  const levelNow = ev.kind === "base" ? ev.level : sma(closes, 50);
  const close = d[n].c;
  if (!ev.watch) {
    if (pct(close, levelNow) > SK.maxAboveLevelPct) return null;
    if (pct(close, ev.pivot) > SK.maxAbovePivotPct) return null;
  }

  const avgVol50 = mean(d.slice(Math.max(0, ev.s - 50), ev.s).map((b) => b.v).filter((v) => v > 0));
  const shake = d[ev.s];
  const shakeLow = d[ev.shakeLowIdx];

  // Delivery % from the bhavcopy window.
  const delByDate = new Map(series.map((x) => [x.date, x.deliveryPct]));
  const delVals = series.map((x) => x.deliveryPct).filter((v) => v != null);
  const avgDel = mean(delVals);
  const shakeDel = delByDate.get(shake.date) ?? null;

  const checks = [];
  const add = (key, label, pass, detail) => checks.push({ key, label, pass, detail });

  const shakeVolRatio = avgVol50 ? Math.max(...d.slice(ev.s, ev.r === -1 ? n + 1 : ev.r + 1).map((b) => b.v)) / avgVol50 : null;
  add("panic", "Panic volume on the break", shakeVolRatio != null && shakeVolRatio >= SK.ev.panicVol,
    shakeVolRatio != null ? `${shakeVolRatio.toFixed(1)}× average volume during the undercut` : "no volume history");

  let reclaimDel = null;
  if (!ev.watch) {
    const rc = d[ev.r];
    const rVolRatio = avgVol50 ? rc.v / avgVol50 : null;
    add("demand", "Demand on the reclaim", rVolRatio != null && rVolRatio >= SK.ev.reclaimVol,
      rVolRatio != null ? `${rVolRatio.toFixed(1)}× average volume on ${rc.date}` : "no volume history");

    const range = rc.h - rc.l;
    const cir = range > 0 ? ((rc.c - rc.l) / range) * 100 : 100;
    add("close", "Strong reclaim close", cir >= SK.ev.closeInRange, `closed at ${Math.round(cir)}% of the day's range`);

    const sessions = ev.r - ev.s;
    add("quick", "Quick reclaim", sessions <= 1,
      sessions === 0 ? "closed back above the same session" : `took ${sessions} session${sessions === 1 ? "" : "s"}`);

    reclaimDel = delByDate.get(rc.date) ?? null;
    const delPass = reclaimDel != null && shakeDel != null && avgDel != null && reclaimDel > shakeDel && reclaimDel >= avgDel;
    add("delivery", "Delivery shift to strong hands", delPass,
      reclaimDel != null && shakeDel != null
        ? `delivery ${shakeDel.toFixed(0)}% on the break → ${reclaimDel.toFixed(0)}% on the reclaim (30-session avg ${avgDel?.toFixed(0) ?? "—"}%)`
        : "delivery % not available for those sessions");

    const after = d.slice(ev.r + 1).map((b) => b.v);
    const dry = after.length >= 2 && avgVol50 ? mean(after) / avgVol50 : null;
    add("dryup", "Supply dried up since", dry != null && dry < SK.ev.dryUp,
      dry != null ? `${dry.toFixed(2)}× average volume since the reclaim` : "too few sessions since the reclaim to judge");
  }

  const toPivotPct = pct(ev.pivot, close);
  add("pivot", "Near the pivot", toPivotPct <= SK.ev.nearPivotPct,
    toPivotPct > 0 ? `${toPivotPct.toFixed(1)}% below the ₹${r2(ev.pivot)} base high` : `above the ₹${r2(ev.pivot)} base high`);

  const strength = checks.filter((c) => c.pass).length;
  const strengthOf = checks.length;
  const grade = ev.watch ? "Watch" : strength >= 5 ? "A" : strength >= 3 ? "B" : "C";
  const status = ev.watch ? "Undercut — watch for reclaim" : "Reclaimed";

  const levelLabel = ev.kind === "base" ? "Base low" : "50 DMA";
  const reason = ev.watch
    ? `Broke the ₹${r2(ev.level)} ${levelLabel.toLowerCase()} on ${shake.date} (low ₹${r2(shakeLow.l)}) and hasn't closed back above it yet.`
    : `Undercut the ₹${r2(ev.level)} ${levelLabel.toLowerCase()} on ${shake.date} to ₹${r2(shakeLow.l)}, closed back above on ${d[ev.r].date}, and has held since.`;

  return {
    skStatus: status,
    skGrade: grade,
    skLevelType: levelLabel,
    skLevel: r2(ev.kind === "base" ? ev.level : levelNow),
    skShakeoutDate: shake.date,
    skShakeoutLow: r2(shakeLow.l),
    skUndercutPct: r2(pct(ev.level, shakeLow.l)),
    skReclaimDate: ev.watch ? null : d[ev.r].date,
    skSessionsToReclaim: ev.watch ? null : ev.r - ev.s,
    skSessionsSinceReclaim: ev.watch ? null : n - ev.r,
    skPivot: r2(ev.pivot),
    skToPivotPct: r2(toPivotPct),
    skAboveLevelPct: r2(pct(close, levelNow)),
    skStop: r2(shakeLow.l),
    skRiskPct: r2(pct(close, shakeLow.l)),
    skShakeDelivery: shakeDel,
    skReclaimDelivery: reclaimDel,
    skStrength: strength,
    skStrengthOf: strengthOf,
    skChecks: checks,
    // One number for the default sort: reclaimed setups first, then by
    // evidence, then the most recent reclaim.
    skSort: (ev.watch ? 0 : 1000) + strength * 100 - (ev.watch ? n - ev.s : n - ev.r),
    reason,
  };
}
