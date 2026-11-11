// Daily Analysis — one entry per trading day per user: the market view
// (bias + levels), the ideas (stock setups with trigger / stop / target),
// a routine checklist, and the post-market review. Panel then GRADES the
// analysis against what prices actually did:
//   - bias calls vs the index's next session (and next 5)
//   - each idea: did it trigger, and did target or stop come first
// so over time you can see how good the analysis is, not just the trades.
//
// Storage: Redis, per user, split by year (analysis:<user>:<year>).

import { kv } from "@/lib/kv";
import { fetchDailyOHLCVBatch, fetchIndexOHLCV } from "@/lib/screenerIndicators";
import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { getResolvedSectorList } from "@/lib/sectorOverrides";
import { getThemeIndex } from "@/lib/stockMaster";
import crypto from "node:crypto";

export const INDEXES = [
  { id: "nifty", label: "NIFTY 50", yahoo: "^NSEI" },
  { id: "bankNifty", label: "BANK NIFTY", yahoo: "^NSEBANK" },
];
export const DEFAULT_CHECKLIST = [
  "Checked global cues and GIFT Nifty",
  "Marked NIFTY / BANK NIFTY levels",
  "Reviewed screener hits",
  "Reviewed open positions and stops",
  "Checked results / events for my stocks",
  "Set my maximum loss for the day",
];

const key = (u, y) => `analysis:${u}:${y}`;
const yearsKey = (u) => `analysis:${u}:years`;
const prefsKey = (u) => `analysis:${u}:prefs`;

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v, max = 4000) => (v === null || v === undefined ? "" : String(v).trim().slice(0, max));
const list = (v, max = 30) =>
  (Array.isArray(v) ? v : String(v ?? "").split(/[;,|]/))
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, max);
const BIASES = ["Bullish", "Bearish", "Neutral"];

function normaliseIdea(i) {
  const symbol = str(i?.symbol, 40).toUpperCase();
  if (!symbol) return null;
  return {
    id: str(i.id, 60) || crypto.randomUUID(),
    symbol,
    direction: /short|sell|bear/i.test(String(i.direction)) ? "Short" : "Long",
    setup: str(i.setup, 80),
    timeframe: str(i.timeframe, 40),
    entry: num(i.entry),
    stop: num(i.stop),
    target: num(i.target),
    horizonDays: Math.min(60, Math.max(1, num(i.horizonDays) ?? 10)),
    thesis: str(i.thesis, 2000),
    carriedFrom: str(i.carriedFrom, 10) || null,
  };
}

// ---------------------------------------------------------------------
// Stock studies — technical analysis of individual stocks, several per day
// ---------------------------------------------------------------------

export const STUDY_TIMEFRAMES = ["Monthly", "Weekly", "Daily", "Intraday"];
export const TRENDS = ["Up", "Sideways", "Down"];
export const VERDICTS = ["Bullish", "Bearish", "Neutral", "Wait"];

const nums = (v) =>
  (Array.isArray(v) ? v : String(v ?? "").split(/[;,|\s]+/))
    .map(num)
    .filter((x) => x != null)
    .slice(0, 8);

