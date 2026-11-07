// Trading journal storage — one list per signed-in user, in Redis, split
// by year (journal:<user>:<year>) so no single value grows without bound.

import crypto from "node:crypto";
import { kv } from "@/lib/kv";

const key = (user, year) => `journal:${user}:${year}`;
const yearsKey = (user) => `journal:${user}:years`;

export const SEGMENTS = ["Equity – delivery", "Equity – intraday", "Futures", "Options"];
export const TIMEFRAMES = ["Intraday", "Swing (days)", "Positional (weeks+)"];

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v, max = 2000) => (v === null || v === undefined ? "" : String(v).trim().slice(0, max));
const date = (v) => {
  const s = str(v, 30);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
};
const tags = (v) =>
  (Array.isArray(v) ? v : String(v ?? "").split(/[;,|]/))
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 20);
const bool = (v) => (v === true || v === "true" || v === "yes" || v === "Yes" ? true : v === false || v === "false" || v === "no" || v === "No" ? false : null);

/** Cleans one trade from the form or an import file; returns null if unusable. */
export function normaliseTrade(t) {
  if (!t || typeof t !== "object") return null;
  const symbol = str(t.symbol, 40).toUpperCase();
  const entryDate = date(t.entryDate);
  const quantity = num(t.quantity);
  const entryPrice = num(t.entryPrice);
  if (!symbol || !entryDate || !(quantity > 0) || !(entryPrice > 0)) return null;
  return {
    id: str(t.id, 60) || crypto.randomUUID(),
    symbol,
    segment: SEGMENTS.includes(t.segment) ? t.segment : str(t.segment, 40) || SEGMENTS[0],
    side: /short|sell/i.test(String(t.side)) ? "Short" : "Long",
    entryDate,
    quantity,
    entryPrice,
    stopLoss: num(t.stopLoss),
    target: num(t.target),
    exitDate: date(t.exitDate),
    exitPrice: num(t.exitPrice),
    fees: num(t.fees) ?? 0,
    setup: str(t.setup, 80),
    timeframe: str(t.timeframe, 40),
    confidence: Math.min(5, Math.max(1, num(t.confidence) ?? 3)),
    followedPlan: bool(t.followedPlan),
    emotions: tags(t.emotions),
    mistakes: tags(t.mistakes),
    entryReason: str(t.entryReason),
    exitReason: str(t.exitReason),
    lessons: str(t.lessons),
    screenshotUrl: str(t.screenshotUrl, 500),
    createdAt: str(t.createdAt, 40) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function getJournal(user) {
  const years = (await kv.get(yearsKey(user))) ?? [];
  const lists = await Promise.all(years.map((y) => kv.get(key(user, y))));
  return lists.flatMap((l) => (Array.isArray(l) ? l : [])).sort((a, b) => (a.entryDate < b.entryDate ? 1 : -1));
}

async function saveAll(user, trades) {
  const byYear = new Map();
  for (const t of trades) {
    const y = t.entryDate.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(t);
  }
  const oldYears = (await kv.get(yearsKey(user))) ?? [];
  const years = [...byYear.keys()].sort();
  await Promise.all(years.map((y) => kv.set(key(user, y), byYear.get(y))));
  for (const y of oldYears) if (!byYear.has(y)) await kv.del(key(user, y));
  await kv.set(yearsKey(user), years);
}

export async function upsertTrade(user, raw) {
  const trade = normaliseTrade(raw);
  if (!trade) throw new Error("A trade needs a symbol, entry date, quantity and entry price");
  const all = await getJournal(user);
  const i = all.findIndex((t) => t.id === trade.id);
  if (i >= 0) all[i] = { ...trade, createdAt: all[i].createdAt };
  else all.push(trade);
  await saveAll(user, all);
  return { trade, trades: await getJournal(user) };
}

export async function deleteTrade(user, id) {
  const all = await getJournal(user);
  await saveAll(user, all.filter((t) => t.id !== id));
  return getJournal(user);
}

/** mode "merge": add new / update matching ids. "replace": the file becomes the journal. */
export async function importTrades(user, rows, mode = "merge") {
  const clean = rows.map(normaliseTrade);
  const good = clean.filter(Boolean);
  const all = mode === "replace" ? [] : await getJournal(user);
  const byId = new Map(all.map((t) => [t.id, t]));
  for (const t of good) byId.set(t.id, byId.has(t.id) ? { ...t, createdAt: byId.get(t.id).createdAt } : t);
  await saveAll(user, [...byId.values()]);
  return { imported: good.length, skipped: clean.length - good.length, trades: await getJournal(user) };
}
