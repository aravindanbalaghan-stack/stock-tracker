// Runs a user-built screen (lib/customFields.js) on the market panel —
// today's matches plus a backtest of the same rules over the past months,
// graded exactly like the built-in screens on the Signal scorecard.
//
// Look-ahead is avoided throughout: "prior N days" fields exclude the
// session being tested, and the weekly stage used on a mid-week day is the
// last COMPLETED week's (the current week's close isn't known yet then).

import { universeRows } from "@/lib/marketPanel";
import { FIELD_BY_ID, validateDefinition } from "@/lib/customFields";
import { stageByWeek } from "@/lib/breadth";
import { gradeSignals, makeBench } from "@/lib/scorecard";
import { getMarketCapsCr } from "@/lib/marketCap";
import { getGroups } from "@/lib/rotation";

export const BACKTEST_SESSIONS = 120;
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

// ── per-stock indicator series (NaN where undefined) ─────────────────────
// Only sessions from `startT` on are filled — the screen never looks at
// earlier ones, and long windows (250 days) are the expensive part.
let startT = 0;
function rolling(arr, n, fn, { excludeToday = false } = {}) {
  const T = arr.length;
  const out = new Float64Array(T).fill(NaN);
  for (let t = startT; t < T; t++) {
    const end = excludeToday ? t - 1 : t;
    const vals = [];
    for (let u = end; u >= 0 && vals.length < n; u--) if (Number.isFinite(arr[u])) vals.push(arr[u]);
    if (vals.length === n) out[t] = fn(vals);
  }
  return out;
}
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const max = (v) => Math.max(...v);
const min = (v) => Math.min(...v);

function smaFast(arr, n) {
  const T = arr.length;
  const out = new Float64Array(T).fill(NaN);
  const win = [];
  let sum = 0;
  for (let t = 0; t < T; t++) {
    if (!Number.isFinite(arr[t])) continue;
    win.push(arr[t]);
    sum += arr[t];
    if (win.length > n) sum -= win.shift();
    if (win.length === n) out[t] = sum / n;
  }
  return out;
}

function emaSeries(arr, n) {
  const k = 2 / (n + 1);
  const out = new Float64Array(arr.length).fill(NaN);
  let prev = NaN, seen = 0;
  for (let t = 0; t < arr.length; t++) {
    if (!Number.isFinite(arr[t])) continue;
    prev = Number.isFinite(prev) ? arr[t] * k + prev * (1 - k) : arr[t];
    if (++seen >= n) out[t] = prev;
  }
  return out;
}

function retN(c, n) {
  const out = new Float64Array(c.length).fill(NaN);
  for (let t = n; t < c.length; t++) if (Number.isFinite(c[t]) && Number.isFinite(c[t - n]) && c[t - n] > 0) out[t] = (c[t] / c[t - n] - 1) * 100;
  return out;
}