function normaliseStudy(st) {
  const symbol = str(st?.symbol, 40).toUpperCase();
  if (!symbol) return null;
  const tf = {};
  for (const t of STUDY_TIMEFRAMES) {
    const v = st?.timeframes?.[t];
    if (v && (v.trend || v.note)) tf[t] = { trend: TRENDS.includes(v.trend) ? v.trend : "", note: str(v.note, 300) };
  }
  const plan = st?.plan ?? {};
  return {
    id: str(st.id, 60) || crypto.randomUUID(),
    symbol,
    timeframes: tf,
    stage: [1, 2, 3, 4].includes(Number(st.stage)) ? Number(st.stage) : null,
    patterns: list(st.patterns, 10),
    candle: str(st.candle, 80),
    supports: nums(st.supports),
    resistances: nums(st.resistances),
    indicators: str(st.indicators, 1000),
    volume: str(st.volume, 1000),
    relativeStrength: str(st.relativeStrength, 300),
    verdict: VERDICTS.includes(st.verdict) ? st.verdict : "",
    conviction: Math.min(5, Math.max(1, num(st.conviction) ?? 3)),
    horizonDays: Math.min(60, Math.max(1, num(st.horizonDays) ?? 10)),
    plan: {
      direction: /short|sell|bear/i.test(String(plan.direction)) ? "Short" : "Long",
      entry: num(plan.entry),
      stop: num(plan.stop),
      target: num(plan.target),
    },
    checklist: typeof st?.checklist === "object" && st.checklist ? Object.fromEntries(Object.entries(st.checklist).map(([k, v]) => [str(k, 200), !!v])) : {},
    notes: str(st.notes, 6000),
    chartUrl: str(st.chartUrl, 500),
    // Panel's own readings at the time of the study (auto-filled).
    auto: st?.auto && typeof st.auto === "object" ? st.auto : null,
    createdAt: str(st.createdAt, 40) || new Date().toISOString(),
  };
}

