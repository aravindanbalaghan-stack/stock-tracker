import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { getResolvedSectorList } from "@/lib/sectorOverrides";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// WHAT THIS DOES
//
// For every stock-day in the chosen window it computes what the PRIOR 21
// sessions looked like, then checks whether the next day moved 4%+. That
// gives, for each pattern, an honest precision figure: of all the times this
// setup appeared, how often did a big move actually follow?
//
// THE DENOMINATOR IS THE WHOLE POINT. It would be easy — and useless — to
// look only at the stocks that moved and report "80% of them had volume
// contraction". Volume contraction might appear on 80% of ALL stock-days,
// in which case it tells you nothing. So every pattern is evaluated across
// every stock-day in the window, not just the winners, and reported as:
//
//   occurrences  — how many times the setup appeared at all
//   hitRate      — share of those followed by a 4%+ move
//   lift         — hitRate ÷ base rate. 1.0 means the pattern is noise.
//
// A pattern can look impressive on the movers list and still have a lift of
// 1.0. That is the common case, and this is built to show it.
// ---------------------------------------------------------------------------

const LOOKBACK = 21; // sessions of history each pattern is computed from
const DEFAULT_WINDOW = 22; // ~1 month of evaluation days
const MAX_WINDOW = 44;
const MOVE_THRESHOLD = 4; // % single-day gain that counts as "a move"
const FOLLOW_DAYS = 5; // sessions after the move, for follow-through
// Below this, percentage moves are rounding noise on the tick size rather
// than real movement — sub-₹10 stocks would otherwise dominate the movers.
const MIN_PRICE = 20;
const MIN_AVG_VOLUME = 10000;

function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
}
function median(a) {
  const v = a.filter((x) => x != null).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return Math.round(m * 100) / 100;
}
function round(n, d = 2) {
  return n == null ? null : Math.round(n * 10 ** d) / 10 ** d;
}

/**
 * The pre-move fingerprint: everything knowable from the 21 sessions BEFORE
 * the day in question. Nothing here may touch the move day itself — that
 * would be lookahead and would make every pattern look predictive.
 */
