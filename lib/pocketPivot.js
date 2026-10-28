// Pocket Pivot — Gil Morales & Chris Kacher ("Trade Like an O'Neil
// Disciple", 2010; Kacher's "Ten Rules for Pocket Pivots").
//
// Only the volume signature has an exact definition in the source; the
// rest is context. This module turns that into:
//
//   HARD RULES (a stock that fails any of these is dropped)
//     1. Up day: close strictly above the previous session's close.
//     2. Volume signature: today's volume beats the highest volume of any
//        DOWN day in the prior 10 sessions. A down day is a close below the
//        PREVIOUS SESSION'S close — not a red candle (close < open). If the
//        prior 10 sessions had no down day there's nothing to beat, so it's
//        not a pocket pivot.
//     3. Not extended: close no more than 5% above the 10-day SMA. Kacher:
//        a pivot "right near its 10-dma can be bought, otherwise it is
//        extended and should be avoided".
//     4. Trend: close above both the 50 DMA and 200 DMA ("do not buy pocket
//        pivots if the stock is under a critical moving average").
//
//   CONTEXT (shown as Type + Grade, never used to drop a row)
//     Type  — 50-DMA bounce: the day came up off / through the 50 DMA
//             10-DMA continuation: came up off / through the 10 DMA
//             Inside base: neither MA was touched
//     Grade — A when none of the warnings below apply, otherwise B:
//             weak close (lower half of the day's range), 50 DMA declining,
//             wedging (3+ low-volume up days into the signal), sharp run-up
//             (>25% in the prior 20 sessions — "climactic"), steep V-shaped
//             rebound (>15% off the 10-session low).
//
// Split in two because the route is: cheap bhavcopy pass over ~2000 stocks
// first, Yahoo history only for survivors. Stage 1 needs only the 31-day
// bhavcopy window; stage 2 needs the 50/200 DMA, which only Yahoo has.

import { sma } from "@/lib/screenerIndicators";

export const PP = {
  lookbackDownDays: 10,
  maxExtensionAbove10dmaPct: 5,
  // How close the day's low (or the prior close) must come to an MA for the
  // move to count as coming "up off" that MA.
  maTouchTolerancePct: 1.5,
  minClose: 20,
  warn: {
    runUpPct: 25,
    runUpSessions: 20,
    vShapePct: 15,
    wedgeQuietUpDays: 3,
  },
};

const pct = (a, b) => ((a - b) / b) * 100;
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

function prevCloseOf(series, i) {
  return series[i]?.prevClose ?? series[i - 1]?.close ?? null;
}

/**
 * Stage 1 — bhavcopy only. `series` is oldest-first bhavcopy rows ending
 * on the as-of session. Returns null if the stock fails, or the volume
 * signature figures if it passes rules 1–3.
 */
export function pocketPivotStage1(series) {
  const N = PP.lookbackDownDays;
  if (!series || series.length < N + 2) return null;

  const last = series.length - 1;
  const today = series[last];
  if (today.close == null || today.close < PP.minClose) return null;
  const todayPrev = prevCloseOf(series, last);
  if (todayPrev == null || !(today.close > todayPrev)) return null; // rule 1

  // Rule 2 — highest down-day volume over the prior N sessions.
  let maxDownVol = 0;
  let downDays = 0;
  for (let i = last - N; i < last; i++) {
    const d = series[i];
    const pc = prevCloseOf(series, i);
    if (d?.close == null || pc == null) continue;
    if (d.close < pc) {
      downDays++;
      if ((d.volume ?? 0) > maxDownVol) maxDownVol = d.volume ?? 0;
    }
  }
  if (downDays === 0 || maxDownVol <= 0 || !(today.volume > maxDownVol)) return null;

  // Rule 3 — not extended from the 10-day SMA (10 sessions incl. today).
  const sma10 = sma(series.slice(-10).map((d) => d.close), 10);
  if (sma10 == null) return null;
  const distFrom10dmaPct = pct(today.close, sma10);
  if (distFrom10dmaPct > PP.maxExtensionAbove10dmaPct) return null;

  return {
    maxDownVol,
    downDays,
    volVsDownVol: today.volume / maxDownVol,
    sma10,
    distFrom10dmaPct,
  };
}

