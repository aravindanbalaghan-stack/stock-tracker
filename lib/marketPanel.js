// A long daily history of every NSE equity, built from NSE's own end-of-day
// bhavcopy files — the one dataset behind Market breadth, Sector rotation,
// the Signal scorecard and the custom screener builder.
//
// Why bhavcopy and not Yahoo: one file per session covers ~2,300 stocks at
// once (Yahoo is one request per stock), and it carries delivery %, which
// Yahoo doesn't.
//
// Storage: one Redis key per session (`bars:v2:YYYY-MM-DD`), the day's
// figures as column arrays, deflate-compressed (~45 KB a day). A session is
// fetched from NSE once, ever; after that it's a Redis read. Filling is
// done newest-first under a time budget, so the first request after deploy
// returns what it has and later requests (and the nightly job) finish the
// rest.
//
// Prices are split/bonus-adjusted: on an ex-date NSE's PREV_CLOSE is the
// adjusted figure, so PREV_CLOSE(t) / CLOSE(t-1) is the adjustment factor
// and every earlier price is scaled by it (volumes by its inverse). Without
// this, a 1:2 split would show as a 50% crash and sit below its 200-DMA
// for a year.

import zlib from "node:zlib";
import { kv } from "@/lib/kv";
import { getBhavcopyForDate } from "@/lib/nseBhavcopy";
import { getHolidaySet } from "@/lib/marketCalendar";
import { expectedSession } from "@/lib/precompute";

export const PANEL_SESSIONS = 320; // 200-DMA warm-up + ~5 months of history
const KEY = (d) => `bars:v2:${d}`;
const FETCH_CONCURRENCY = 6;
const MGET_BATCH = 25;
const ADJUST_THRESHOLD = 0.03; // |prevClose/lastClose − 1| beyond this = corporate action

// ── encoding ────────────────────────────────────────────────────────────
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

export function encodeDay(day) {
  const s = [], h = [], l = [], c = [], p = [], v = [], d = [];
  for (const [sym, r] of day.bySymbol) {
    if (!r.close || !(r.volume > 0)) continue;
    s.push(sym);
    h.push(r2(r.high ?? r.close));
    l.push(r2(r.low ?? r.close));
    c.push(r2(r.close));
    p.push(r2(r.prevClose));
    v.push(r.volume);
    d.push(r.deliveryPct == null ? null : Math.round(r.deliveryPct * 10) / 10);
  }
  const json = JSON.stringify({ s, h, l, c, p, v, d });
  return { z: zlib.deflateRawSync(Buffer.from(json)).toString("base64"), n: s.length };
}

export function decodeDay(rec) {
  if (!rec?.z) return null;
  try {
    return JSON.parse(zlib.inflateRawSync(Buffer.from(rec.z, "base64")).toString());
  } catch {
    return null;
  }
}

