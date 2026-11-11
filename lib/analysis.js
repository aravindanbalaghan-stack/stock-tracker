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
  const symbols = [...new Set(recent.flatMap((e) => e.ideas.map((i) => i.symbol)))];
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
