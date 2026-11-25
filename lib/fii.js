// FII / DII — what foreign and domestic institutions are doing, from the
// public sources that exist:
//
//   Cash flows      NSE's daily FII/FPI & DII buy / sell / net (₹ Cr). NSE
//                   only serves the latest day, so each day is stored as it
//                   comes and the history builds from there.
//   Derivatives     NSE's participant-wise open interest file: FII long vs
//                   short in index futures and options (archived daily, so
//                   it's backfilled).
//   Sectors         NSDL's fortnightly sector-wise FPI report — the official
//                   record of which sectors FPIs put money into or pulled
//                   out of (net equity investment, ₹ Cr).
//   Stocks          Bulk and block deals (NSE), with the client classified
//                   FII / DII from its name (lib/fiiClassify.js). Exchanges
//                   don't publish FII trades per stock otherwise, so this is
//                   "big, disclosed institutional trades", not every trade.

import { kv } from "@/lib/kv";
import { nseApiFetch, getSessionCookies, nseApiFetchWithCookies } from "@/lib/nseSession";
import { participantOiOn, indexClosesOn, parseCsvRows, num } from "@/lib/nseArchives";
import { classifyClient } from "@/lib/fiiClassify";
import { getHolidaySet } from "@/lib/marketCalendar";
import { BROWSER_UA as UA } from "@/lib/browserUA";

const K = {
  cash: "fii:cash:v1",
  oi: "fii:oi:v1",
  sectors: "fii:sectors:v1",
  dealsIndex: "fii:deals:v1:index",
  deals: (iso) => `fii:deals:v1:${iso}`,
  dealsBackfilled: "fii:deals:v1:backfilled",
  idx: "fii:idx:v1",
};
const KEEP_CASH_DAYS = 400;
const KEEP_OI_DAYS = 60;
const KEEP_DEAL_DAYS = 130;
const KEEP_FORTNIGHTS = 24;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const isoToday = () => new Date(Date.now() + 19800 * 1000).toISOString().slice(0, 10);

