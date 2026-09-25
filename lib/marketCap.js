import { nseApiFetchWithCookies } from "@/lib/nseSession";

// Previously this exact function was duplicated in app/api/delivery/
// route.js and app/api/screeners/route.js. Market cap comes from NSE's
// own quote-equity endpoint (via the cookie-session helper in
// lib/nseSession.js) rather than Yahoo's quoteSummary endpoint — see
// app/api/quote/route.js's notes on Yahoo rejecting unauthenticated
// cloud-host requests to that family of endpoint. NSE returns
// totalMarketCap already in crores, so no unit conversion is needed there.

const MARKET_CAP_TIMEOUT_MS = 4000; // NSE can occasionally stall rather than fail fast — without a hard
// timeout, a handful of stalled requests can blow past a route's function time limit and take the
// *entire* request down. Aborting slow ones keeps callers reliable even when NSE is flaky.

export async function fetchMarketCapCr(symbol, cookies) {
  const data = await nseApiFetchWithCookies(
    `/api/quote-equity?symbol=${encodeURIComponent(symbol)}&section=trade_info`,
    cookies,
    MARKET_CAP_TIMEOUT_MS
  );
  if (!data) return null;

  const direct = data?.marketDeptOrderBook?.tradeInfo?.totalMarketCap;
  if (typeof direct === "number") return direct;

  // Fallback: derive from shares issued x last price if NSE's direct
  // field isn't present for this symbol.
  const issuedSize = data?.securityInfo?.issuedSize;
  const lastPrice = data?.priceInfo?.lastPrice;
  if (typeof issuedSize === "number" && typeof lastPrice === "number") {
    return (issuedSize * lastPrice) / 1e7; // rupees -> crore
  }
  return null;
}

/** Batched form — fetches in chunks of `concurrency` rather than all at
 * once, since NSE's session-gated endpoint is more rate-limit-sensitive
 * than Yahoo's. Returns a Map so callers can distinguish "looked it up,
 * got null" from "never asked". */
export async function fetchMarketCapBatch(symbols, cookies, { concurrency = 8 } = {}) {
  const results = new Map();
  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    const got = await Promise.all(batch.map((s) => fetchMarketCapCr(s, cookies).catch(() => null)));
    batch.forEach((s, idx) => results.set(s, got[idx]));
  }
  return results;
}
