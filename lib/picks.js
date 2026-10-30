// Odds-ranked picks — the Home tab's short / mid / long-term section.
//
// WHAT THIS IS, AND ISN'T
// Nothing predicts prices reliably, and this doesn't claim to. What it
// does is rank stocks on a handful of factors with a long, replicated
// research record — and then CHECK, on this app's own data, whether the
// top-ranked stocks actually beat the rest. Every horizon carries its own
// walk-forward backtest, and the UI says plainly when one shows no edge.
//
// THE EVIDENCE BEHIND EACH FACTOR (all price/volume based — the app has no
// reliable fundamentals feed, so this does not pretend to value companies)
//   - Momentum: past 3–12 month winners keep outperforming for months
//     (Jegadeesh & Titman 1993; confirmed internationally and in India,
//     and the basis of NSE's own Nifty200 Momentum 30 index, which ranks on
//     6- and 12-month return divided by volatility — used here as-is).
//   - 52-week-high proximity: stocks near their 52-week high outperform
//     those far from it (George & Hwang 2004).
//   - Trend / stage: price above a rising 30-week MA (Weinstein Stage 2).
//   - Relative strength vs. the index (O'Neil, Weinstein).
//   - Low volatility & shallow drawdowns: lower-risk stocks have delivered
//     better risk-adjusted — and often better raw — long-run returns
//     (Baker, Bradley & Wurgler 2011; Nifty Low Volatility 30).
//   - Volatility contraction + volume on up weeks: the base-tightening
//     and accumulation pattern practitioners (Minervini, O'Neil, Wyckoff)
//     buy before short-term breakouts. Weakest academic support of the
//     lot — which is exactly why the short horizon's backtest matters most.
//
// WEIGHTS were set from that literature BEFORE looking at the backtest,
// not fitted to it. Fitting weights to the same five years they're then
// tested on would produce a beautiful backtest and no information.
//
// BIASES TO KNOW
//   - Survivorship: the universe is TODAY's ~500 stocks, so stocks that
//     collapsed or delisted in the past five years are missing. That
//     flatters every return here. The comparison that matters is picks vs.
//     the same universe's average, which carries the same bias.
//   - Overlap: rebalances are every 4 weeks but long-horizon holds are 52
//     weeks, so long-term periods overlap and aren't independent samples.
//   - Costs: a 0.4% round trip per pick (STT, charges, slippage) is
//     deducted. Taxes are not.

import { kv } from "@vercel/kv";
import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { fetchWeeklyOHLCVBatch, fetchIndexOHLCV, toWeeklyBars, symbolSeries } from "@/lib/screenerIndicators";
import { resolveWideUniverse } from "@/lib/nifty500";
import { stageFrom, weekKeyOf, stageJourney } from "@/lib/stageAnalysis";

export const TOP_N = 10;
const REBALANCE_WEEKS = 4;
const ROUND_TRIP_COST_PCT = 0.4;
const MIN_HISTORY_WEEKS = 60;
// Investability floor: average daily turnover over the last 13 weeks.
const MIN_DAILY_TURNOVER_CR = 5;
const MIN_PRICE = 20;
const WEEKLY_CONCURRENCY = 20;

export const HORIZONS = {
  short: {
    label: "Short term",
    hold: "≈ 1 month",
    holdWeeks: 4,
    idea: "Leaders tightening near their highs with buying volume — the setup that tends to precede a short-term push.",
    weights: { rs13: 0.3, tightness: 0.2, upDownVol13: 0.2, prox52: 0.15, volExpansion: 0.15 },
    exitRule: "Weekly close below the 10-week MA",
  },
  mid: {
    label: "Mid term",
    hold: "≈ 3 months",
    holdWeeks: 13,
    idea: "Volatility-adjusted 6 & 12-month momentum (NSE's momentum-index method), near 52-week highs, in a clean Stage 2.",
    weights: { volAdjMom: 0.4, prox52: 0.2, rs26: 0.2, trendConsistency: 0.2 },
    exitRule: "Weekly close that ends Stage 2",
  },
  long: {
    label: "Long term",
    hold: "≈ 1 year",
    holdWeeks: 52,
    idea: "Steady compounders: strong 12-month momentum, low volatility, shallow drawdowns, consistently up — above a rising 50-week MA.",
    weights: { mom12_1: 0.3, lowVol: 0.25, shallowDD: 0.2, posWeeks: 0.15, rs52: 0.1 },
    exitRule: "Weekly close below the 50-week MA",
  },
};

