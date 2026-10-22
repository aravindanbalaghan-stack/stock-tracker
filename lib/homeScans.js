// The two scans on the Home tab.
//
//  1. Volume + delivery surge — a single session where a stock traded more
//     than 4× its own 30-day average volume, more than 80% of it was taken
//     for delivery, and at least ₹20 Cr changed hands. Pure bhavcopy, so
//     it's fast and needs no Yahoo calls.
//
//  2. Entering Stage 2 after an accumulation base — stocks that broke out
//     into Stage 2 within the last ~25 sessions (the same "Entering" rule
//     the Stage 2 screen uses), whose previous weekly stage was 1 (basing)
//     or 3 (topping/flat MA) — i.e. they came out of a real base, not a
//     V-bounce straight off a Stage 4 decline — and where the base itself
//     shows accumulation.
//
// "Accumulation during the base" is judged three ways, each stated
// plainly so the result can be checked rather than trusted:
//   - Up/down volume ratio: total volume on up-closing days divided by
//     total volume on down-closing days, across the whole base. Above 1
//     means more shares changed hands on up days than down days while
//     price was going nowhere — the classic signature of someone buying.
//   - OBV net: on-balance volume's net change across the base as a % of
//     all base volume. Positive = the base's volume leaned to up days.
//   - Delivery %: volume-weighted delivery % inside the base (shares
//     delivered ÷ shares traded), from NSE bhavcopy. Only the most recent
//     ~80 sessions of bhavcopy are loaded, so for a long base this covers
//     its LATER part — which is where Wyckoff's Phase C/D accumulation
//     sits anyway. The coverage is reported with every row.

import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import {
  fetchDailyOHLCVBatch,
  fetchWeeklyOHLCVBatch,
  fetchIndexOHLCV,
  symbolSeries,
} from "@/lib/screenerIndicators";
import { resolveWideUniverse } from "@/lib/nifty500";
import { analyzeStage2, mightBeStage2 } from "@/lib/stageAnalysis";
import { ACCUMULATION_DELIVERY_THRESHOLD } from "@/lib/deliveryMetrics";

// ---------------------------------------------------------------------
// 1. Volume + delivery surge
// ---------------------------------------------------------------------

export const SURGE_CRITERIA = {
  volumeMultipleMin: 4, // strictly more than 4× the 30-day average
  deliveryPctMin: 80, // strictly more than 80%
  turnoverCrMin: 20, // at least ₹20 Cr traded
  avgDays: 30,
  // A stock with fewer prior sessions than this (fresh listing, long
  // suspension) has no meaningful "average" to beat, so it's left out
  // rather than shown with a ratio built on two or three days.
  minPriorDays: 15,
};
// How many recent sessions the Home tab lets you flip between.
export const SURGE_SESSIONS = 5;

function r2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

export async function volumeDeliverySurge() {
  const c = SURGE_CRITERIA;
  const days = await getRecentBhavcopies(c.avgDays + SURGE_SESSIONS + 1, 90);
  if (days.length < c.minPriorDays + 1) {
    return { error: "Not enough trading-day data available from NSE yet" };
  }

  const sessions = [];
  for (let off = 0; off < SURGE_SESSIONS; off++) {
    const idx = days.length - 1 - off;
    if (idx < c.minPriorDays) break;
    const day = days[idx];
    const prior = days.slice(Math.max(0, idx - c.avgDays), idx);
    const rows = [];
    for (const [symbol, r] of day.bySymbol) {
      if (r.series !== "EQ" || !r.volume || r.close == null) continue;
      // Cheapest tests first — most of the ~2,000 symbols fail these.
      if (r.deliveryPct == null || !(r.deliveryPct > c.deliveryPctMin)) continue;
      const turnoverCr = r.turnoverLacs != null ? r.turnoverLacs / 100 : null;
      if (turnoverCr == null || turnoverCr < c.turnoverCrMin) continue;

      const vols = prior.map((d) => d.bySymbol.get(symbol)?.volume).filter((v) => v > 0);
      if (vols.length < c.minPriorDays) continue;
      const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
      const ratio = r.volume / avg;
      if (!(ratio > c.volumeMultipleMin)) continue;

      rows.push({
        symbol,
        close: r.close,
        changePercent: r.prevClose ? r2(((r.close - r.prevClose) / r.prevClose) * 100) : null,
        deliveryPct: r.deliveryPct,
        volume: r.volume,
        avgVolume30: Math.round(avg),
        avgVolumeDays: vols.length,
        volumeRatio: r2(ratio),
        turnoverCr: r2(turnoverCr),
      });
    }
    rows.sort((a, b) => b.volumeRatio - a.volumeRatio);
    sessions.push({ date: day.date, rows });
  }

  // Stocks that cleared the bar on more than one of these sessions — a
  // repeat is a stronger tell than a single spike.
  const counts = new Map();
  for (const s of sessions) for (const r of s.rows) counts.set(r.symbol, (counts.get(r.symbol) ?? 0) + 1);
  for (const s of sessions) for (const r of s.rows) r.repeats = counts.get(r.symbol);

  return { criteria: c, sessions };
}