/** "19-Nov-2026" / "19-11-2026" / "19 Nov 2026" → "2026-11-19". */
export function parseNseDate(s) {
  const m = String(s ?? "").trim().match(/^(\d{1,2})[-\s/]([A-Za-z]{3,9}|\d{1,2})[-\s/](\d{4})/);
  if (!m) return null;
  const mon = /\d/.test(m[2]) ? Number(m[2]) : MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
  if (!(mon >= 1)) return null;
  return `${m[3]}-${String(mon).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

async function tradingDaysBack(n, until = isoToday()) {
  const holidays = await getHolidaySet().catch(() => new Set());
  const out = [];
  const d = new Date(`${until}T00:00:00Z`);
  while (out.length < n) {
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !holidays.has(iso)) out.push(iso);
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

// ---------------------------------------------------------------------
// Cash: FII / DII daily activity
// ---------------------------------------------------------------------

/** NSE's rows → { date, fii:{buy,sell,net}, dii:{…} }. */
export function parseCashRows(rows) {
  if (!Array.isArray(rows)) return null;
  const out = {};
  for (const r of rows) {
    const cat = String(r.category ?? "").toUpperCase();
    const who = cat.startsWith("FII") || cat.includes("FPI") ? "fii" : cat.startsWith("DII") ? "dii" : null;
    if (!who) continue;
    out.date = parseNseDate(r.date) ?? out.date;
    out[who] = { buy: r2(num(r.buyValue)), sell: r2(num(r.sellValue)), net: r2(num(r.netValue)) };
  }
  return out.date && out.fii ? out : null;
}

async function refreshCash() {
  const rows = await nseApiFetch("/api/fiidiiTradeReact");
  const day = parseCashRows(rows);
  if (!day) return { ok: false };
  const store = (await kv.get(K.cash).catch(() => null)) ?? {};
  store[day.date] = { fii: day.fii, dii: day.dii ?? null };
  const dates = Object.keys(store).sort().slice(-KEEP_CASH_DAYS);
  await kv.set(K.cash, Object.fromEntries(dates.map((d) => [d, store[d]])));
  return { ok: true, date: day.date };
}

// ---------------------------------------------------------------------
// Derivatives: participant open interest (backfilled from NSE's archive)
// ---------------------------------------------------------------------

async function refreshOi() {
  const store = (await kv.get(K.oi).catch(() => null)) ?? {};
  const days = await tradingDaysBack(KEEP_OI_DAYS);
  const todo = days.filter((d) => !store[d]).slice(-45);
  for (let i = 0; i < todo.length; i += 8) {
    const got = await Promise.all(todo.slice(i, i + 8).map((d) => participantOiOn(d).then((v) => [d, v])));
    for (const [d, v] of got) if (v) store[d] = { fii: v.fii, dii: v.dii ?? null, client: v.client ?? null, pro: v.pro ?? null };
  }
  const keep = Object.keys(store).sort().slice(-KEEP_OI_DAYS);
  await kv.set(K.oi, Object.fromEntries(keep.map((d) => [d, store[d]])));
  return { ok: keep.length > 0, latest: keep.at(-1) ?? null };
}

// ---------------------------------------------------------------------
// NIFTY 50 and India VIX closes, every session — so each day's flows and
// positioning sit next to what the market actually did. From NSE's daily
// index file (archived, so it's backfilled like the OI file).
// ---------------------------------------------------------------------

async function refreshIndex() {
  const store = (await kv.get(K.idx).catch(() => null)) ?? {};
  const days = await tradingDaysBack(KEEP_CASH_DAYS > 120 ? 120 : KEEP_CASH_DAYS);
  const todo = days.filter((d) => !store[d]).slice(-80);
  for (let i = 0; i < todo.length; i += 8) {
    const got = await Promise.all(todo.slice(i, i + 8).map((d) => indexClosesOn(d).then((v) => [d, v]).catch(() => [d, null])));
    for (const [d, v] of got) {
      if (!v?.["nifty 50"]) continue;
      const pick = (n) => (v[n] ? { c: v[n].c, chg: v[n].changePct ?? null } : null);
      store[d] = { nifty: pick("nifty 50"), bank: pick("nifty bank"), vix: pick("india vix") };
    }
  }
  const keep = Object.keys(store).sort().slice(-400);
  await kv.set(K.idx, Object.fromEntries(keep.map((d) => [d, store[d]])));
  return { ok: keep.length > 0, latest: keep.at(-1) ?? null };
}

/**
 * NSE index-derivative expiries for a set of dates: Nifty weekly contracts
 * expire on Tuesday, monthly on the month's last Tuesday; a Tuesday holiday
 * moves the expiry to the previous trading day.
 */
export function expiryFlags(dates, holidays = new Set()) {
  const isTrading = (iso) => {
    const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
    return d !== 0 && d !== 6 && !holidays.has(iso);
  };
  const shiftBack = (iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    while (!isTrading(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };
  const out = {};
  for (const iso of dates) {
    const d = new Date(`${iso}T00:00:00Z`);
    // Expiry for the week containing `iso` (Mon–Sun).
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const weekTue = new Date(monday);
    weekTue.setUTCDate(monday.getUTCDate() + 1);
    const weekly = shiftBack(weekTue.toISOString().slice(0, 10));
    // Last Tuesday of the month.
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() - 2 + 7) % 7));
    const monthly = shiftBack(last.toISOString().slice(0, 10));
    if (iso === monthly) out[iso] = "monthly";
    else if (iso === weekly) out[iso] = "weekly";
  }
  return out;
}

// ---------------------------------------------------------------------
// Sectors: NSDL fortnightly sector-wise FPI investment
// ---------------------------------------------------------------------

const strip = (html) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * One NSDL report → { aucStart, aucEnd, periods:[label1,label2], sectors:[{name, net1, net2, auc}], total }.
 * Each report covers two fortnights: four column groups (AUC start, net
 * investment ×2, AUC end), each in ₹ Cr then US$ Mn; equity is the first
 * column of each currency block.
 */
export function parseNsdlSectorReport(html) {
  const text = strip(html);
  const periods = [...text.matchAll(/Net Investment\s+([A-Za-z]+\.?\s+\d{1,2}\s*-\s*\d{1,2},?\s*\d{4})/gi)].map((m) => m[1].replace(/\s+/g, " "));
  const aucs = [...text.matchAll(/AUC as on\s+([A-Za-z]+\.?\s+\d{1,2},?\s*\d{4})/gi)].map((m) => m[1]);
  const rows = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => [...m[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => strip(c[1])));
  const sectors = [];
  let total = null;
  for (const cells of rows) {
    if (cells.length < 6) continue;
    const isTotal = /total/i.test(cells[0]) || /total/i.test(cells[1] ?? "");
    const serial = /^\d+$/.test(cells[0]);
    if (!serial && !isTotal) continue;
    const name = isTotal ? "Total" : cells[1];
    if (!name || /^\d/.test(name)) continue;
    const nums = cells.slice(isTotal && !/total/i.test(cells[1] ?? "") ? 1 : 2);
    if (nums.length < 8 || nums.length % 4 !== 0) continue;
    const per = nums.length / 4;
    const eq = (g) => num(nums[g * per]);
    const row = { name, aucStart: eq(0), net1: eq(1), net2: eq(2), auc: eq(3) };
    if (row.net2 == null && row.net1 == null) continue;
    if (isTotal) total = row;
    else sectors.push(row);
  }
  return sectors.length >= 5 ? { periods, aucs, sectors, total } : null;
}

/** Fortnight end dates (15th and month-end), newest first. */
function fortnightEnds(n, from = isoToday()) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth();
  while (out.length < n) {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (const day of [last, 15]) {
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (iso <= from) out.push(iso);
    }
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  return out.slice(0, n);
}

// NSDL's file names aren't consistent about the month: "Oct", "October",
// "OCT", "Sept", ".htm"… so a fortnight is tried under each spelling.
function nsdlUrls(iso) {
  const [y, mo, d] = iso.split("-");
  const i = Number(mo) - 1;
  const short = MONTHS[i][0].toUpperCase() + MONTHS[i].slice(1);
  const names = [...new Set([short, FULL[i], short.toUpperCase(), FULL[i].toUpperCase(), i === 8 ? "Sept" : null].filter(Boolean))];
  const urls = [];
  for (const host of ["https://www.fpi.nsdl.co.in", "https://fpi.nsdl.co.in"])
    for (const nm of names)
      for (const ext of ["html", "htm"]) urls.push(`${host}/web/StaticReports/Fortnightly_Sector_wise_FII_Investment_Data/FIIInvestSector_${nm}${d}${y}.${ext}`);
  return urls;
}

async function fetchNsdl(iso) {
  const tryUrl = async (url) => {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, next: { revalidate: 86400 } });
    if (!res.ok) throw new Error(String(res.status));
    const parsed = parseNsdlSectorReport(await res.text());
    if (!parsed) throw new Error("unparsed");
    return { ...parsed, url };
  };
  const urls = nsdlUrls(iso);
  // A few at a time — the right spelling usually comes early.
  for (let i = 0; i < urls.length; i += 4) {
    try {
      return await Promise.any(urls.slice(i, i + 4).map(tryUrl));
    } catch {
      // next batch of spellings
    }
  }
  return null;
}

async function refreshSectors() {
  const store = (await kv.get(K.sectors).catch(() => null)) ?? {};
  // Reports appear a few days after the fortnight ends.
  const ends = fortnightEnds(8, new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10));
  const todo = ends.filter((e) => !store[e]).slice(0, 4);
  const got = await Promise.all(todo.map((e) => fetchNsdl(e).then((v) => [e, v]).catch(() => [e, null])));
  for (const [e, v] of got) if (v) store[e] = v;
  const keep = Object.keys(store).sort().slice(-KEEP_FORTNIGHTS);
  await kv.set(K.sectors, Object.fromEntries(keep.map((k) => [k, store[k]])));
  return { ok: keep.length > 0, latest: keep.at(-1) ?? null, fetched: got.filter(([, v]) => v).map(([e]) => e) };
}

// ---------------------------------------------------------------------
// Stocks: bulk & block deals by FIIs / DIIs
// ---------------------------------------------------------------------

const keyLike = (row, re) => {
  const k = Object.keys(row).find((x) => re.test(x));
  return k ? row[k] : null;
};

/** One NSE deal row (API JSON or archive CSV) → compact deal, or null. */
export function normaliseDeal(row, kind) {
  const client = keyLike(row, /client/i);
  const who = classifyClient(client);
  if (!who) return null;
  const side = String(keyLike(row, /buy.?sell/i) ?? "").trim().toUpperCase().startsWith("S") ? "S" : "B";
  const qty = num(keyLike(row, /qty|quantity/i));
  const price = num(keyLike(row, /price|watp/i));
  const symbol = String(keyLike(row, /symbol/i) ?? "").trim().toUpperCase();
  const date = parseNseDate(keyLike(row, /date/i));
  if (!symbol || !date || !(qty > 0) || !(price > 0)) return null;
  return { d: date, s: symbol, c: String(client).trim().slice(0, 80), w: who, side, q: qty, p: r2(price), k: kind, cr: r2((qty * price) / 1e7) };
}

async function fetchDealsRange(from, to) {
  const f = `${from.slice(8, 10)}-${from.slice(5, 7)}-${from.slice(0, 4)}`;
  const t = `${to.slice(8, 10)}-${to.slice(5, 7)}-${to.slice(0, 4)}`;
  const cookies = await getSessionCookies().catch(() => "");
  const [bulk, block] = await Promise.all([
    nseApiFetchWithCookies(`/api/historical/bulk-deals?from=${f}&to=${t}`, cookies, 20000),
    nseApiFetchWithCookies(`/api/historical/block-deals?from=${f}&to=${t}`, cookies, 20000),
  ]);
  const rows = (x) => (Array.isArray(x?.data) ? x.data : Array.isArray(x) ? x : null);
  if (!rows(bulk) && !rows(block)) return null;
  return [...(rows(bulk) ?? []).map((r) => normaliseDeal(r, "bulk")), ...(rows(block) ?? []).map((r) => normaliseDeal(r, "block"))].filter(Boolean);
}

// Today's files on the archive host — a fallback when NSE's API refuses.
async function fetchDealsArchive() {
  const get = async (name, kind) => {
    try {
      const res = await fetch(`https://nsearchives.nseindia.com/content/equities/${name}`, { headers: { "User-Agent": UA }, cache: "no-store" });
      if (!res.ok) return [];
      return parseCsvRows(await res.text(), (l) => /client/i.test(l)).map((r) => normaliseDeal(r, kind)).filter(Boolean);
    } catch {
      return [];
    }
  };
  const [a, b] = await Promise.all([get("bulk.csv", "bulk"), get("block.csv", "block")]);
  return [...a, ...b];
}