/**
 * Stage 2 — needs Yahoo daily closes/volumes (oldest-first, ending on the
 * as-of session). Applies rule 4 and works out Type, Grade and warnings.
 * Returns null if the stock fails rule 4 or there isn't enough history.
 */
export function pocketPivotStage2({ series, closes, volumes, stage1 }) {
  if (!closes || closes.length < 210 || !stage1) return null;

  const last = series.length - 1;
  const today = series[last];
  const todayPrev = prevCloseOf(series, last);

  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const sma50TenAgo = sma(closes.slice(0, -10), 50);
  const avgVol50 = sma(volumes.slice(0, -1), 50); // excludes today
  if (sma50 == null || sma200 == null || sma50TenAgo == null || avgVol50 == null) return null;

  // Rule 4 — trend.
  if (!(today.close > sma50) || !(today.close > sma200)) return null;

  const { sma10 } = stage1;

  // Type — which MA (if any) the move came up off.
  const tol = 1 + PP.maTouchTolerancePct / 100;
  const cameOff = (ma) => (today.low != null && today.low <= ma * tol) || (todayPrev != null && todayPrev <= ma * tol);
  const ppType = cameOff(sma50) ? "50-DMA bounce" : cameOff(sma10) ? "10-DMA continuation" : "Inside base";

  // Context warnings.
  const warnings = [];
  const range = (today.high ?? 0) - (today.low ?? 0);
  const closeInRangePct = range > 0 ? ((today.close - today.low) / range) * 100 : 100;
  if (closeInRangePct < 50) warnings.push("Weak close — finished in the lower half of the day's range");

  if (sma50 < sma50TenAgo) warnings.push("50 DMA is declining");

  let quietUpDays = 0;
  for (let i = Math.max(1, last - 5); i < last; i++) {
    const pc = prevCloseOf(series, i);
    if (pc != null && series[i].close > pc && series[i].volume < avgVol50) quietUpDays++;
  }
  if (quietUpDays >= PP.warn.wedgeQuietUpDays && last >= 6 && series[last - 1].close > series[last - 6].close) {
    warnings.push(`Wedging — ${quietUpDays} low-volume up days into the signal`);
  }

  const back = PP.warn.runUpSessions + 1;
  if (last >= back) {
    const runUp = pct(series[last - 1].close, series[last - back].close);
    if (runUp > PP.warn.runUpPct) {
      warnings.push(`Sharp run-up — ${runUp.toFixed(1)}% in the prior ${PP.warn.runUpSessions} sessions`);
    }
  }

  let minLow10 = Infinity;
  for (let i = Math.max(0, last - 10); i < last; i++) {
    if (series[i].low != null) minLow10 = Math.min(minLow10, series[i].low);
  }
  if (Number.isFinite(minLow10)) {
    const offLow = pct(today.close, minLow10);
    if (offLow > PP.warn.vShapePct) warnings.push(`Steep V-shaped rebound — ${offLow.toFixed(1)}% off the 10-session low`);
  }

  const ppGrade = warnings.length === 0 ? "A" : "B";
  const stopLevel = today.low;

  return {
    ppGrade,
    ppType,
    ppWarnings: warnings,
    maxDownVol: stage1.maxDownVol,
    downDays10: stage1.downDays,
    volVsDownVol: r2(stage1.volVsDownVol),
    volVs50dAvg: r2(today.volume / avgVol50),
    sma10: r2(sma10),
    sma50: r2(sma50),
    sma200: r2(sma200),
    distFrom10dmaPct: r2(stage1.distFrom10dmaPct),
    distFrom50dmaPct: r2(pct(today.close, sma50)),
    closeInRangePct: Math.round(closeInRangePct),
    stopLevel: r2(stopLevel),
    riskPct: stopLevel ? r2(pct(today.close, stopLevel)) : null,
  };
}