function describeSetup(hist) {
  if (hist.length < LOOKBACK) return null;
  const w = hist.slice(-LOOKBACK);
  const closes = w.map((d) => d.close).filter((c) => c > 0);
  const vols = w.map((d) => d.volume).filter((v) => v > 0);
  const dels = w.map((d) => d.deliveryPct).filter((v) => v != null);
  if (closes.length < LOOKBACK - 3 || vols.length < LOOKBACK - 3) return null;

  const last = w[w.length - 1];
  const hi = Math.max(...w.map((d) => d.high ?? d.close).filter(Boolean));
  const lo = Math.min(...w.map((d) => d.low ?? d.close).filter(Boolean));
  const avgVol = mean(vols);
  const recentVol = mean(vols.slice(-5));
  const priorVol = mean(vols.slice(0, -5));
  const sma21 = mean(closes);
  const avgDel = mean(dels);
  const recentDel = mean(dels.slice(-5));
  const priorDel = mean(dels.slice(0, -5));

  const tags = [];

  // --- Volume behaviour ---
  if (recentVol != null && priorVol > 0) {
    const ratio = recentVol / priorVol;
    if (ratio < 0.7) tags.push("volume dried up");
    else if (ratio > 1.5) tags.push("volume building");
  }

  // --- Range / consolidation ---
  const rangePct = lo > 0 ? ((hi - lo) / lo) * 100 : null;
  if (rangePct != null) {
    if (rangePct < 8) tags.push("tight 21-day range");
    else if (rangePct > 25) tags.push("wide 21-day range");
  }

  // --- Where in the range it sits ---
  if (hi > lo) {
    const pos = (last.close - lo) / (hi - lo);
    if (pos >= 0.85) tags.push("near 21-day high");
    else if (pos <= 0.15) tags.push("near 21-day low");
  }

  // --- Trend ---
  if (sma21 != null) tags.push(last.close > sma21 ? "above 21-day average" : "below 21-day average");

  // --- Delivery ---
  if (avgDel != null) {
    if (avgDel >= 60) tags.push("sustained high delivery");
    else if (avgDel < 35) tags.push("low delivery throughout");
  }
  if (recentDel != null && priorDel != null && priorDel > 0) {
    if (recentDel > priorDel * 1.25) tags.push("delivery rising");
  }

  // --- Recent quiet before the move ---
  const lastFive = w.slice(-5);
  const flat = lastFive.every((d) => {
    if (!d.prevClose || !d.close) return false;
    return Math.abs((d.close - d.prevClose) / d.prevClose) * 100 < 2;
  });
  if (flat) tags.push("five quiet sessions");

  // --- Prior-day direction ---
  if (last.prevClose && last.close) {
    const ch = ((last.close - last.prevClose) / last.prevClose) * 100;
    if (ch >= 2) tags.push("prior day already up");
    else if (ch <= -2) tags.push("prior day down");
  }

  return {
    tags,
    context: {
      rangePct: round(rangePct),
      avgVolume: avgVol != null ? Math.round(avgVol) : null,
      volTrend: recentVol != null && priorVol > 0 ? round(recentVol / priorVol) : null,
      avgDeliveryPct: round(avgDel),
      sma21: round(sma21),
    },
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const threshold = Math.max(1, Number(searchParams.get("threshold")) || MOVE_THRESHOLD);
  const windowDays = Math.min(MAX_WINDOW, Math.max(5, Number(searchParams.get("window")) || DEFAULT_WINDOW));

  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const dateParam = searchParams.get("date");
  let asOfDate = null;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    asOfDate = dateParam > todayIST ? todayIST : dateParam;
  }

  // Enough history for the lookback behind the oldest evaluated day, plus
  // room after the newest for follow-through.
  const need = windowDays + LOOKBACK + FOLLOW_DAYS + 5;

  try {
    const all = await getRecentBhavcopies(need, need * 2 + 25);
    let days = asOfDate ? all.filter((d) => d.date <= asOfDate) : all;
    if (days.length < LOOKBACK + 5) {
      return Response.json(
        { error: `Not enough trading-day data at or before ${asOfDate ?? "today"}.` },
        { status: 503 }
      );
    }
    days = days.slice(-need);
    const latest = days[days.length - 1];

    // Per-symbol series indexed by day position, built once. Recomputing
    // per evaluation day would be ~40x the work for the same numbers.
    const seriesBySymbol = new Map();
    days.forEach((day, idx) => {
      for (const [symbol, r] of day.bySymbol) {
        if (r.series !== "EQ" || r.close == null) continue;
        if (!seriesBySymbol.has(symbol)) seriesBySymbol.set(symbol, []);
        seriesBySymbol.get(symbol).push({ idx, ...r });
      }
    });

    const firstEval = Math.max(LOOKBACK, days.length - windowDays);
    const patternStats = new Map();
    const movers = [];
    let totalObservations = 0;
    let totalMoves = 0;

    for (const [symbol, series] of seriesBySymbol) {
      // Position lookup so the lookback slice is contiguous trading days
      // for THIS symbol, not calendar positions it may not have traded.
      const byIdx = new Map(series.map((r) => [r.idx, r]));

      for (let i = firstEval; i < days.length; i++) {
        const cur = byIdx.get(i);
        if (!cur || !cur.prevClose || !cur.close) continue;
        if (cur.close < MIN_PRICE) continue;

        const hist = [];
        for (let k = i - LOOKBACK; k < i; k++) {
          const h = byIdx.get(k);
          if (h) hist.push(h);
        }
        if (hist.length < LOOKBACK - 3) continue;

        const avgVol = mean(hist.map((h) => h.volume).filter((v) => v > 0));
        if (!avgVol || avgVol < MIN_AVG_VOLUME) continue;

        const setup = describeSetup(hist);
        if (!setup) continue;

        const movePct = ((cur.close - cur.prevClose) / cur.prevClose) * 100;
        const moved = movePct >= threshold;

        totalObservations++;
        if (moved) totalMoves++;

        // Every occurrence counts toward the denominator, moved or not.
        for (const tag of setup.tags) {
          const s = patternStats.get(tag) ?? { tag, occurrences: 0, moves: 0, forward: [] };
          s.occurrences++;
          if (moved) s.moves++;
          patternStats.set(tag, s);
        }

        if (!moved) continue;

        // Follow-through after the move, so a pattern that produces
        // one-day spikes which immediately reverse is distinguishable
        // from one that starts something.
        const after = [];
        for (let k = i + 1; k <= i + FOLLOW_DAYS; k++) {
          const f = byIdx.get(k);
          if (f?.close != null) after.push(f);
        }
        const forwardPct = after.length
          ? ((after[after.length - 1].close - cur.close) / cur.close) * 100
          : null;
        if (forwardPct != null) {
          for (const tag of setup.tags) patternStats.get(tag).forward.push(forwardPct);
        }

        movers.push({
          symbol,
          date: days[i].date,
          movePct: round(movePct),
          close: cur.close,
          volume: cur.volume,
          volumeRatio: round(cur.volume / avgVol),
          deliveryPct: cur.deliveryPct,
          tags: setup.tags,
          context: setup.context,
          forwardPct: round(forwardPct),
          forwardDays: after.length,
        });
      }
    }

    const baseRate = totalObservations ? totalMoves / totalObservations : 0;

    const patterns = [...patternStats.values()]
      .filter((s) => s.occurrences >= 50) // too rare to say anything about
      .map((s) => ({
        tag: s.tag,
        occurrences: s.occurrences,
        moves: s.moves,
        hitRatePct: round((s.moves / s.occurrences) * 100, 1),
        lift: baseRate > 0 ? round(s.moves / s.occurrences / baseRate) : null,
        // Of the moves this pattern preceded, how they went over the next
        // week — "good returns" in the sense of the move sticking.
        medianForwardPct: median(s.forward),
        followedThroughCount: s.forward.filter((v) => v > 0).length,
        forwardSample: s.forward.length,
      }))
      .sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0));

    movers.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.movePct - a.movePct));

    // Sectors for the movers list.
    try {
      const sectorList = await getResolvedSectorList();
      const bySymbol = new Map();
      for (const s of sectorList) {
        for (const sym of s.symbols) {
          if (!bySymbol.has(sym)) bySymbol.set(sym, []);
          bySymbol.get(sym).push({ key: s.key, name: s.name });
        }
      }
      for (const m of movers) m.sectors = bySymbol.get(m.symbol) ?? [];
    } catch {
      for (const m of movers) m.sectors = null;
    }

    return Response.json({
      asOf: latest.date,
      requestedDate: asOfDate,
      dateAdjusted: !!asOfDate && asOfDate !== latest.date,
      windowFirstDate: days[firstEval]?.date ?? null,
      criteria: { threshold, windowDays, lookback: LOOKBACK, followDays: FOLLOW_DAYS, minPrice: MIN_PRICE },
      totals: {
        observations: totalObservations,
        moves: totalMoves,
        baseRatePct: round(baseRate * 100, 2),
      },
      patterns,
      moverCount: movers.length,
      movers: movers.slice(0, 400),
      truncated: movers.length > 400,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to analyse movers", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