async function refreshDeals() {
  const index = (await kv.get(K.dealsIndex).catch(() => null)) ?? [];
  const backfilled = await kv.get(K.dealsBackfilled).catch(() => null);
  const today = isoToday();
  const from = new Date(Date.now() - (backfilled ? 7 : 92) * 86400000).toISOString().slice(0, 10);
  let deals = await fetchDealsRange(from, today);
  const viaApi = deals != null;
  if (!deals) deals = await fetchDealsArchive();
  const byDay = new Map();
  for (const x of deals) byDay.set(x.d, [...(byDay.get(x.d) ?? []), x]);
  await Promise.all([...byDay].map(([d, list]) => kv.set(K.deals(d), list)));
  const all = [...new Set([...index, ...byDay.keys()])].sort();
  const cutoff = new Date(Date.now() - KEEP_DEAL_DAYS * 86400000).toISOString().slice(0, 10);
  await kv.set(K.dealsIndex, all.filter((d) => d >= cutoff));
  if (viaApi && !backfilled) await kv.set(K.dealsBackfilled, today);
  return { ok: viaApi || deals.length > 0, source: viaApi ? "api" : "archive", days: byDay.size, deals: deals.length };
}

export async function loadDeals(sinceIso) {
  const index = ((await kv.get(K.dealsIndex).catch(() => null)) ?? []).filter((d) => d >= sinceIso);
  if (!index.length) return [];
  const lists = await kv.mget(...index.map(K.deals)).catch(() => []);
  return lists.flatMap((l) => (Array.isArray(l) ? l : []));
}