function rsi(c, n = 14) {
  const out = new Float64Array(c.length).fill(NaN);
  let avgG = 0, avgL = 0, count = 0, prev = NaN;
  for (let t = 0; t < c.length; t++) {
    if (!Number.isFinite(c[t])) continue;
    if (Number.isFinite(prev)) {
      const ch = c[t] - prev;
      const g = Math.max(ch, 0), l = Math.max(-ch, 0);
      count++;
      if (count <= n) {
        avgG += g / n;
        avgL += l / n;
      } else {
        avgG = (avgG * (n - 1) + g) / n;
        avgL = (avgL * (n - 1) + l) / n;
      }
      if (count >= n) out[t] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
    prev = c[t];
  }
  return out;
}

function atrPct(h, l, c, n = 14) {
  const out = new Float64Array(c.length).fill(NaN);
  let atr = NaN, count = 0, prev = NaN;
  for (let t = 0; t < c.length; t++) {
    if (!Number.isFinite(c[t])) continue;
    const tr = Number.isFinite(prev) ? Math.max(h[t] - l[t], Math.abs(h[t] - prev), Math.abs(l[t] - prev)) : h[t] - l[t];
    count++;
    atr = count <= n ? (Number.isFinite(atr) ? atr + tr / n : tr / n) : (atr * (n - 1) + tr) / n;
    if (count >= n) out[t] = (atr / c[t]) * 100;
    prev = c[t];
  }
  return out;
}

function stageSeries(panel, i) {
  const { stages } = stageByWeek(panel, i);
  const T = panel.dates.length;
  const out = new Float64Array(T).fill(NaN);
  const wk = (iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const keys = [...stages.keys()].sort();
  for (let t = 0; t < T; t++) {
    const w = wk(panel.dates[t]);
    const weekEnded = t === T - 1 || wk(panel.dates[t + 1]) !== w;
    // On the week's last session (or today), use this week; otherwise the
    // last completed week.
    let key = weekEnded ? w : null;
    if (!key) {
      for (let k = keys.length - 1; k >= 0; k--) if (keys[k] < w) { key = keys[k]; break; }
    }
    const st = key ? stages.get(key) : undefined;
    if (st != null) out[t] = st;
  }
  return out;
}

function computeField(id, panel, i, get) {
  const c = panel.c[i], h = panel.h[i], l = panel.l[i], v = panel.v[i], d = panel.d[i];
  switch (id) {
    case "close": return c;
    case "chg1": return retN(c, 1);
    case "ret5": return retN(c, 5);
    case "ret20": return retN(c, 20);
    case "ret60": return retN(c, 60);
    case "ret120": return retN(c, 120);
    case "sma10": return smaFast(c, 10);
    case "sma20": return smaFast(c, 20);
    case "sma50": return smaFast(c, 50);
    case "sma100": return smaFast(c, 100);
    case "sma200": return smaFast(c, 200);
    case "ema20": return emaSeries(c, 20);
    case "high20": return rolling(h, 20, max, { excludeToday: true });
    case "high50": return rolling(h, 50, max, { excludeToday: true });
    case "low20": return rolling(l, 20, min, { excludeToday: true });
    case "high52": return rolling(h, 250, max, { excludeToday: true });
    case "low52": return rolling(l, 250, min, { excludeToday: true });
    case "fromHigh52": {
      const hi = rolling(h, 250, max);
      return c.map((x, t) => (Number.isFinite(hi[t]) ? (x / hi[t] - 1) * 100 : NaN));
    }
    case "fromLow52": {
      const lo = rolling(l, 250, min);
      return c.map((x, t) => (Number.isFinite(lo[t]) ? (x / lo[t] - 1) * 100 : NaN));
    }
    case "rsi14": return rsi(c, 14);
    case "atrPct14": return atrPct(h, l, c, 14);
    case "volume": return v;
    case "avgVol20": return rolling(v, 20, mean, { excludeToday: true });
    case "avgVol50": return rolling(v, 50, mean, { excludeToday: true });
    case "volRatio": {
      const a = get("avgVol20");
      return v.map((x, t) => (Number.isFinite(a[t]) && a[t] > 0 ? x / a[t] : NaN));
    }
    case "turnover": return c.map((x, t) => (x * v[t]) / 1e7);
    case "avgTurnover20": return rolling(get("turnover"), 20, mean);
    case "deliv": return d;
    case "avgDeliv20": return rolling(d, 20, mean);
    case "stage": return stageSeries(panel, i);
    default: throw new Error(`Unknown field ${id}`);
  }
}

function fieldGetter(panel, i) {
  const memo = new Map();
  const get = (id) => {
    if (!memo.has(id)) memo.set(id, computeField(id, panel, i, get));
    return memo.get(id);
  };
  return get;
}

function testAt(cond, get, t) {
  const L = get(cond.left);
  const R = cond.right.kind === "field" ? get(cond.right.field) : null;
  const rv = (u) => (R ? R[u] * cond.right.mult : cond.right.value);
  const a = L[t], b = rv(t);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  switch (cond.op) {
    case "gt": return a > b;
    case "gte": return a >= b;
    case "lt": return a < b;
    case "lte": return a <= b;
    case "eq": return Math.abs(a - b) < 1e-9;
    case "crossAbove":
    case "crossBelow": {
      if (t < 1) return false;
      const pa = L[t - 1], pb = rv(t - 1);
      if (!Number.isFinite(pa) || !Number.isFinite(pb)) return false;
      return cond.op === "crossAbove" ? pa <= pb && a > b : pa >= pb && a < b;
    }
    default: return false;
  }
}

const SHOWN = ["close", "chg1", "volRatio", "deliv", "turnover", "stage"];

/**
 * def: from validateDefinition. asOfT: session index for "today's" list
 * (defaults to the latest). Returns { asOf, rows, backtest, … }.
 */
export async function runCustomScreen(panel, rawDef, { asOfT = null } = {}) {
  const def = validateDefinition(rawDef);
  const T = panel.dates.length;
  const from = Math.max(1, T - BACKTEST_SESSIONS);
  const at = asOfT == null ? T - 1 : Math.max(from, Math.min(T - 1, asOfT));
  startT = Math.max(0, from - 2);
  let rows = universeRows(panel, def.universe);

  // Static filters: sector / theme membership, market cap.
  if (def.sectors.length || def.themes.length) {
    const allowed = new Set();
    if (def.sectors.length) {
      const secs = await getGroups("sectors");
      for (const s of secs) if (def.sectors.includes(s.key)) s.symbols.forEach((x) => allowed.add(x));
    }
    if (def.themes.length) {
      const th = await getGroups("themes");
      for (const g of th) if (def.themes.includes(g.name)) g.symbols.forEach((x) => allowed.add(x));
    }
    rows = rows.filter((r) => allowed.has(r.symbol));
  }
  let caps = new Map();
  if (def.mcapMin != null || def.mcapMax != null || rows.length <= 600) {
    caps = await getMarketCapsCr(rows.map((r) => r.symbol), { nseLimit: 0 }).catch(() => new Map());
  }
  if (def.mcapMin != null || def.mcapMax != null) {
    rows = rows.filter((r) => {
      const m = caps.get(r.symbol);
      if (m == null) return false;
      return (def.mcapMin == null || m >= def.mcapMin) && (def.mcapMax == null || m <= def.mcapMax);
    });
  }

  const used = [...new Set(def.conditions.flatMap((c) => [c.left, c.right.kind === "field" ? c.right.field : null]).filter(Boolean))];
  const signalsByT = new Map();
  const matches = [];
  for (const r of rows) {
    const get = fieldGetter(panel, r.i);
    const passAt = (t) => {
      const res = def.conditions.map((c) => testAt(c, get, t));
      return def.logic === "any" ? res.some(Boolean) : res.every(Boolean);
    };
    for (let t = from; t < T; t++) {
      if (passAt(t)) {
        if (!signalsByT.has(t)) signalsByT.set(t, new Set());
        signalsByT.get(t).add(r.symbol);
      }
    }
    if (signalsByT.get(at)?.has(r.symbol)) {
      const row = { symbol: r.symbol, marketCapCr: caps.get(r.symbol) ?? null };
      for (const f of [...SHOWN, ...used]) row[f] = r2(get(f)[at]);
      row.avgTurnover20 = r2(get("avgTurnover20")[at]);
      matches.push(row);
    }
  }
  matches.sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0));

  // Backtest: same grading as the scorecard, fresh entries only.
  const bench = makeBench(panel);
  const graded = gradeSignals(panel, signalsByT, { fresh: true, bench, sinceT: from });
  const all = gradeSignals(panel, signalsByT, { fresh: false, bench, sinceT: from });
  const perDay = [];
  for (let t = from; t < T; t++) perDay.push({ date: panel.dates[t], count: signalsByT.get(t)?.size ?? 0 });

  return {
    asOf: panel.dates[at],
    definition: def,
    universeSize: rows.length,
    usedFields: used.map((id) => ({ id, label: FIELD_BY_ID[id].label, unit: FIELD_BY_ID[id].unit })),
    rows: matches,
    backtest: {
      from: panel.dates[from],
      to: panel.dates[T - 1],
      sessions: T - from,
      fresh: graded.stats,
      everyDay: all.stats,
      signals: graded.signals.slice(0, 150),
      totalSignals: graded.signals.length,
      open: graded.open,
      perDay,
      avgPerDay: r2(perDay.reduce((a, b) => a + b.count, 0) / Math.max(1, perDay.length)),
    },
  };
}