export function normaliseEntry(e) {
  const date = str(e?.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const bias = {};
  const levels = {};
  for (const ix of INDEXES) {
    bias[ix.id] = BIASES.includes(e?.bias?.[ix.id]) ? e.bias[ix.id] : "";
    levels[ix.id] = { support: num(e?.levels?.[ix.id]?.support), resistance: num(e?.levels?.[ix.id]?.resistance) };
  }
  return {
    date,
    bias,
    confidence: Math.min(5, Math.max(1, num(e?.confidence) ?? 3)),
    levels,
    context: str(e?.context),
    sectorsInFocus: list(e?.sectorsInFocus),
    themesInFocus: list(e?.themesInFocus),
    events: str(e?.events),
    ideas: (Array.isArray(e?.ideas) ? e.ideas : []).map(normaliseIdea).filter(Boolean).slice(0, 40),
    studies: (Array.isArray(e?.studies) ? e.studies : []).map(normaliseStudy).filter(Boolean).slice(0, 30),
    checklist: typeof e?.checklist === "object" && e.checklist ? Object.fromEntries(Object.entries(e.checklist).map(([k, v]) => [str(k, 200), !!v])) : {},
    review: str(e?.review),
    worked: str(e?.worked),
    missed: str(e?.missed),
    lessons: str(e?.lessons),
    mood: list(e?.mood, 10),
    rating: num(e?.rating) != null ? Math.min(5, Math.max(1, num(e.rating))) : null,
    snapshot: e?.snapshot && typeof e.snapshot === "object" ? e.snapshot : null,
    createdAt: str(e?.createdAt, 40) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function getEntries(user) {
  const years = (await kv.get(yearsKey(user))) ?? [];
  const lists = await Promise.all(years.map((y) => kv.get(key(user, y))));
  return lists.flatMap((l) => (Array.isArray(l) ? l : [])).sort((a, b) => (a.date < b.date ? 1 : -1));
}

async function saveAll(user, entries) {
  const byYear = new Map();
  for (const e of entries) {
    const y = e.date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(e);
  }
  const old = (await kv.get(yearsKey(user))) ?? [];
  await Promise.all([...byYear].map(([y, l]) => kv.set(key(user, y), l)));
  for (const y of old) if (!byYear.has(y)) await kv.del(key(user, y));
  await kv.set(yearsKey(user), [...byYear.keys()].sort());
}

export async function upsertEntry(user, raw) {
  const entry = normaliseEntry(raw);
  if (!entry) throw new Error("An analysis entry needs a date");
  const all = await getEntries(user);
  const i = all.findIndex((x) => x.date === entry.date);
  if (i >= 0) all[i] = { ...entry, createdAt: all[i].createdAt };
  else all.push(entry);
  await saveAll(user, all);
  return entry;
}

/** Adds one idea to a day's entry (creating the entry if needed) — used from the stock page. */
export async function addIdea(user, date, rawIdea) {
  const idea = normaliseIdea(rawIdea);
  if (!idea) throw new Error("An idea needs a symbol");
  const all = await getEntries(user);
  const existing = all.find((x) => x.date === date);
  const entry = normaliseEntry({ ...(existing ?? { date }), ideas: [...(existing?.ideas ?? []), idea] });
  return upsertEntry(user, { ...entry, createdAt: existing?.createdAt });
}

export async function deleteEntry(user, date) {
  const all = await getEntries(user);
  await saveAll(user, all.filter((x) => x.date !== date));
}

export async function importEntries(user, rows, mode = "merge") {
  const clean = rows.map(normaliseEntry).filter(Boolean);
  const base = mode === "replace" ? [] : await getEntries(user);
  const byDate = new Map(base.map((e) => [e.date, e]));
  for (const e of clean) byDate.set(e.date, e);
  await saveAll(user, [...byDate.values()]);
  return clean.length;
}

export async function getPrefs(user) {
  const p = (await kv.get(prefsKey(user))) ?? {};
  return { checklist: Array.isArray(p.checklist) && p.checklist.length ? p.checklist : DEFAULT_CHECKLIST };
}
export async function savePrefs(user, prefs) {
  const checklist = list(prefs?.checklist, 20).map((x) => x.slice(0, 120));
  await kv.set(prefsKey(user), { checklist: checklist.length ? checklist : DEFAULT_CHECKLIST });
  return getPrefs(user);
}

// ---------------------------------------------------------------------
// Grading — what actually happened after each call
// ---------------------------------------------------------------------

const istDate = (t) => new Date((t + 19800) * 1000).toISOString().slice(0, 10);
const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

/** Outcome of one idea from daily bars AFTER the idea's date. */
export function evaluateIdea(idea, ideaDate, bars) {
  const after = (bars ?? []).filter((b) => istDate(b.t) > ideaDate);
  const window = after.slice(0, idea.horizonDays);
  const long = idea.direction === "Long";
  if (!window.length) return { status: "Waiting", note: "No session since the idea yet" };

  let fill = null;
  let fillIdx = -1;
  for (let i = 0; i < window.length; i++) {
    const b = window[i];
    if (idea.entry == null) {
      fill = b.o;
      fillIdx = i;
      break;
    }
    if (long ? b.h >= idea.entry : b.l <= idea.entry) {
      // Gapped through the trigger → filled at the open, not the level.
      fill = long ? Math.max(idea.entry, b.o) : Math.min(idea.entry, b.o);
      fillIdx = i;
      break;
    }
  }
  const done = window.length >= idea.horizonDays;
  if (fillIdx < 0) return { status: done ? "Not triggered" : "Waiting", note: done ? `Trigger not reached in ${idea.horizonDays} sessions` : "Trigger not reached yet" };

  const risk = idea.stop != null ? Math.abs(fill - idea.stop) : null;
  const ret = (px) => (long ? px / fill - 1 : fill / px - 1) * 100;
  for (let i = fillIdx; i < window.length; i++) {
    const b = window[i];
    const stopHit = idea.stop != null && (long ? b.l <= idea.stop : b.h >= idea.stop);
    const tgtHit = idea.target != null && (long ? b.h >= idea.target : b.l <= idea.target);
    // Both in the same session: assume the stop came first (conservative).
    if (stopHit) {
      return { status: "Stop hit", fill: r2(fill), exit: idea.stop, exitDate: istDate(b.t), returnPct: r2(ret(idea.stop)), r: risk ? -1 : null, sessions: i - fillIdx + 1 };
    }
    if (tgtHit) {
      return {
        status: "Target hit",
        fill: r2(fill),
        exit: idea.target,
        exitDate: istDate(b.t),
        returnPct: r2(ret(idea.target)),
        r: risk ? r2(Math.abs(idea.target - fill) / risk) : null,
        sessions: i - fillIdx + 1,
      };
    }
  }
  const last = window[window.length - 1];
  const rp = ret(last.c);
  return {
    status: done ? "Time exit" : "Open",
    fill: r2(fill),
    exit: done ? r2(last.c) : null,
    exitDate: done ? istDate(last.t) : null,
    lastClose: r2(last.c),
    returnPct: r2(rp),
    r: risk ? r2(((long ? last.c - fill : fill - last.c) / risk)) : null,
    sessions: window.length - fillIdx,
  };
}

/**
 * A study's verdict vs the stock's move 5 / 10 / 20 sessions later, and its
 * trade plan graded like an idea. Bullish is right if the stock rose,
 * Bearish if it fell, Neutral if it stayed within ±3%; "Wait" isn't graded.
 */
function gradeStudy(st, date, bars) {
  const out = { ...st };
  if (bars?.length) {
    const baseIdx = bars.findLastIndex((b) => istDate(b.t) <= date);
    if (baseIdx >= 0) {
      const base = bars[baseIdx].c;
      const move = (n) => (baseIdx + n < bars.length ? r2((bars[baseIdx + n].c / base - 1) * 100) : null);
      const right = (m) =>
        m == null || !st.verdict || st.verdict === "Wait" ? null : st.verdict === "Bullish" ? m > 0 : st.verdict === "Bearish" ? m < 0 : Math.abs(m) <= 3;
      const m5 = move(5);
      const m10 = move(10);
      const m20 = move(20);
      const sinceIdx = bars.length - 1;
      out.verdictGrade = {
        move5: m5,
        move10: m10,
        move20: m20,
        moveSince: r2((bars[sinceIdx].c / base - 1) * 100),
        correct5: right(m5),
        correct10: right(m10),
        correct20: right(m20),
        // The grade that counts: at the study's own horizon.
        correct: right(move(st.horizonDays)),
        priceAtStudy: r2(base),
      };
    }
  }
  if (st.plan && (st.plan.stop != null || st.plan.target != null || st.plan.entry != null)) {
    out.planOutcome = evaluateIdea({ ...st.plan, horizonDays: st.horizonDays }, date, bars);
  }
  return out;
}

function evaluateBias(bias, date, bars) {
  if (!bias || !bars?.length) return null;
  const idx = bars.findIndex((b) => istDate(b.t) > date);
  const base = idx > 0 ? bars[idx - 1] : idx === -1 ? bars[bars.length - 1] : null;
  if (!base || istDate(base.t) > date) return null;
  if (idx === -1) return { bias, status: "Pending" };
  const next = bars[idx];
  const move1 = (next.c / base.c - 1) * 100;
  const five = bars[Math.min(idx + 4, bars.length - 1)];
  const move5 = idx + 4 < bars.length ? (five.c / base.c - 1) * 100 : null;
  const right = (m) => (m == null ? null : bias === "Bullish" ? m > 0 : bias === "Bearish" ? m < 0 : Math.abs(m) <= 0.5);
  return { bias, move1: r2(move1), move5: r2(move5), correct1: right(move1), correct5: right(move5), nextDate: istDate(next.t) };
}

/** Grades every entry's bias calls and ideas (last ~250 days). */
export async function gradeEntries(entries) {
  const recent = entries.filter((e) => e.date >= new Date(Date.now() - 370 * 86400000).toISOString().slice(0, 10));
  const symbols = [...new Set(recent.flatMap((e) => [...e.ideas.map((i) => i.symbol), ...(e.studies ?? []).map((s) => s.symbol)]))];
  const [stockBars, ...indexBars] = await Promise.all([
    symbols.length ? fetchDailyOHLCVBatch(symbols, { concurrency: 10, range: "2y" }) : new Map(),
    ...INDEXES.map((ix) => fetchIndexOHLCV(ix.yahoo, "2y").catch(() => null)),
  ]);
  return entries.map((e) => {
    if (!recent.includes(e)) return e;
    const biasGrade = {};
    INDEXES.forEach((ix, k) => {
      biasGrade[ix.id] = e.bias[ix.id] ? evaluateBias(e.bias[ix.id], e.date, indexBars[k]?.bars) : null;
    });
    return {
      ...e,
      biasGrade,
      ideas: e.ideas.map((i) => ({ ...i, outcome: evaluateIdea(i, e.date, stockBars.get(i.symbol)?.bars) })),
      studies: (e.studies ?? []).map((st) => gradeStudy(st, e.date, stockBars.get(st.symbol)?.bars)),
    };
  });
}

// ---------------------------------------------------------------------
// Market snapshot — saved with each day's entry
// ---------------------------------------------------------------------

export async function marketSnapshot(date) {
  const days = await getRecentBhavcopies(45, 90);
  const idx = days.findLastIndex((d) => d.date <= date);
  if (idx < 0) return { date, available: false };
  const day = days[idx];
  const prior20 = days.slice(Math.max(0, idx - 20), idx);

  let adv = 0;
  let dec = 0;
  let unch = 0;
  let highs = 0;
  let lows = 0;
  const changes = new Map();
  for (const [sym, r] of day.bySymbol) {
    if (r.series !== "EQ" || !r.close || !r.prevClose || !r.volume) continue;
    const ch = (r.close / r.prevClose - 1) * 100;
    changes.set(sym, ch);
    if (ch > 0.05) adv++;
    else if (ch < -0.05) dec++;
    else unch++;
    if (prior20.length >= 15) {
      const hs = prior20.map((d) => d.bySymbol.get(sym)?.high).filter((v) => v != null);
      const ls = prior20.map((d) => d.bySymbol.get(sym)?.low).filter((v) => v != null);
      if (hs.length >= 15 && r.high > Math.max(...hs)) highs++;
      if (ls.length >= 15 && r.low < Math.min(...ls)) lows++;
    }
  }

  const groupMoves = (groups) =>
    groups
      .map((g) => {
        const v = g.symbols.map((s) => changes.get(s)).filter((x) => x != null);
        return v.length >= 3 ? { name: g.name, change: r2(v.reduce((a, b) => a + b, 0) / v.length), count: v.length } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.change - a.change);

  const [sectors, themeIdx, ...indexBars] = await Promise.all([
    getResolvedSectorList().catch(() => []),
    getThemeIndex().catch(() => ({ themes: [], bySymbol: {} })),
    ...[...INDEXES, { id: "midcap", label: "MIDCAP 100", yahoo: "^CNXMIDCAP" }, { id: "smallcap", label: "SMALLCAP 100", yahoo: "^CNXSC" }, { id: "vix", label: "INDIA VIX", yahoo: "^INDIAVIX" }].map((ix) =>
      fetchIndexOHLCV(ix.yahoo, "3mo").then((r) => ({ ix, bars: r?.bars ?? [] })).catch(() => ({ ix, bars: [] }))
    ),
  ]);
  const themeGroups = themeIdx.themes.map((t) => ({
    name: t.name,
    symbols: Object.entries(themeIdx.bySymbol).filter(([, n]) => n.includes(t.name)).map(([s]) => s),
  }));
  const sectorMoves = groupMoves(sectors);
  const themeMoves = groupMoves(themeGroups);

  const indexes = indexBars.map(({ ix, bars }) => {
    const i = bars.findLastIndex((b) => istDate(b.t) <= day.date);
    if (i < 1) return { id: ix.id, label: ix.label, close: null };
    return { id: ix.id, label: ix.label, close: r2(bars[i].c), change: r2((bars[i].c / bars[i - 1].c - 1) * 100) };
  });

  return {
    date: day.date,
    available: true,
    indexes,
    breadth: { advances: adv, declines: dec, unchanged: unch, ratio: dec ? r2(adv / dec) : null, new20dHighs: highs, new20dLows: lows },
    topSectors: sectorMoves.slice(0, 5),
    bottomSectors: sectorMoves.slice(-5).reverse(),
    topThemes: themeMoves.slice(0, 5),
    bottomThemes: themeMoves.slice(-5).reverse(),
  };
}

// ---------------------------------------------------------------------
// Auto-fill — Panel's own technical readings for a study
// ---------------------------------------------------------------------

function smaAt(c, n, end = c.length - 1) {
  if (end + 1 < n) return null;
  let t = 0;
  for (let i = end - n + 1; i <= end; i++) t += c[i];
  return t / n;
}
function rsi(c, n = 14) {
  if (c.length <= n + 1) return null;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  g /= n;
  l /= n;
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function emaSeries(c, n) {
  const k = 2 / (n + 1);
  const out = [];
  let e = c[0];
  for (const x of c) {
    e = x * k + e * (1 - k);
    out.push(e);
  }
  return out;
}
function trendOf(c, n, slopeBack) {
  const ma = smaAt(c, n);
  const prev = smaAt(c, n, c.length - 1 - slopeBack);
  if (ma == null || prev == null) return { trend: "", ma: null };
  const last = c[c.length - 1];
  const rising = ma > prev * 1.002;
  const falling = ma < prev * 0.998;
  return { trend: last > ma && rising ? "Up" : last < ma && falling ? "Down" : "Sideways", ma: r2(ma), rising, falling };
}
function groupBars(bars, keyOf) {
  const m = new Map();
  for (const b of bars) {
    const k = keyOf(b);
    const g = m.get(k);
    if (!g) m.set(k, { k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 });
    else {
      g.h = Math.max(g.h, b.h);
      g.l = Math.min(g.l, b.l);
      g.c = b.c;
      g.v += b.v ?? 0;
    }
  }
  return [...m.values()];
}
// Swing pivots (a high/low that's the extreme of the 5 bars either side).
function pivots(bars, span = 5) {
  const highs = [];
  const lows = [];
  for (let i = span; i < bars.length - span; i++) {
    const win = bars.slice(i - span, i + span + 1);
    if (bars[i].h === Math.max(...win.map((b) => b.h))) highs.push(bars[i].h);
    if (bars[i].l === Math.min(...win.map((b) => b.l))) lows.push(bars[i].l);
  }
  return { highs, lows };
}

/** Readings for one stock as of `date` (defaults to the latest session). */
export async function studyTechnicals(symbol, date) {
  const sym = String(symbol).trim().toUpperCase();
  const [hist, nifty, days] = await Promise.all([
    fetchDailyOHLCVBatch([sym], { concurrency: 1, range: "5y" }).then((m) => m.get(sym)),
    fetchIndexOHLCV("^NSEI", "1y").catch(() => null),
    getRecentBhavcopies(25, 50).catch(() => []),
  ]);
  const cut = date ? Math.floor(new Date(`${date}T23:59:59+05:30`).getTime() / 1000) : Infinity;
  const bars = (hist?.bars ?? []).filter((b) => b.t <= cut);
  if (bars.length < 60) return { symbol: sym, available: false };
  const c = bars.map((b) => b.c);
  const last = bars[bars.length - 1];
  const close = last.c;

  const daily = trendOf(c, 50, 10);
  const weeklyBars = groupBars(bars, (b) => {
    const d = new Date((b.t + 19800) * 1000);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  });
  const monthlyBars = groupBars(bars, (b) => istDate(b.t).slice(0, 7));
  const wc = weeklyBars.map((b) => b.c);
  const weekly = trendOf(wc, 30, 4);
  const monthly = trendOf(monthlyBars.map((b) => b.c), 10, 2);

  // Weinstein stage from the 30-week MA: above & rising = 2, below & falling = 4;
  // otherwise 1 (after a decline) or 3 (after an advance).
  let stage = null;
  if (weekly.ma != null) {
    if (weekly.trend === "Up") stage = 2;
    else if (weekly.trend === "Down") stage = 4;
    else {
      const ma26Ago = smaAt(wc, 30, wc.length - 27);
      stage = ma26Ago != null && weekly.ma > ma26Ago ? 3 : 1;
    }
  }

  const sma20 = smaAt(c, 20);
  const sma50 = smaAt(c, 50);
  const sma200 = smaAt(c, 200);
  const e12 = emaSeries(c, 12);
  const e26 = emaSeries(c, 26);
  const macd = e12.map((x, i) => x - e26[i]);
  const signal = emaSeries(macd, 9);
  const hist3 = [-3, -2, -1].map((k) => macd.at(k) - signal.at(k));
  const macdState =
    hist3[2] > 0 && hist3[0] <= 0 ? "Bullish crossover (last 3 sessions)" : hist3[2] < 0 && hist3[0] >= 0 ? "Bearish crossover (last 3 sessions)" : hist3[2] > 0 ? "Above signal" : "Below signal";
  const year = bars.slice(-250);
  const hi52 = Math.max(...year.map((b) => b.h));
  const lo52 = Math.min(...year.map((b) => b.l));
  const vols = bars.slice(-21, -1).map((b) => b.v).filter((v) => v > 0);
  const avgVol20 = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null;
  let atr = 0;
  for (let i = bars.length - 14; i < bars.length; i++) {
    const b = bars[i];
    const p = bars[i - 1].c;
    atr += Math.max(b.h - b.l, Math.abs(b.h - p), Math.abs(b.l - p));
  }
  atr /= 14;

  // Relative strength vs NIFTY 50 over ~3 months.
  let rs3m = null;
  const nb = (nifty?.bars ?? []).filter((b) => b.t <= cut);
  if (nb.length > 63 && c.length > 63) {
    rs3m = r2((c.at(-1) / c.at(-64) - 1) * 100 - (nb.at(-1).c / nb.at(-64).c - 1) * 100);
  }

  // Nearest swing levels from the last ~9 months of daily bars.
  const pv = pivots(bars.slice(-190));
  const supports = [...new Set(pv.lows.filter((x) => x < close).map((x) => r2(x)))].sort((a, b) => b - a).slice(0, 3);
  const resistances = [...new Set(pv.highs.filter((x) => x > close).map((x) => r2(x)))].sort((a, b) => a - b).slice(0, 3);

  // Delivery from NSE (as of the same day).
  const upto = days.filter((d) => !date || d.date <= date);
  const today = upto.at(-1)?.bySymbol.get(sym);
  let dq = 0;
  let dv = 0;
  for (const d of upto.slice(-20)) {
    const r = d.bySymbol.get(sym);
    if (r?.volume) {
      dq += r.deliveryQty || 0;
      dv += r.volume;
    }
  }

  return {
    symbol: sym,
    available: true,
    asOf: istDate(last.t),
    close: r2(close),
    trends: { Monthly: monthly.trend, Weekly: weekly.trend, Daily: daily.trend },
    stage,
    ma: {
      sma20: r2(sma20),
      sma50: r2(sma50),
      sma200: r2(sma200),
      above20: sma20 != null ? close > sma20 : null,
      above50: sma50 != null ? close > sma50 : null,
      above200: sma200 != null ? close > sma200 : null,
      ma30w: weekly.ma,
    },
    rsiDaily: r2(rsi(c)),
    rsiWeekly: r2(rsi(wc)),
    macd: macdState,
    fromHigh52Pct: r2((close / hi52 - 1) * 100),
    fromLow52Pct: r2((close / lo52 - 1) * 100),
    atrPct: r2((atr / close) * 100),
    volVs20: avgVol20 ? r2(last.v / avgVol20) : null,
    deliveryPct: today?.deliveryPct ?? null,
    delivery20Pct: dv ? r2((dq / dv) * 100) : null,
    rs3mVsNifty: rs3m,
    supports,
    resistances,
  };
}
