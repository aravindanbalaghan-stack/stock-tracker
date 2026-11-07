// Server-side NSE trading calendar. Merges NSE's own holiday master
// (cookie-gated API, cached a week in Redis) with the built-in list in
// lib/marketHours.js, so a holiday is recognised even if NSE's API is
// unreachable. Used to keep holidays from ever showing up as a "session":
// no live overlay on a holiday, and Yahoo's occasional holiday bars (which
// just repeat the previous close) are dropped.

import { kv } from "@/lib/kv";
import { getSessionCookies, nseApiFetchWithCookies } from "@/lib/nseSession";
import { NSE_HOLIDAYS, isNonTradingDate, istToday } from "@/lib/marketHours";

const CACHE_KEY = "calendar:nse-holidays:v1";
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

let memo = null; // { at, set }

function parseDate(s) {
  const m = String(s ?? "").match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mm = MONTHS[m[2].toUpperCase()];
  return mm ? `${m[3]}-${String(mm).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

async function fromNse() {
  try {
    const cookies = await getSessionCookies();
    const json = await nseApiFetchWithCookies("/api/holiday-master?type=trading", cookies, 6000);
    const list = json?.CM ?? json?.EQUITIES ?? [];
    const dates = list.map((h) => parseDate(h?.tradingDate)).filter(Boolean);
    return dates.length ? dates : null;
  } catch {
    return null;
  }
}

/** Set of YYYY-MM-DD NSE equity holidays (built-in ∪ NSE's list). Never throws. */
export async function getHolidaySet() {
  if (memo && Date.now() - memo.at < 6 * 60 * 60 * 1000) return memo.set;
  let fetched = null;
  try {
    const cached = await kv.get(CACHE_KEY);
    if (cached?.dates && Date.now() - cached.at < CACHE_MS) fetched = cached.dates;
  } catch {
    /* no KV — fetch directly */
  }
  if (!fetched) {
    fetched = await fromNse();
    if (fetched) {
      try {
        await kv.set(CACHE_KEY, { at: Date.now(), dates: fetched });
      } catch {
        /* no KV — fine */
      }
    }
  }
  const set = new Set([...NSE_HOLIDAYS, ...(fetched ?? [])]);
  memo = { at: Date.now(), set };
  return set;
}

export async function isTradingDate(date) {
  return !isNonTradingDate(date, await getHolidaySet());
}

export async function isTradingToday() {
  return isTradingDate(istToday());
}

/** Drops Yahoo bars dated on a weekend or holiday (by IST date). */
export function dropNonTradingBars(bars, holidays) {
  if (!Array.isArray(bars)) return bars;
  return bars.filter((b) => {
    const date = new Date((b.t + 19800) * 1000).toISOString().slice(0, 10);
    return !isNonTradingDate(date, holidays);
  });
}