// ---------------------------------------------------------------------
// 2. Entering Stage 2 after an accumulation base
// ---------------------------------------------------------------------

export const ACCUMULATION_CRITERIA = {
  upDownVolumeMin: 1.3,
  obvNetMin: 0, // % of base volume; must be positive
  deliveryPctMin: ACCUMULATION_DELIVERY_THRESHOLD, // same 50% the app uses everywhere for "accumulating"
  // Below this many base sessions covered by bhavcopy, the delivery test
  // is reported but not required — too few days to judge a base on.
  deliveryMinCoverageDays: 10,
  highDeliveryPct: 60, // an up day with delivery at least this high counts as a "high-delivery up day"
  allowedPreviousStages: [1, 3],
};

const BHAV_DAYS = 80; // ~4 months — the same depth the stock page already loads
const WEEKLY_CONCURRENCY = 12;
const DAILY_CONCURRENCY = 10;
const DAILY_CAP = 220;

function isoDay(t) {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

/**
 * Accumulation measures for one stock's base. `a` is analyzeStage2's
 * result (for the base's date range), `days` the bhavcopy window.
 */
export function baseAccumulation(dailyBars, a, days, symbol) {
  const c = ACCUMULATION_CRITERIA;
  const { baseStartDate: from, baseEndDate: to } = a;
  if (!from || !to) return null;

  let upVol = 0;
  let downVol = 0;
  let obv = 0;
  let totalVol = 0;
  let first = null;
  let last = null;
  for (let i = 1; i < dailyBars.length; i++) {
    const b = dailyBars[i];
    const d = isoDay(b.t);
    if (d < from || d > to) continue;
    const v = b.v ?? 0;
    const prev = dailyBars[i - 1].c;
    if (first == null) first = b;
    last = b;
    totalVol += v;
    if (b.c > prev) {
      upVol += v;
      obv += v;
    } else if (b.c < prev) {
      downVol += v;
      obv -= v;
    }
  }
  if (!totalVol || !first) return null;

  // Delivery inside the base, from whatever part of it bhavcopy covers.
  let delivQty = 0;
  let delivVol = 0;
  let coverage = 0;
  let highDeliveryUpDays = 0;
  for (const day of days) {
    if (day.date < from || day.date > to) continue;
    const r = day.bySymbol.get(symbol);
    if (!r || !r.volume || r.deliveryPct == null) continue;
    coverage++;
    delivQty += r.deliveryQty || 0;
    delivVol += r.volume;
    if (r.prevClose && r.close > r.prevClose && r.deliveryPct >= c.highDeliveryPct) highDeliveryUpDays++;
  }
  const avgDeliveryPct = delivVol > 0 ? r2((delivQty / delivVol) * 100) : null;

  const upDownVolume = downVol > 0 ? r2(upVol / downVol) : null;
  const obvNetPct = r2((obv / totalVol) * 100);
  const deliveryJudged = coverage >= c.deliveryMinCoverageDays && avgDeliveryPct != null;

  const passUD = upDownVolume != null && upDownVolume >= c.upDownVolumeMin;
  const passOBV = obvNetPct > c.obvNetMin;
  const passDeliv = deliveryJudged ? avgDeliveryPct >= c.deliveryPctMin : null;

  const great = passUD && passOBV && passDeliv !== false;
  const moderate = !great && obvNetPct > 0 && upDownVolume != null && upDownVolume >= 1.1;

  return {
    baseFrom: from,
    baseTo: to,
    baseSessions: dailyBars.filter((b) => {
      const d = isoDay(b.t);
      return d >= from && d <= to;
    }).length,
    basePriceChangePct: r2(((last.c - first.c) / first.c) * 100),
    upDownVolume,
    obvNetPct,
    avgDeliveryPct,
    deliveryCoverageDays: coverage,
    deliveryJudged,
    highDeliveryUpDays,
    checks: { upDownVolume: passUD, obv: passOBV, delivery: passDeliv },
    grade: great ? "Strong" : moderate ? "Moderate" : "Weak",
  };
}

let stage2Cache = null; // { key, at, result }
const STAGE2_CACHE_MS = 30 * 60 * 1000;

export async function enteringStage2WithAccumulation() {
  const days = await getRecentBhavcopies(BHAV_DAYS, BHAV_DAYS * 2 + 20);
  if (days.length < 31) return { error: "Not enough trading-day data available from NSE yet" };
  const latest = days[days.length - 1];

  const cacheKey = latest.date;
  if (stage2Cache && stage2Cache.key === cacheKey && Date.now() - stage2Cache.at < STAGE2_CACHE_MS) {
    return { ...stage2Cache.result, cached: true };
  }

  const asOfEpoch = Math.floor(Date.now() / 1000);
  const recent = days.slice(-31);
  const universe = [];
  for (const [symbol, r] of latest.bySymbol) {
    if (r.series !== "EQ" || !r.volume || r.close == null) continue;
    universe.push({ symbol, series: symbolSeries(symbol, recent) });
  }

  // Same two-pass narrowing as the Stage 2 screen: cheap weekly bars for
  // the wide universe, full daily history only for plausible candidates.
  const resolved = await resolveWideUniverse(universe);
  const weekly = await fetchWeeklyOHLCVBatch(resolved.symbols, { concurrency: WEEKLY_CONCURRENCY });
  const plausible = resolved.symbols.filter((s) => mightBeStage2(weekly.get(s)));
  const toCheck = plausible.slice(0, DAILY_CAP);

  const [history, nifty] = await Promise.all([
    fetchDailyOHLCVBatch(toCheck, { concurrency: DAILY_CONCURRENCY }),
    fetchIndexOHLCV("^NSEI").catch(() => null),
  ]);

  const rows = [];
  const skipped = { notEntering: 0, cameFromStage4: 0, noBase: 0 };
  for (const symbol of toCheck) {
    const bars = history.get(symbol)?.bars;
    if (!bars?.length) continue;
    const a = analyzeStage2(bars, nifty?.bars ?? null, { asOfEpoch });
    if (!a) continue;
    if (a.stagePhase !== "Entering") {
      skipped.notEntering++;
      continue;
    }
    const prev = a.journey?.previousStage?.stage ?? null;
    if (!ACCUMULATION_CRITERIA.allowedPreviousStages.includes(prev)) {
      skipped.cameFromStage4++;
      continue;
    }
    const acc = baseAccumulation(bars, a, days, symbol);
    if (!acc) {
      skipped.noBase++;
      continue;
    }
    const today = latest.bySymbol.get(symbol);
    rows.push({
      symbol,
      close: today?.close ?? bars[bars.length - 1].c,
      changePercent:
        today?.prevClose && today?.close ? r2(((today.close - today.prevClose) / today.prevClose) * 100) : null,
      deliveryPct: today?.deliveryPct ?? null,
      breakoutDate: a.stage2EntryDate,
      breakoutPrice: a.stage2EntryPrice,
      sessionsSinceBreakout: a.daysSinceEntry,
      breakoutVolumeRatio: a.breakoutVolumeRatio,
      baseSupport: a.baseSupport,
      baseResistance: a.baseResistance,
      baseWeeks: a.baseWeeks,
      prevStage: prev,
      prevStageWeeks: a.journey.previousStage.weeks,
      rsVsBenchmark: a.rsVsBenchmark,
      invalidation: a.journey?.invalidation ?? null,
      invalidationPrice: a.invalidationPrice,
      wyckoffPhase: a.wyckoffCurrent?.label ?? null,
      ...acc,
      // flat sort keys
      gradeRank: acc.grade === "Strong" ? 3 : acc.grade === "Moderate" ? 2 : 1,
    });
  }

  rows.sort(
    (x, y) => y.gradeRank - x.gradeRank || (y.upDownVolume ?? 0) - (x.upDownVolume ?? 0)
  );

  const result = {
    asOf: latest.date,
    criteria: ACCUMULATION_CRITERIA,
    universeSource: resolved.sourceLabel,
    scanned: resolved.symbols.length,
    plausible: plausible.length,
    checked: toCheck.length,
    capped: plausible.length > DAILY_CAP,
    skipped,
    bhavcopyFrom: days[0].date,
    rows,
  };
  stage2Cache = { key: cacheKey, at: Date.now(), result };
  return result;
}
