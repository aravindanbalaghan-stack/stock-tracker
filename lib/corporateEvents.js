// Upcoming (and recent) corporate events for every NSE stock: results /
// board meetings and corporate actions (dividend, bonus, split, rights,
// buyback). From NSE's own feeds behind its cookie wall, cached in Redis
// for 6 hours so the whole app shares one fetch.
//
//   /api/event-calendar?index=equities&from_date=&to_date=
//     → [{ symbol, company, purpose, bm_desc, date: "14-Nov-2026" }]
//   /api/corporates-corporateActions?index=equities&from_date=&to_date=
//     → [{ symbol, comp, subject: "Dividend - Rs 5 Per Share", exDate, recDate }]
//
// Every field is read defensively — NSE renames them now and then.

import { kv } from "@/lib/kv";
import { getSessionCookies, nseApiFetchWithCookies } from "@/lib/nseSession";
import { istToday } from "@/lib/marketHours";

const CACHE_KEY = "events:nse:v1";
const CACHE_MS = 6 * 60 * 60 * 1000;
const PAST_DAYS = 30;
const AHEAD_DAYS = 60;
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

let memo = null;

function parseDate(s) {
  const m = String(s ?? "").trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const mm = MONTHS[m[2].toUpperCase()];
  return mm ? `${m[3]}-${String(mm).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}
function nseDate(d) {
  return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
}
function shift(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function classify(text) {
  const t = String(text ?? "").toLowerCase();
  if (/financial result|results|quarterly|half yearly|audited/.test(t)) return "Results";
  if (/dividend/.test(t)) return "Dividend";
  if (/bonus/.test(t)) return "Bonus";
  if (/split|sub-division|sub division/.test(t)) return "Split";
  if (/rights/.test(t)) return "Rights";
  if (/buy ?back/.test(t)) return "Buyback";
  if (/fund rais|preferential|qip|warrant|ncd|debenture/.test(t)) return "Fund raising";
  if (/agm|annual general/.test(t)) return "AGM";
  if (/egm|extra.?ordinary/.test(t)) return "EGM";
  if (/merger|amalgamation|demerger|scheme of arrangement/.test(t)) return "Merger";
  return "Board meeting";
}

async function fetchAll() {
  const today = istToday();
  const from = nseDate(shift(today, -PAST_DAYS));
  const to = nseDate(shift(today, AHEAD_DAYS));
  const cookies = await getSessionCookies();
  const [cal, acts] = await Promise.all([
    nseApiFetchWithCookies(`/api/event-calendar?index=equities&from_date=${from}&to_date=${to}`, cookies, 9000).catch(() => null),
    nseApiFetchWithCookies(`/api/corporates-corporateActions?index=equities&from_date=${from}&to_date=${to}`, cookies, 9000).catch(
      () => null
    ),
  ]);
  const listOf = (x) => (Array.isArray(x) ? x : Array.isArray(x?.data) ? x.data : []);
  const events = [];

  for (const r of listOf(cal)) {
    const symbol = String(r.symbol ?? r.bm_symbol ?? "").trim().toUpperCase();
    const date = parseDate(r.date ?? r.bm_date);
    if (!symbol || !date) continue;
    const purpose = r.purpose ?? r.bm_purpose ?? "";
    const desc = r.bm_desc ?? r.description ?? "";
    events.push({ symbol, date, type: classify(`${purpose} ${desc}`), title: purpose || "Board meeting", detail: desc || null, source: "Event calendar" });
  }
  for (const r of listOf(acts)) {
    const symbol = String(r.symbol ?? "").trim().toUpperCase();
    const date = parseDate(r.exDate ?? r.exdate ?? r.recDate);
    if (!symbol || !date) continue;
    const subject = r.subject ?? r.purpose ?? "Corporate action";
    const rec = parseDate(r.recDate);
    events.push({
      symbol,
      date,
      type: classify(subject),
      title: subject,
      detail: rec && rec !== date ? `Ex-date ${date} · record date ${rec}` : `Ex-date ${date}`,
      source: "Corporate actions",
    });
  }
  if (!cal && !acts) return null;

  // De-duplicate (the same item can appear in both feeds).
  const seen = new Set();
  return events
    .filter((e) => {
      const k = `${e.symbol}|${e.date}|${e.type}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** { events: [...], status: "fresh" | "cached" | "stale" | "unavailable", fetchedAt } — never throws. */
export async function getCorporateEvents() {
  if (memo && Date.now() - memo.at < 30 * 60 * 1000) return memo.value;
  let cached = null;
  try {
    cached = await kv.get(CACHE_KEY);
  } catch {
    cached = null;
  }
  let value;
  if (cached?.events && Date.now() - cached.at < CACHE_MS) {
    value = { events: cached.events, status: "cached", fetchedAt: cached.at };
  } else {
    const fresh = await fetchAll().catch(() => null);
    if (fresh) {
      value = { events: fresh, status: "fresh", fetchedAt: Date.now() };
      try {
        await kv.set(CACHE_KEY, { at: Date.now(), events: fresh });
      } catch {
        /* no KV */
      }
    } else if (cached?.events) {
      value = { events: cached.events, status: "stale", fetchedAt: cached.at };
    } else {
      value = { events: [], status: "unavailable", fetchedAt: null };
    }
  }
  memo = { at: Date.now(), value };
  return value;
}