export const FACTOR_LABELS = {
  rs13: "13-week relative strength",
  rs26: "26-week relative strength",
  rs52: "52-week relative strength",
  tightness: "Price tightening (volatility contraction)",
  upDownVol13: "Volume on up weeks vs down weeks",
  prox52: "Near 52-week high",
  volExpansion: "Volume picking up",
  volAdjMom: "Volatility-adjusted momentum",
  trendConsistency: "Weeks above the 30-week MA",
  mom12_1: "12-month momentum (skip last month)",
  lowVol: "Low volatility",
  shallowDD: "Shallow drawdowns",
  posWeeks: "Share of up weeks",
};

// ---------------------------------------------------------------------
// Feature extraction — all from bars[0..i], never beyond.
// ---------------------------------------------------------------------

function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
}
function std(a) {
  const m = mean(a);
  if (m == null || a.length < 2) return null;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

/** Per-symbol precomputation: aligned keys, rolling MAs, log returns. */
function prepare(rawBars) {
  // Yahoo occasionally returns two bars for the same week (the weekly bar
  // plus a separate bar for the latest session). Keep one per week — the
  // later one carries the most recent close.
  const byKey = new Map();
  for (const b of rawBars) {
    const k = weekKeyOf(b);
    const prev = byKey.get(k);
    byKey.set(k, prev ? { ...b, h: Math.max(prev.h, b.h), l: Math.min(prev.l, b.l), v: Math.max(prev.v ?? 0, b.v ?? 0) } : b);
  }
  const bars = [...byKey.values()];
  const c = bars.map((b) => b.c);
  const keys = bars.map((b) => weekKeyOf(b));
  const idxByKey = new Map(keys.map((k, i) => [k, i]));
  const sma = (n) => {
    const out = new Array(c.length).fill(null);
    let sum = 0;
    for (let i = 0; i < c.length; i++) {
      sum += c[i];
      if (i >= n) sum -= c[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  };
  const lr = c.map((x, i) => (i === 0 ? null : Math.log(x / c[i - 1])));
  return { bars, c, keys, idxByKey, ma10: sma(10), ma30: sma(30), ma50: sma(50), lr };
}

function features(p, i, niftyByKey) {
  if (i < MIN_HISTORY_WEEKS - 1) return null;
  const { bars, c, keys, ma10, ma30, ma50, lr } = p;
  const close = c[i];
  if (!(close > 0)) return null;

  const ret = (k) => (c[i - k] > 0 ? close / c[i - k] - 1 : null);
  const r13 = ret(13);
  const r26 = ret(26);
  const r52 = ret(52);
  const mom12_1 = c[i - 52] > 0 ? c[i - 4] / c[i - 52] - 1 : null;

  const lr52 = lr.slice(i - 51, i + 1).filter((x) => x != null);
  const vol52 = std(lr52) * Math.sqrt(52);
  const volShort = std(lr.slice(i - 5, i + 1).filter((x) => x != null));
  const volBase = std(lr.slice(i - 25, i + 1).filter((x) => x != null));

  const highs = bars.slice(i - 51, i + 1).map((b) => b.h);
  const prox52 = close / Math.max(...highs);

  // Max drawdown inside the last 52 weeks.
  let peak = -Infinity;
  let maxDD = 0;
  for (let k = i - 51; k <= i; k++) {
    peak = Math.max(peak, c[k]);
    maxDD = Math.min(maxDD, c[k] / peak - 1);
  }
  const posWeeks = lr52.filter((x) => x > 0).length / lr52.length;

  let above30 = 0;
  for (let k = i - 25; k <= i; k++) if (ma30[k] != null && c[k] > ma30[k]) above30++;

  let upV = 0;
  let dnV = 0;
  for (let k = i - 12; k <= i; k++) {
    const v = bars[k].v ?? 0;
    if (c[k] > c[k - 1]) upV += v;
    else if (c[k] < c[k - 1]) dnV += v;
  }
  const v4 = mean(bars.slice(i - 3, i + 1).map((b) => b.v ?? 0));
  const v26 = mean(bars.slice(i - 29, i - 3).map((b) => b.v ?? 0));

  const nRet = (k) => {
    const a = niftyByKey.get(keys[i]);
    const b = niftyByKey.get(keys[i - k]);
    return a && b ? a / b - 1 : null;
  };
  const rsOf = (r, k) => (r != null && nRet(k) != null ? r - nRet(k) : null);

  // Average daily turnover over 13 weeks (weekly volume × close ÷ 5 sessions), ₹ Cr.
  const turnoverCr = mean(bars.slice(i - 12, i + 1).map((b) => ((b.v ?? 0) * b.c) / 5)) / 1e7;

  const stage = ma30[i] != null && ma30[i - 4] != null ? stageFrom(close, ma30[i], ma30[i - 4]).stage : null;

  return {
    close,
    stage,
    r4: ret(4),
    r13,
    r26,
    r52,
    mom12_1,
    vol52,
    prox52,
    maxDD,
    posWeeks,
    trendConsistency: above30 / 26,
    upDownVol13: dnV > 0 ? upV / dnV : upV > 0 ? 3 : 1,
    volExpansion: v26 > 0 ? v4 / v26 : null,
    tightness: volShort != null && volBase > 0 ? -(volShort / volBase) : null, // higher = tighter
    volAdjMom: vol52 > 0 && r26 != null && r52 != null ? 0.5 * (r26 / vol52) + 0.5 * (r52 / vol52) : null,
    lowVol: vol52 != null ? -vol52 : null,
    shallowDD: maxDD,
    rs13: rsOf(r13, 13),
    rs26: rsOf(r26, 26),
    rs52: rsOf(r52, 52),
    extension10: ma10[i] ? close / ma10[i] : null,
    ma10: ma10[i],
    ma50: ma50[i],
    ma50Rising: ma50[i] != null && ma50[i - 13] != null ? ma50[i] > ma50[i - 13] : null,
    turnoverCr,
  };
}

const GATES = {
  // Leaders only, but not already stretched far above their 10-week MA.
  short: (f) => f.stage === 2 && f.prox52 >= 0.75 && f.extension10 != null && f.extension10 <= 1.15,
  mid: (f) => f.stage === 2 && f.mom12_1 > 0 && f.prox52 >= 0.7,
  long: (f) => f.ma50 != null && f.close > f.ma50 && f.ma50Rising === true && f.mom12_1 > 0,
};

function investable(f) {
  return f.close >= MIN_PRICE && f.turnoverCr >= MIN_DAILY_TURNOVER_CR;
}

/** Percentile rank (0–1) of every row's `key` among rows that have it. */
function rankInto(rows, key) {
  const vals = rows.filter((r) => r.f[key] != null).sort((a, b) => a.f[key] - b.f[key]);
  const n = vals.length;
  vals.forEach((r, j) => {
    r.ranks[key] = n > 1 ? j / (n - 1) : 0.5;
  });
}

/**
 * Scores one cross-section (one date, all symbols) for every horizon.
 * Ranks are taken across the whole investable universe, THEN gates are
 * applied — so "top 10% momentum" means top 10% of the market, not of the
 * already-filtered few.
 */
function scoreCrossSection(rows) {
  const keys = new Set(Object.values(HORIZONS).flatMap((h) => Object.keys(h.weights)));
  for (const k of keys) rankInto(rows, k);
  const out = {};
  for (const [hid, h] of Object.entries(HORIZONS)) {
    const scored = [];
    for (const r of rows) {
      if (!GATES[hid](r.f)) continue;
      let s = 0;
      let wsum = 0;
      const contrib = [];
      for (const [k, w] of Object.entries(h.weights)) {
        const rk = r.ranks[k];
        if (rk == null) continue;
        s += w * rk;
        wsum += w;
        contrib.push({ factor: k, percentile: Math.round(rk * 100), weight: w });
      }
      if (wsum < 0.75) continue; // too many missing factors to rank fairly
      scored.push({ ...r, score: s / wsum, contrib });
    }
    scored.sort((a, b) => b.score - a.score);
    out[hid] = scored;
  }
  return out;
}

// ---------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------

async function loadUniverse() {
  const days = await getRecentBhavcopies(60, 140);
  if (days.length < 25) throw new Error("Not enough trading-day data available from NSE yet");
  const latest = days[days.length - 1];
  const recent = days.slice(-31);
  const universe = [];
  for (const [symbol, r] of latest.bySymbol) {
    if (r.series !== "EQ" || !r.volume || r.close == null) continue;
    universe.push({ symbol, series: symbolSeries(symbol, recent) });
  }
  const resolved = await resolveWideUniverse(universe);
  const [weekly, nifty] = await Promise.all([
    fetchWeeklyOHLCVBatch(resolved.symbols, { concurrency: WEEKLY_CONCURRENCY, range: "5y" }),
    fetchIndexOHLCV("^NSEI", "5y"),
  ]);
  if (!nifty?.bars?.length) throw new Error("Couldn't load NIFTY history for relative strength");
  const niftyWeekly = toWeeklyBars(nifty.bars);
  const niftyByKey = new Map(niftyWeekly.map((w) => [w.key, w.c]));

  const prepared = new Map();
  for (const s of resolved.symbols) {
    const bars = weekly.get(s);
    if (!bars || bars.length < MIN_HISTORY_WEEKS) continue;
    const p = prepare(bars);
    if (p.c.length >= MIN_HISTORY_WEEKS) prepared.set(s, p);
  }
  return { days, latest, resolved, prepared, niftyWeekly, niftyByKey, niftyDaily: nifty.bars };
}

// ---------------------------------------------------------------------
// Walk-forward backtest
// ---------------------------------------------------------------------

function backtest({ prepared, niftyWeekly, niftyByKey }) {
  const calendar = niftyWeekly.map((w) => w.key);
  const results = {};
  for (const hid of Object.keys(HORIZONS)) results[hid] = [];

  // Last index is the in-progress week; never use it as a rebalance point.
  for (let t = MIN_HISTORY_WEEKS; t < calendar.length - 1; t += REBALANCE_WEEKS) {
    const key = calendar[t];
    const rows = [];
    for (const [symbol, p] of prepared) {
      const i = p.idxByKey.get(key);
      if (i == null) continue;
      const f = features(p, i, niftyByKey);
      if (!f || !investable(f)) continue;
      rows.push({ symbol, i, p, f, ranks: {} });
    }
    if (rows.length < 50) continue;
    const scored = scoreCrossSection(rows);

    for (const [hid, h] of Object.entries(HORIZONS)) {
      const H = h.holdWeeks;
      // Forward return needs a COMPLETED bar H weeks ahead.
      const fwd = (r) => {
        const j = r.i + H;
        return j < r.p.c.length - 1 ? r.p.c[j] / r.p.c[r.i] - 1 : null;
      };
      const universeRets = rows.map(fwd).filter((x) => x != null);
      if (universeRets.length < 50) continue;
      const picks = scored[hid].slice(0, TOP_N);
      const pickRets = picks.map(fwd).filter((x) => x != null);
      if (pickRets.length < Math.min(5, picks.length) || !picks.length) continue;
      const nNow = niftyByKey.get(key);
      const nThen = niftyByKey.get(calendar[t + H]);
      results[hid].push({
        date: key,
        picks: pickRets.length,
        pickRet: mean(pickRets) - ROUND_TRIP_COST_PCT / 100,
        universeRet: mean(universeRets),
        niftyRet: nNow && nThen ? nThen / nNow - 1 : null,
        hitRate: pickRets.filter((x) => x > ROUND_TRIP_COST_PCT / 100).length / pickRets.length,
      });
    }
  }

  const summary = {};
  for (const [hid, rs] of Object.entries(results)) {
    if (!rs.length) {
      summary[hid] = { periods: 0 };
      continue;
    }
    const pct = (x) => Math.round(x * 1000) / 10;
    const excess = rs.map((r) => r.pickRet - r.universeRet);
    const beat = excess.filter((x) => x > 0).length / rs.length;
    const avgExcess = mean(excess);
    // Honest verdict. A horizon only earns "edge held" if it beat the
    // universe on average AND in a clear majority of periods.
    const verdict =
      rs.length < 6
        ? "too-few"
        : avgExcess > 0 && beat >= 0.55
        ? "edge"
        : avgExcess > 0
        ? "weak"
        : "none";
    summary[hid] = {
      periods: rs.length,
      from: rs[0].date,
      to: rs[rs.length - 1].date,
      avgPickReturnPct: pct(mean(rs.map((r) => r.pickRet))),
      avgUniverseReturnPct: pct(mean(rs.map((r) => r.universeRet))),
      avgNiftyReturnPct: pct(mean(rs.filter((r) => r.niftyRet != null).map((r) => r.niftyRet))),
      avgExcessPct: pct(avgExcess),
      beatUniversePct: Math.round(beat * 100),
      hitRatePct: Math.round(mean(rs.map((r) => r.hitRate)) * 100),
      worstPeriodPct: pct(Math.min(...rs.map((r) => r.pickRet))),
      verdict,
      series: rs.map((r) => ({ date: r.date, pick: pct(r.pickRet), universe: pct(r.universeRet) })),
    };
  }
  return summary;
}

// ---------------------------------------------------------------------
// Forward track record (needs Vercel KV; silently absent without it)
// ---------------------------------------------------------------------

const LOG_PREFIX = "picks:log:";
const LOG_INDEX = "picks:dates";

async function logToday(date, picksByHorizon) {
  try {
    const existing = await kv.get(`${LOG_PREFIX}${date}`);
    if (existing) return; // first computation of the day wins
    const doc = {};
    for (const [hid, rows] of Object.entries(picksByHorizon)) {
      // rank/score/stage were added later for the Lookback view; older log
      // entries only have symbol + price, and readers handle both.
      doc[hid] = rows.map((r) => ({ symbol: r.symbol, price: r.close, rank: r.rank, score: r.score, stage: r.stage }));
    }
    await kv.set(`${LOG_PREFIX}${date}`, doc);
    const dates = (await kv.get(LOG_INDEX)) || [];
    if (!dates.includes(date)) await kv.set(LOG_INDEX, [...dates, date].slice(-400));
  } catch {
    /* KV not configured */
  }
}

async function trackRecord({ latest, niftyDaily }) {
  let dates;
  try {
    dates = (await kv.get(LOG_INDEX)) || [];
  } catch {
    return { available: false };
  }
  if (!dates.length) return { available: true, horizons: {} };
  const niftyAt = (d) => {
    let v = null;
    for (const b of niftyDaily) {
      if (new Date(b.t * 1000).toISOString().slice(0, 10) <= d) v = b.c;
      else break;
    }
    return v;
  };
  const niftyNow = niftyDaily[niftyDaily.length - 1].c;
  const docs = await Promise.all(dates.map((d) => kv.get(`${LOG_PREFIX}${d}`).catch(() => null)));

  const agg = {};
  for (const hid of Object.keys(HORIZONS)) agg[hid] = [];
  dates.forEach((d, n) => {
    const doc = docs[n];
    if (!doc || d >= latest.date) return; // need at least one session elapsed
    const nThen = niftyAt(d);
    for (const hid of Object.keys(HORIZONS)) {
      const rets = (doc[hid] ?? [])
        .map((x) => {
          const now = latest.bySymbol.get(x.symbol)?.close;
          return now && x.price ? now / x.price - 1 : null;
        })
        .filter((x) => x != null);
      if (!rets.length || !nThen) continue;
      agg[hid].push({ date: d, ret: mean(rets), nifty: niftyNow / nThen - 1 });
    }
  });

  const horizons = {};
  for (const [hid, rs] of Object.entries(agg)) {
    if (!rs.length) continue;
    const pct = (x) => Math.round(x * 1000) / 10;
    horizons[hid] = {
      sets: rs.length,
      since: rs[0].date,
      avgReturnPct: pct(mean(rs.map((r) => r.ret))),
      avgNiftyPct: pct(mean(rs.map((r) => r.nifty))),
      beatNiftyPct: Math.round((rs.filter((r) => r.ret > r.nifty).length / rs.length) * 100),
    };
  }
  return { available: true, horizons };
}

// ---------------------------------------------------------------------
// How long each current pick has been on its list
// ---------------------------------------------------------------------

const SHOWN_HISTORY_SESSIONS = 60;

/**
 * Adds to each of today's picks, per horizon:
 *   daysShown      — consecutive logged sessions it has been in this
 *                    horizon's list, counting today
 *   firstShown     — the first session of that current run
 *   firstEverShown — the earliest logged session it appeared at all, which
 *                    is earlier than firstShown if it dropped out and came
 *                    back
 * Sessions with no log (Home not opened that day) are skipped rather than
 * treated as a break. Without KV the fields are left null.
 */
async function attachShownHistory(picks, today) {
  let dates;
  try {
    dates = ((await kv.get(LOG_INDEX)) || []).filter((d) => d < today).sort().slice(-SHOWN_HISTORY_SESSIONS);
  } catch {
    return null;
  }
  const docs = await Promise.all(dates.map((d) => kv.get(`${LOG_PREFIX}${d}`).catch(() => null)));

  for (const [hid, list] of Object.entries(picks)) {
    for (const p of list) {
      let daysShown = 1;
      let firstShown = today;
      let firstEverShown = today;
      let broken = false;
      for (let i = dates.length - 1; i >= 0; i--) {
        const doc = docs[i];
        if (!doc) continue;
        const listed = (doc[hid] ?? []).some((x) => x.symbol === p.symbol);
        if (listed) {
          firstEverShown = dates[i];
          if (!broken) {
            daysShown++;
            firstShown = dates[i];
          }
        } else {
          broken = true;
        }
      }
      p.daysShown = daysShown;
      p.firstShown = firstShown;
      p.firstEverShown = firstEverShown;
    }
  }
  return dates[0] ?? today;
}

// ---------------------------------------------------------------------
// Lookback — the picks as they were logged on a past session
// ---------------------------------------------------------------------

const LOOKBACK_SESSIONS = 10;

/**
 * Picks recorded on `date` (one of the last 10 trading sessions), with each
 * pick's logged price, today's close, and the move since. Picks are only
 * recorded on days someone opened the Home tab (that's when getPicks runs
 * and logs), so some sessions may have no record — the response says which.
 */
export async function getPicksForDate(date) {
  const days = await getRecentBhavcopies(LOOKBACK_SESSIONS, LOOKBACK_SESSIONS * 2 + 10);
  if (!days.length) return { error: "Couldn't load recent trading days from NSE" };
  const tradingDays = days.map((d) => d.date).reverse(); // newest first
  const latest = days[days.length - 1];
  const target = date && tradingDays.includes(date) ? date : latest.date;

  let kvAvailable = true;
  let logged = [];
  try {
    logged = (await kv.get(LOG_INDEX)) || [];
  } catch {
    kvAvailable = false;
  }

  let doc = null;
  if (kvAvailable) {
    try {
      doc = await kv.get(`${LOG_PREFIX}${target}`);
    } catch {
      doc = null;
    }
    // Today's picks haven't been logged yet if nobody has opened Home —
    // computing them now logs them as a side effect.
    if (!doc && target === latest.date) {
      try {
        await getPicks();
        doc = await kv.get(`${LOG_PREFIX}${target}`);
        logged = (await kv.get(LOG_INDEX)) || logged;
      } catch {
        doc = null;
      }
    }
  }

  const horizons = {};
  for (const [hid, h] of Object.entries(HORIZONS)) {
    const list = doc?.[hid];
    if (!list) {
      horizons[hid] = { label: h.label, hold: h.hold, picks: null };
      continue;
    }
    const picks = list.map((x, i) => {
      const now = latest.bySymbol.get(x.symbol)?.close ?? null;
      return {
        rank: x.rank ?? i + 1,
        symbol: x.symbol,
        score: x.score ?? null,
        stage: x.stage ?? null,
        priceThen: x.price ?? null,
        closeNow: now,
        sincePct: now && x.price ? Math.round((now / x.price - 1) * 10000) / 100 : null,
      };
    });
    const moves = picks.map((p) => p.sincePct).filter((v) => v != null);
    horizons[hid] = {
      label: h.label,
      hold: h.hold,
      picks,
      avgSincePct: moves.length ? Math.round(mean(moves) * 100) / 100 : null,
    };
  }

  return {
    date: target,
    latestDate: latest.date,
    tradingDays,
    recordedDates: tradingDays.filter((d) => logged.includes(d)),
    kvAvailable,
    recorded: !!doc,
    horizons,
  };
}

// ---------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------

let cache = null; // { key, at, result }
const CACHE_MS = 6 * 60 * 60 * 1000;

export async function getPicks() {
  const data = await loadUniverse();
  const { latest, prepared, niftyByKey, resolved } = data;
  if (cache && cache.key === latest.date && Date.now() - cache.at < CACHE_MS) {
    return { ...cache.result, cached: true };
  }

  // ---- Today's cross-section (latest bar, which may be a week in progress)
  const rows = [];
  for (const [symbol, p] of prepared) {
    const i = p.c.length - 1;
    const f = features(p, i, niftyByKey);
    if (!f || !investable(f)) continue;
    rows.push({ symbol, i, p, f, ranks: {} });
  }
  const scored = scoreCrossSection(rows);

  // Delivery over the last 20 sessions — shown alongside, not scored,
  // because it can't be backtested (bhavcopy only goes back ~3 months).
  const recentDays = data.days.slice(-20);
  const deliveryOf = (symbol) => {
    let q = 0;
    let v = 0;
    for (const d of recentDays) {
      const r = d.bySymbol.get(symbol);
      if (r?.volume) {
        q += r.deliveryQty || 0;
        v += r.volume;
      }
    }
    return v ? Math.round((q / v) * 1000) / 10 : null;
  };

  const picks = {};
  for (const [hid, h] of Object.entries(HORIZONS)) {
    picks[hid] = scored[hid].slice(0, TOP_N).map((r, rank) => {
      const f = r.f;
      let exitLevel = null;
      if (hid === "short") exitLevel = f.ma10;
      else if (hid === "long") exitLevel = f.ma50;
      else {
        const j = stageJourney(r.p.bars, { asOfEpoch: Math.floor(Date.now() / 1000) });
        exitLevel = j?.invalidation?.down?.price ?? null;
      }
      const today = latest.bySymbol.get(r.symbol);
      return {
        rank: rank + 1,
        symbol: r.symbol,
        close: today?.close ?? Math.round(f.close * 100) / 100,
        changePercent:
          today?.prevClose && today?.close
            ? Math.round(((today.close - today.prevClose) / today.prevClose) * 10000) / 100
            : null,
        score: Math.round(r.score * 100),
        stage: f.stage,
        ret13Pct: f.r13 != null ? Math.round(f.r13 * 1000) / 10 : null,
        ret52Pct: f.r52 != null ? Math.round(f.r52 * 1000) / 10 : null,
        fromHighPct: Math.round((f.prox52 - 1) * 1000) / 10,
        vol52Pct: f.vol52 != null ? Math.round(f.vol52 * 1000) / 10 : null,
        delivery20Pct: deliveryOf(r.symbol),
        exitLevel: exitLevel != null ? Math.round(exitLevel * 100) / 100 : null,
        exitRule: h.exitRule,
        reasons: [...r.contrib].sort((a, b) => b.percentile * b.weight - a.percentile * a.weight),
      };
    });
  }

  // Cross-horizon overlap — a name ranked in two or three horizons at once.
  const seen = new Map();
  for (const [hid, list] of Object.entries(picks)) for (const p of list) seen.set(p.symbol, [...(seen.get(p.symbol) ?? []), hid]);
  for (const [hid, list] of Object.entries(picks)) for (const p of list) p.alsoIn = seen.get(p.symbol).filter((x) => x !== hid);

  const evidence = backtest(data);
  await logToday(latest.date, picks);
  const shownHistoryFrom = await attachShownHistory(picks, latest.date);
  const record = await trackRecord(data);

  const result = {
    asOf: latest.date,
    universeSource: resolved.sourceLabel,
    scanned: prepared.size,
    ranked: rows.length,
    horizons: Object.fromEntries(
      Object.entries(HORIZONS).map(([hid, h]) => [
        hid,
        {
          label: h.label,
          hold: h.hold,
          holdWeeks: h.holdWeeks,
          idea: h.idea,
          weights: h.weights,
          exitRule: h.exitRule,
          eligible: scored[hid].length,
          picks: picks[hid],
          backtest: evidence[hid],
          live: record.horizons?.[hid] ?? null,
        },
      ])
    ),
    trackRecordAvailable: record.available,
    // Earliest logged session the "shown for N days" counts can see back to.
    shownHistoryFrom,
    factorLabels: FACTOR_LABELS,
    method: {
      topN: TOP_N,
      rebalanceWeeks: REBALANCE_WEEKS,
      costPct: ROUND_TRIP_COST_PCT,
      minTurnoverCr: MIN_DAILY_TURNOVER_CR,
      minPrice: MIN_PRICE,
    },
  };
  cache = { key: latest.date, at: Date.now(), result };
  return result;
}