// ---------------------------------------------------------------------
// Refresh + views
// ---------------------------------------------------------------------

/** Pull every source; each is independent and best-effort. */
export async function refreshAll() {
  const settle = (p) => p.catch((e) => ({ ok: false, error: String(e?.message || e) }));
  const [cash, oi, sectors, deals, index] = await Promise.all([
    settle(refreshCash()),
    settle(refreshOi()),
    settle(refreshSectors()),
    settle(refreshDeals()),
    settle(refreshIndex()),
  ]);
  return { cash, oi, sectors, deals, index };
}

function sumBy(list, keyOf) {
  const m = new Map();
  for (const x of list) {
    const k = keyOf(x);
    const g = m.get(k) ?? { key: k, buyCr: 0, sellCr: 0, deals: 0, clients: new Set(), last: "" };
    if (x.side === "B") g.buyCr += x.cr;
    else g.sellCr += x.cr;
    g.deals++;
    g.clients.add(x.c);
    if (x.d > g.last) g.last = x.d;
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({ ...g, buyCr: r2(g.buyCr), sellCr: r2(g.sellCr), netCr: r2(g.buyCr - g.sellCr), clients: [...g.clients].slice(0, 4) }));
}

/** Net FII / DII buying per stock (and per app sector) over a window. */
export function dealViews(deals, sectorOf = () => null) {
  const out = {};
  for (const who of ["FII", "DII"]) {
    const mine = deals.filter((x) => x.w === who);
    const stocks = sumBy(mine, (x) => x.s).map((g) => ({ ...g, symbol: g.key, sector: sectorOf(g.key) }));
    const sectors = sumBy(mine.map((x) => ({ ...x, sector: sectorOf(x.s) ?? "Unclassified" })), (x) => x.sector);
    out[who.toLowerCase()] = {
      bought: stocks.filter((g) => g.netCr > 0).sort((a, b) => b.netCr - a.netCr),
      sold: stocks.filter((g) => g.netCr < 0).sort((a, b) => a.netCr - b.netCr),
      sectors: sectors.sort((a, b) => b.netCr - a.netCr),
      buyCr: r2(mine.filter((x) => x.side === "B").reduce((a, x) => a + x.cr, 0)),
      sellCr: r2(mine.filter((x) => x.side === "S").reduce((a, x) => a + x.cr, 0)),
      count: mine.length,
    };
  }
  return out;
}