// ── trading calendar ────────────────────────────────────────────────────
function isoMinusDays(iso, n) {
  const x = new Date(`${iso}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - n);
  return x.toISOString().slice(0, 10);
}

/** Candidate session dates, newest first: weekdays that aren't known holidays. */
async function candidateDates(latest, wanted) {
  const holidays = await getHolidaySet().catch(() => new Set());
  const out = [];
  for (let i = 0; out.length < wanted && i < wanted * 2 + 60; i++) {
    const d = isoMinusDays(latest, i);
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6 || holidays.has(d)) continue;
    out.push(d);
  }
  return out;
}

// ── store ───────────────────────────────────────────────────────────────
async function readDays(dates) {
  const out = new Map();
  for (let i = 0; i < dates.length; i += MGET_BATCH) {
    const chunk = dates.slice(i, i + MGET_BATCH);
    let vals;
    try {
      vals = await kv.mget(...chunk.map(KEY));
    } catch {
      vals = chunk.map(() => null);
    }
    chunk.forEach((d, j) => vals[j] && out.set(d, vals[j]));
  }
  return out;
}

async function fillDays(dates, deadline, today) {
  let fetched = 0;
  let next = 0;
  const results = new Map();
  const worker = async () => {
    while (next < dates.length && Date.now() < deadline) {
      const d = dates[next++];
      const day = await getBhavcopyForDate(d).catch(() => null);
      if (day && day.bySymbol.size > 100) {
        const rec = encodeDay(day);
        results.set(d, rec);
        await kv.set(KEY(d), rec).catch(() => {});
        fetched++;
      } else if (d < isoMinusDays(today, 4)) {
        // Old date with no file = a holiday we didn't know about. Remember
        // it so it isn't re-requested on every run. Recent misses may just
        // be "not published yet", so those are retried.
        const rec = { none: true };
        results.set(d, rec);
        await kv.set(KEY(d), rec).catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  return { results, fetched };
}

// Module-level cache: a warm serverless instance reuses the decoded panel.
let memo = null;
const MEMO_MS = 20 * 60 * 1000;

/**
 * Loads `sessions` trading days ending at the latest published session.
 *
 * Returns {
 *   dates: ["YYYY-MM-DD", …] oldest first,
 *   symbols: [...], idx: Map(symbol → row),
 *   h, l, c, v, d: arrays (one Float64Array per symbol, NaN = no trade),
 *   coverage: { have, want, complete, fetched }
 * }
 */
export async function loadPanel({ sessions = PANEL_SESSIONS, budgetMs = 25_000, fill = true } = {}) {
  const latest = await expectedSession();
  if (memo && memo.latest === latest && memo.sessions >= sessions && memo.panel.coverage.complete && Date.now() - memo.at < MEMO_MS) {
    return memo.panel;
  }
  const started = Date.now();
  // A few spare candidates absorb holidays the calendar doesn't know about.
  const candidates = await candidateDates(latest, Math.ceil(sessions * 1.06) + 8);
  const stored = await readDays(candidates);
  let fetched = 0;
  if (fill) {
    const missing = candidates.filter((d) => !stored.has(d));
    if (missing.length) {
      const res = await fillDays(missing, started + budgetMs, latest);
      fetched = res.fetched;
      for (const [d, rec] of res.results) stored.set(d, rec);
    }
  }

  // Decode, oldest first, dropping holiday markers and "copy" days (NSE
  // occasionally republishes the previous session under a holiday's date).
  const days = [];
  for (const d of [...candidates].reverse()) {
    const rec = stored.get(d);
    if (!rec || rec.none) continue;
    const day = decodeDay(rec);
    if (!day?.s?.length) continue;
    if (days.length && isCopy(day, days[days.length - 1].day)) continue;
    days.push({ date: d, day });
  }
  const use = days.slice(-sessions);
  const panel = buildMatrix(use);
  const unresolved = candidates.filter((d) => !stored.has(d)).length;
  panel.coverage = {
    have: use.length,
    want: sessions,
    complete: use.length >= sessions || unresolved === 0,
    fetched,
    pending: unresolved,
  };
  panel.latest = use.length ? use[use.length - 1].date : null;
  if (panel.coverage.complete) memo = { latest, sessions, panel, at: Date.now() };
  return panel;
}

function isCopy(a, b) {
  const map = new Map(b.s.map((s, i) => [s, i]));
  let same = 0, checked = 0;
  for (let i = 0; i < a.s.length && checked < 300; i++) {
    const j = map.get(a.s[i]);
    if (j == null) continue;
    checked++;
    if (a.c[i] === b.c[j] && a.v[i] === b.v[j]) same++;
  }
  return checked >= 50 && same / checked > 0.9;
}

function buildMatrix(days) {
  const T = days.length;
  const idx = new Map();
  const symbols = [];
  for (const { day } of days) for (const s of day.s) if (!idx.has(s)) { idx.set(s, symbols.length); symbols.push(s); }
  const N = symbols.length;
  const mk = () => Array.from({ length: N }, () => new Float64Array(T).fill(NaN));
  const h = mk(), l = mk(), c = mk(), v = mk(), dl = mk(), p = mk();
  days.forEach(({ day }, t) => {
    for (let k = 0; k < day.s.length; k++) {
      const i = idx.get(day.s[k]);
      h[i][t] = day.h[k] ?? NaN;
      l[i][t] = day.l[k] ?? NaN;
      c[i][t] = day.c[k] ?? NaN;
      v[i][t] = day.v[k] ?? NaN;
      dl[i][t] = day.d[k] ?? NaN;
      p[i][t] = day.p[k] ?? NaN;
    }
  });
  for (let i = 0; i < N; i++) adjust(h[i], l[i], c[i], v[i], p[i]);
  return { dates: days.map((x) => x.date), symbols, idx, h, l, c, v, d: dl };
}

/** Back-adjusts one stock's history for splits/bonuses, in place. */
export function adjust(h, l, c, v, p) {
  let factor = 1;
  // Walk newest → oldest so each ex-date's factor applies to everything before it.
  for (let t = c.length - 1; t >= 0; t--) {
    if (!Number.isFinite(c[t])) continue;
    if (factor !== 1) {
      c[t] *= factor;
      h[t] *= factor;
      l[t] *= factor;
      if (Number.isFinite(v[t])) v[t] /= factor;
    }
    // Look back for the previous traded session to compare against prevClose.
    let u = t - 1;
    while (u >= 0 && !Number.isFinite(c[u])) u--;
    if (u < 0) break;
    const prev = p[t];
    const raw = c[u]; // not yet adjusted
    if (Number.isFinite(prev) && prev > 0 && raw > 0) {
      const f = prev / raw;
      if (Math.abs(f - 1) > ADJUST_THRESHOLD) factor *= f;
    }
  }
}

// ── shared helpers for the views built on the panel ──────────────────────

/** Mean of the finite values in arr[from..to] (inclusive), or NaN. */
export function meanRange(arr, from, to) {
  let s = 0, n = 0;
  for (let t = Math.max(0, from); t <= to; t++) if (Number.isFinite(arr[t])) { s += arr[t]; n++; }
  return n ? s / n : NaN;
}

/** Rolling simple moving average aligned to `arr` (NaN until `period` trades exist). */
export function rollingSma(arr, period) {
  const out = new Float64Array(arr.length).fill(NaN);
  let sum = 0;
  const win = [];
  for (let t = 0; t < arr.length; t++) {
    const x = arr[t];
    if (!Number.isFinite(x)) continue;
    win.push(x);
    sum += x;
    if (win.length > period) sum -= win.shift();
    if (win.length === period) out[t] = sum / period;
  }
  return out;
}

/** Symbols ranked by average traded value (₹ Cr) over the last `days` sessions. */
export function liquidityRank(panel, days = 20) {
  const T = panel.dates.length;
  const rows = [];
  panel.symbols.forEach((s, i) => {
    let sum = 0, n = 0;
    for (let t = T - days; t < T; t++) {
      if (t < 0) continue;
      const c = panel.c[i][t], v = panel.v[i][t];
      if (Number.isFinite(c) && Number.isFinite(v)) { sum += (c * v) / 1e7; n++; }
    }
    if (n >= Math.min(days, T) * 0.6) rows.push({ symbol: s, i, turnoverCr: sum / n });
  });
  return rows.sort((a, b) => b.turnoverCr - a.turnoverCr);
}

/**
 * The stock universes the views offer:
 *   top500  — the 500 most traded (tracks the NIFTY 500 closely)
 *   liquid  — every stock averaging ≥ ₹1 Cr a day
 */
export function universeRows(panel, universe = "top500") {
  const ranked = liquidityRank(panel);
  if (universe === "liquid") return ranked.filter((r) => r.turnoverCr >= 1);
  if (universe === "all") return ranked;
  return ranked.slice(0, 500);
}

/** Equal-weight average forward return of `rows` from session t over n sessions (%). */
export function benchmarkForward(panel, rows, t, n) {
  const T = panel.dates.length;
  if (t + n >= T) return null;
  let s = 0, k = 0;
  for (const { i } of rows) {
    const a = panel.c[i][t], b = panel.c[i][t + n];
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0) {
      const r = (b / a - 1) * 100;
      if (Math.abs(r) < 300) { s += r; k++; }
    }
  }
  return k ? s / k : null;
}
