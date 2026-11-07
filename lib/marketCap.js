// Market cap (₹ crore) — ONE lookup chain used everywhere a market cap is
// shown or filtered on (Sectors tab, Delivery, screeners, stock page):
//
//   1. Your imported stock data (Stock Data tab) — authoritative, free.
//   2. Panel's own cache of earlier NSE answers (Redis, 5 days) — so a
//      value NSE returned once keeps showing even when NSE is blocking.
//   3. NSE's quote-equity endpoint — live, but rate-limited and often
//      blocked from hosted servers; one retry with a fresh session.
//
// Before this, each screen called NSE directly and only for a capped
// top-N, so the same stock could show a market cap in one place and "—"
// in another depending on whether NSE answered that particular request.
//
// NSE returns totalMarketCap already in crores.

import { nseApiFetchWithCookies, getSessionCookies } from "@/lib/nseSession";
import { getStockMaster } from "@/lib/stockMaster";
import { kv } from "@/lib/kv";

const NSE_TIMEOUT_MS = 6000;
const NSE_CONCURRENCY = 6;
const CACHE_KEY = "mcap:cache:v1";
const CACHE_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

async function fromNse(symbol, cookies) {
  const data = await nseApiFetchWithCookies(
    `/api/quote-equity?symbol=${encodeURIComponent(symbol)}&section=trade_info`,
    cookies,
    NSE_TIMEOUT_MS
  );
  if (!data) return null;
  const direct = data?.marketDeptOrderBook?.tradeInfo?.totalMarketCap;
  if (typeof direct === "number" && direct > 0) return direct;
  const issuedSize = data?.securityInfo?.issuedSize;
  const lastPrice = data?.priceInfo?.lastPrice;
  if (typeof issuedSize === "number" && typeof lastPrice === "number") return (issuedSize * lastPrice) / 1e7;
  return null;
}

async function readCache() {
  try {
    return (await kv.get(CACHE_KEY)) ?? {};
  } catch {
    return {};
  }
}

/**
 * Map symbol → market cap in ₹ Cr (or null), for any number of symbols.
 * Only `nseLimit` of them — those not already known from imported data or
 * the cache — are looked up live at NSE; the rest come back instantly.
 */
export async function getMarketCapsCr(symbols, { nseLimit = 150, cookies = null } = {}) {
  const wanted = [...new Set(symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
  const out = new Map();
  const [master, cache] = await Promise.all([getStockMaster(), readCache()]);
  const now = Date.now();

  const missing = [];
  for (const s of wanted) {
    const m = master.get(s)?.marketCapCr;
    if (typeof m === "number" && m > 0) out.set(s, m);
    else if (cache[s] && now - cache[s].at < CACHE_MAX_AGE_MS) out.set(s, cache[s].cr);
    else missing.push(s);
  }

  const live = missing.slice(0, Math.max(0, nseLimit));
  if (live.length) {
    let ck = cookies ?? (await getSessionCookies().catch(() => ""));
    const fresh = {};
    const run = async (list) => {
      const failed = [];
      for (let i = 0; i < list.length; i += NSE_CONCURRENCY) {
        const batch = list.slice(i, i + NSE_CONCURRENCY);
        const got = await Promise.all(batch.map((s) => fromNse(s, ck).catch(() => null)));
        batch.forEach((s, j) => (got[j] != null ? (fresh[s] = got[j]) : failed.push(s)));
      }
      return failed;
    };
    const failed = await run(live);
    // One retry with a fresh NSE session — a stale cookie is the usual
    // reason a whole batch comes back empty.
    if (failed.length) {
      ck = await getSessionCookies().catch(() => ck);
      await run(failed);
    }
    for (const [s, cr] of Object.entries(fresh)) out.set(s, cr);
    if (Object.keys(fresh).length) {
      try {
        const latest = await readCache();
        for (const [s, cr] of Object.entries(fresh)) latest[s] = { cr: Math.round(cr), at: now };
        await kv.set(CACHE_KEY, latest);
      } catch {
        /* cache is best-effort */
      }
    }
  }

  // Last resort: an expired cache entry beats showing nothing.
  for (const s of wanted) if (!out.has(s) && cache[s]) out.set(s, cache[s].cr);
  for (const s of wanted) if (!out.has(s)) out.set(s, null);
  return out;
}

export async function fetchMarketCapCr(symbol, cookies) {
  return (await getMarketCapsCr([symbol], { nseLimit: 1, cookies })).get(String(symbol).trim().toUpperCase()) ?? null;
}

/** Same chain for a list; kept for existing callers. */
export async function fetchMarketCapBatch(symbols, cookies, { limit = 150 } = {}) {
  return getMarketCapsCr(symbols, { nseLimit: limit, cookies });
}