export async function loadStored() {
  const [cash, oi, sectors, idx, holidays] = await Promise.all([
    ...[K.cash, K.oi, K.sectors, K.idx].map((k) => kv.get(k).catch(() => null)),
    getHolidaySet().catch(() => new Set()),
  ]);
  return { cash: cash ?? {}, oi: oi ?? {}, sectors: sectors ?? {}, idx: idx ?? {}, holidays };
}

const mkt = (idx, d) => ({ nifty: idx?.[d]?.nifty ?? null, vix: idx?.[d]?.vix ?? null });

/**
 * Cash history → daily rows (with NIFTY / VIX and expiry) + sums.
 * While the stored history is shorter than a month the month-to-date and
 * rolling sums are the same numbers, so `sinceStart` replaces them.
 */
export function cashView(cash, idx = {}, expiry = {}) {
  const days = Object.keys(cash)
    .sort()
    .map((d) => ({ date: d, fii: cash[d].fii, dii: cash[d].dii, ...mkt(idx, d), expiry: expiry[d] ?? null }));
  const latest = days.at(-1) ?? null;
  const sum = (rows, who) => r2(rows.reduce((a, r) => a + (r[who]?.net ?? 0), 0));
  const month = latest ? days.filter((r) => r.date.slice(0, 7) === latest.date.slice(0, 7)) : [];
  const last = (n) => days.slice(-n);
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const n = days[i].fii?.net;
    if (n == null) break;
    if (streak === 0) streak = n >= 0 ? 1 : -1;
    else if ((n >= 0) === streak > 0) streak += streak > 0 ? 1 : -1;
    else break;
  }
  // History starts inside the current month → "this month" and "last N"
  // would just repeat it.
  const short = days.length <= month.length || days.length < 20;
  return {
    days: days.slice(-120),
    latest,
    mtd: { fii: sum(month, "fii"), dii: sum(month, "dii"), sessions: month.length },
    last5: { fii: sum(last(5), "fii"), dii: sum(last(5), "dii"), sessions: Math.min(5, days.length) },
    last20: { fii: sum(last(20), "fii"), dii: sum(last(20), "dii"), sessions: Math.min(20, days.length) },
    sinceStart: short ? { fii: sum(days, "fii"), dii: sum(days, "dii"), sessions: days.length, from: days[0]?.date ?? null } : null,
    fiiStreak: streak,
    historyDays: days.length,
  };
}

const PARTIES = ["fii", "client", "pro", "dii"];

function partyRow(p) {
  if (!p) return null;
  const v = (k) => p[k] ?? 0;
  const fl = v("futIdxLong");
  const fs = v("futIdxShort");
  return {
    futLong: fl,
    futShort: fs,
    futNet: fl - fs,
    longPct: fl + fs ? r2((fl / (fl + fs)) * 100) : null,
    callLong: v("callIdxLong"),
    callShort: v("callIdxShort"),
    callNet: v("callIdxLong") - v("callIdxShort"),
    putLong: v("putIdxLong"),
    putShort: v("putIdxShort"),
    putNet: v("putIdxLong") - v("putIdxShort"),
    stkFutNet: v("futStkLong") - v("futStkShort"),
  };
}

