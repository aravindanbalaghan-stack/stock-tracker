// NSE publishes one CSV per trading day with OHLC, volume and delivery
// data for every listed security: sec_bhavdata_full_DDMMYYYY.csv
//
// This module fetches and parses that file, and walks backward day by
// day (skipping weekends and holidays automatically, since a holiday
// just 404s) to build up a short history for the whole exchange.

const BHAV_BASE = "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function ddmmyyyy(date) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}${m}${y}`;
}

function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

// Very small CSV parser — good enough for NSE's simple comma-separated,
// no-embedded-commas bhavcopy format.
function parseCsv(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    if (cells.length !== headers.length) continue;
    const row = {};
    headers.forEach((h, idx) => (row[h] = cells[idx]));
    rows.push(row);
  }
  return rows;
}

/**
 * Fetch and parse one day's bhavcopy. Returns null if unavailable
 * (holiday, weekend, or not yet published).
 */
async function fetchOneDay(date) {
  const dateStr = ddmmyyyy(date);
  const url = `${BHAV_BASE}${dateStr}.csv`;
  // Historical days never change, so cache them for a week. Today's file
  // can still be revised shortly after publication, so cache it briefly.
  const isToday = ddmmyyyy(new Date()) === dateStr;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/csv" },
      next: { revalidate: isToday ? 3600 : 604800 },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.startsWith("<")) return null; // NSE returns an HTML error page on miss

    const rows = parseCsv(text);
    const bySymbol = new Map();
    for (const r of rows) {
      const series = r.SERIES;
      if (series !== "EQ" && series !== "BE") continue; // equity series only
      const symbol = r.SYMBOL;
      bySymbol.set(symbol, {
        symbol,
        series,
        close: parseFloat(r.CLOSE_PRICE) || null,
        prevClose: parseFloat(r.PREV_CLOSE) || null,
        volume: parseInt(r.TTL_TRD_QNTY, 10) || 0,
        deliveryQty: parseInt(r.DELIV_QTY, 10) || 0,
        deliveryPct: parseFloat(r.DELIV_PER) || null, // "-" for BE-series parses to NaN -> null via ||
      });
    }
    return { date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`, bySymbol };
  } catch {
    return null;
  }
}

/**
 * Walk backward from yesterday, collecting up to `count` trading days of
 * bhavcopy data. Skips weekends automatically; silently skips holidays
 * (a 404/HTML response). Gives up after `maxLookback` calendar days so a
 * sustained NSE outage can't hang the request forever.
 */
export async function getRecentBhavcopies(count = 31, maxLookback = 60) {
  const results = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - 1); // start from yesterday — today's file usually isn't out yet

  let scanned = 0;
  const CONCURRENCY = 5;
  const candidates = [];

  while (candidates.length < count + 10 && scanned < maxLookback) {
    const d = new Date(cursor);
    d.setDate(d.getDate() - scanned);
    scanned++;
    if (isWeekend(d)) continue;
    candidates.push(d);
  }

  // Fetch in small batches so we don't fire 40+ requests at once.
  for (let i = 0; i < candidates.length && results.length < count; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(batch.map(fetchOneDay));
    for (const day of fetched) {
      if (day) results.push(day);
      if (results.length >= count) break;
    }
  }

  // Oldest first, so index 0 = furthest back, last = most recent.
  return results.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-count);
}
