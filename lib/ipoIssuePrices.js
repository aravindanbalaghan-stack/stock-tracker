// IPO issue prices for the IPO Base screen.
//
// Neither the NSE bhavcopy nor Yahoo carries the price IPO subscribers paid,
// so it comes from NSE's own "Past Issues" API (the JSON behind
// nseindia.com/market-data/all-upcoming-issues-ipo → Past issues):
//
//   GET /api/public-past-issues?from_date=DD-MM-YYYY&to_date=DD-MM-YYYY
//   → [{ symbol, companyName, listingDate: "DD-MON-YYYY", securityType,
//        issuePrice, priceRange: "Rs.390 to Rs.410", ... }]
//
// That endpoint sits behind NSE's cookie wall (lib/nseSession.js) and is
// the least reliable source in the app, so:
//   - the parsed map is cached in KV for a day, and a stale copy is used if
//     NSE is unreachable on refresh;
//   - every field is parsed defensively (NSE has returned issuePrice as a
//     number, a string, and null);
//   - ISSUE_PRICE_OVERRIDES below lets you pin a price by hand for any
//     symbol NSE returns wrongly or not at all. Overrides always win.
//
// A row whose issue price can't be resolved still gets the listing-day-high
// comparison; only the IPO-price columns show "—".

import { kv } from "@vercel/kv";
import { getSessionCookies, nseApiFetchWithCookies } from "@/lib/nseSession";

// Hand-maintained fallbacks: { SYMBOL: { issuePrice: 410, listingDate: "2025-11-13" } }
// listingDate is optional and informational only.
export const ISSUE_PRICE_OVERRIDES = {};

const CACHE_KEY = "ipo-issue-prices:v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_MONTHS = 18; // the screen looks back 15 months; small buffer
const NSE_TIMEOUT_MS = 8000;

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

function nseDate(d) {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

// "13-NOV-2025" / "13-Nov-2025" / "13-11-2025" → "2025-11-13"
function parseNseDate(s) {
  if (typeof s !== "string") return null;
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3}|\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const month = /^\d+$/.test(m[2]) ? Number(m[2]) - 1 : MONTHS[m[2].toUpperCase()];
  if (month == null || month < 0 || month > 11) return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

// Final issue price if NSE gives one; otherwise the TOP of the price band,
// which is where almost every mainboard book-built issue is priced.
function parseIssuePrice(rec) {
  const nums = (v) =>
    String(v ?? "")
      .replace(/,/g, "")
      .match(/\d+(\.\d+)?/g)
      ?.map(Number)
      .filter((n) => n > 0) ?? [];

  const direct = typeof rec.issuePrice === "number" ? [rec.issuePrice] : nums(rec.issuePrice);
  if (direct.length) return Math.max(...direct);
  const band = nums(rec.priceRange ?? rec.priceBand);
  return band.length ? Math.max(...band) : null;
}

function parseResponse(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
  const out = {};
  for (const rec of list) {
    const symbol = typeof rec?.symbol === "string" ? rec.symbol.trim().toUpperCase() : null;
    if (!symbol) continue;
    const issuePrice = parseIssuePrice(rec);
    if (issuePrice == null) continue;
    out[symbol] = {
      issuePrice,
      listingDate: parseNseDate(rec.listingDate),
      companyName: rec.companyName ?? rec.company ?? null,
      securityType: rec.securityType ?? null,
    };
  }
  return out;
}

async function fetchFromNse() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCMonth(from.getUTCMonth() - LOOKBACK_MONTHS);

  let cookies;
  try {
    cookies = await getSessionCookies();
  } catch {
    return null;
  }

  // One wide request first; NSE's UI defaults to ~90-day windows, so fall
  // back to quarterly chunks if the wide one comes back empty.
  const wide = await nseApiFetchWithCookies(
    `/api/public-past-issues?from_date=${nseDate(from)}&to_date=${nseDate(to)}`,
    cookies,
    NSE_TIMEOUT_MS
  );
  let map = wide ? parseResponse(wide) : {};
  if (Object.keys(map).length > 0) return map;

  map = {};
  let gotAny = false;
  for (let end = new Date(to); end > from; ) {
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 89);
    const json = await nseApiFetchWithCookies(
      `/api/public-past-issues?from_date=${nseDate(start < from ? from : start)}&to_date=${nseDate(end)}`,
      cookies,
      NSE_TIMEOUT_MS
    );
    if (json) {
      gotAny = true;
      Object.assign(map, parseResponse(json));
    }
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() - 1);
  }
  return gotAny ? map : null;
}

/**
 * Returns { prices: Map<symbol, {issuePrice, listingDate, companyName, source}>,
 *           status: "fresh" | "cached" | "stale" | "unavailable" }.
 * Never throws.
 */
export async function getIssuePrices() {
  let cached = null;
  try {
    cached = await kv.get(CACHE_KEY);
  } catch {
    cached = null;
  }

  let bySymbol = null;
  let status = "unavailable";

  if (cached?.bySymbol && Date.now() - (cached.fetchedAt ?? 0) < CACHE_TTL_MS) {
    bySymbol = cached.bySymbol;
    status = "cached";
  } else {
    const fresh = await fetchFromNse().catch(() => null);
    if (fresh && Object.keys(fresh).length > 0) {
      bySymbol = fresh;
      status = "fresh";
      try {
        await kv.set(CACHE_KEY, { fetchedAt: Date.now(), bySymbol: fresh });
      } catch {
        // KV not configured — fine, just no cache.
      }
    } else if (cached?.bySymbol) {
      bySymbol = cached.bySymbol;
      status = "stale";
    }
  }

  const prices = new Map();
  for (const [s, v] of Object.entries(bySymbol ?? {})) prices.set(s, { ...v, source: "nse" });
  for (const [s, v] of Object.entries(ISSUE_PRICE_OVERRIDES)) {
    if (v?.issuePrice > 0) prices.set(s, { listingDate: null, companyName: null, ...v, source: "override" });
  }
  return { prices, status };
}