const diff = (a, b, keys) => (a && b ? Object.fromEntries(keys.map((k) => [k, a[k] != null && b[k] != null ? r2(a[k] - b[k]) : null])) : null);
const CHG_KEYS = ["futLong", "futShort", "futNet", "longPct", "callLong", "callShort", "callNet", "putLong", "putShort", "putNet", "stkFutNet"];

/**
 * Participant open interest → per day, for FII / Client (retail) / Pro / DII:
 * index futures long/short/net and long %, index calls and puts (gross long,
 * gross short, net), stock-futures net — each with its change from the
 * previous session — plus NIFTY / VIX, the expiry flag, and a data check:
 * every contract has a buyer and a seller, so the four participants' nets
 * must add up to ~0.
 */
export function oiView(oi, idx = {}, expiry = {}) {
  const dates = Object.keys(oi).sort();
  const days = dates.map((d, i) => {
    const row = { date: d, ...mkt(idx, d), expiry: expiry[d] ?? null };
    for (const who of PARTIES) row[who] = partyRow(oi[d][who]);
    const prev = i > 0 ? oi[dates[i - 1]] : null;
    row.chg = Object.fromEntries(PARTIES.map((who) => [who, diff(row[who], prev ? partyRow(prev[who]) : null, CHG_KEYS)]));
    // Data check: the four nets should cancel out.
    const parts = PARTIES.map((w) => row[w]).filter(Boolean);
    if (parts.length === 4) {
      const gross = parts.reduce((a, p) => a + p.futLong + p.callLong + p.putLong, 0);
      const off = {
        fut: parts.reduce((a, p) => a + p.futNet, 0),
        call: parts.reduce((a, p) => a + p.callNet, 0),
        put: parts.reduce((a, p) => a + p.putNet, 0),
      };
      const worst = Math.max(...Object.values(off).map(Math.abs));
      row.check = { ...off, ok: gross > 0 && worst <= Math.max(10, gross * 0.001) };
    } else row.check = { ok: false, missing: PARTIES.filter((w) => !row[w]) };
    return row;
  });
  const latest = days.at(-1) ?? null;
  return {
    days,
    latest,
    checkFailures: days.filter((d) => !d.check?.ok).map((d) => d.date),
  };
}

/** NSDL reports → fortnight series, newest first, each with every sector's net. */
export function sectorView(stored) {
  const reports = Object.keys(stored).sort();
  const fortnights = new Map();
  for (const end of reports) {
    const rep = stored[end];
    const [p1, p2] = rep.periods ?? [];
    const add = (label, pick, sortKey) => {
      if (!label) return;
      fortnights.set(label, {
        label,
        sortKey,
        sectors: rep.sectors.map((s) => ({ name: s.name, netCr: s[pick], aucCr: s.auc })).filter((s) => s.netCr != null),
        totalCr: rep.total?.[pick] ?? null,
        source: rep.url ?? null,
      });
    };
    // Second fortnight of the report ends on the report's date; the first ~15 days earlier.
    add(p1, "net1", `${end}-1`);
    add(p2, "net2", `${end}-2`);
  }
  const list = [...fortnights.values()].sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
  // Per sector: last fortnight, last 3 months (6 fortnights), and the AUC.
  const names = [...new Set(list.flatMap((f) => f.sectors.map((s) => s.name)))];
  const table = names
    .map((name) => {
      const series = list.map((f) => f.sectors.find((s) => s.name === name)?.netCr ?? null);
      const latestAuc = list[0]?.sectors.find((s) => s.name === name)?.aucCr ?? null;
      const sum = (n) => r2(series.slice(0, n).reduce((a, v) => a + (v ?? 0), 0));
      return { name, last: series[0], prev: series[1], sum3m: sum(6), sum6m: sum(12), auc: latestAuc, series: series.slice(0, 12).reverse() };
    })
    .sort((a, b) => (b.last ?? 0) - (a.last ?? 0));
  return { fortnights: list.slice(0, 12).map(({ sectors: _s, ...f }) => f), labels: list.slice(0, 12).map((f) => f.label).reverse(), table, latestLabel: list[0]?.label ?? null };
}
