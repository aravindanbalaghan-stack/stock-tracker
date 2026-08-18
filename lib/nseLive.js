// Live intraday data for the Screener tabs.
//
// The screens are built on NSE's end-of-day bhavcopy, which is only
// published in the evening. That means that during the trading session
// every screen is really showing YESTERDAY. This module supplies a live
// snapshot of the current session so the screens can be re-run against
// today's prices as they move.
//
// TWO THINGS LIVE MODE CANNOT DO, both of which are limits of the data and
// not of the implementation:
//
//  1. DELIVERY % IS NOT AVAILABLE INTRADAY. Delivery quantity is only
//     published with the EOD bhavcopy, after settlement. There is no
//     intraday delivery feed at any price. In live mode the Delivery %
//     column therefore shows the PREVIOUS session's figure, flagged as
//     such — it is never invented or extrapolated.
//
//  2. VOLUME IS PARTIAL. At 11am a stock has traded a fraction of what it
//     will by close, so "volume above the 30-day average" is naturally
//     harder to satisfy early in the day. This module reports how much of
//     the session has elapsed and a projected full-day volume, but the
//     screen FILTERS deliberately use actual volume-so-far. A screen that
//     says "not yet" is honest; one that extrapolates would manufacture
//     signals that haven't happened.

import { getSessionCookies, nseApiFetchWithCookies } from "@/lib/nseSession";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const NSE_TIMEOUT_MS = 9000;
const YAHOO_CONCURRENCY = 15;

// Session timing lives in lib/marketHours.js so client components can use
// it without pulling this module's server-only NSE session helper into the
// browser bundle. Re-exported here so existing imports keep working.
export { marketIsOpen, sessionProgress, istToday, istNowMinutes } from "@/lib/marketHours";

/**
 * One call, ~500 stocks, live prices and volumes. This is the good path:
 * NSE's own index-constituent endpoint carries lastPrice, open, dayHigh,
 * dayLow, previousClose and totalTradedVolume for every member.
 *
 * Returns null when NSE is unreachable — which, from hosted servers, is
 * common. Callers must fall back rather than fail.
 */
async function fetchFromNSE(indexName = "NIFTY 500") {
  try {
    const cookies = await getSessionCookies();
    const data = await nseApiFetchWithCookies(
      `/api/equity-stockIndices?index=${encodeURIComponent(indexName)}`,
      cookies,
      NSE_TIMEOUT_MS
    );
    const rows = data?.data;
    if (!Array.isArray(rows) || rows.length < 50) return null;

    const bySymbol = new Map();
    for (const r of rows) {
      const symbol = typeof r?.symbol === "string" ? r.symbol.trim().toUpperCase() : null;
      if (!symbol || symbol.includes(" ")) continue; // skips the index's own summary row
      const close = Number(r.lastPrice);
      if (!(close > 0)) continue;
      bySymbol.set(symbol, {
        symbol,
        open: Number(r.open) || null,
        high: Number(r.dayHigh) || null,
        low: Number(r.dayLow) || null,
        close,
        prevClose: Number(r.previousClose) || null,
        volume: Number(r.totalTradedVolume) || 0,
      });
    }
    if (bySymbol.size < 50) return null;
    return { bySymbol, source: "nse", asOfText: data?.timestamp ?? null };
  } catch {
    return null;
  }
}

/** Per-symbol live quote from Yahoo's chart endpoint — the fallback path. */
async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=1d&range=2d`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.chart?.result?.[0];
    const meta = r?.meta;
    if (!meta) return null;
    const close = meta.regularMarketPrice;
    if (!(close > 0)) return null;

    // Yahoo's meta carries the live price; the last daily bar carries the
    // session's own open/high/low/volume.
    const q = r.indicators?.quote?.[0] || {};
    const n = (r.timestamp || []).length;
    const i = n - 1;
    return {
      symbol,
      open: q.open?.[i] ?? meta.regularMarketOpen ?? null,
      high: q.high?.[i] ?? meta.regularMarketDayHigh ?? null,
      low: q.low?.[i] ?? meta.regularMarketDayLow ?? null,
      close,
      prevClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
      volume: q.volume?.[i] ?? meta.regularMarketVolume ?? 0,
    };
  } catch {
    return null;
  }
}

async function fetchFromYahoo(symbols) {
  const bySymbol = new Map();
  for (let i = 0; i < symbols.length; i += YAHOO_CONCURRENCY) {
    const batch = symbols.slice(i, i + YAHOO_CONCURRENCY);
    const results = await Promise.all(batch.map((s) => fetchYahooQuote(s).catch(() => null)));
    results.forEach((r) => {
      if (r) bySymbol.set(r.symbol, r);
    });
  }
  if (bySymbol.size === 0) return null;
  return { bySymbol, source: "yahoo", asOfText: null };
}

/**
 * Live snapshot, NSE first then Yahoo. `fallbackSymbols` bounds the Yahoo
 * path — without a bound it would be one request per listed stock.
 */
export async function fetchLiveSnapshot(fallbackSymbols = []) {
  const fromNSE = await fetchFromNSE();
  if (fromNSE) return fromNSE;
  if (!fallbackSymbols.length) return null;
  return fetchFromYahoo(fallbackSymbols);
}

/**
 * Turns a live snapshot into a bhavcopy-shaped day, so the screens can run
 * against it unchanged.
 *
 * `prevDay` supplies two things the live feeds don't carry: a previous
 * close where the feed omits it, and the previous session's delivery
 * figures — which are carried forward ONLY so the column isn't blank, and
 * are marked stale via deliveryIsPreviousSession so the UI can say so.
 */
export function buildLiveDay(snapshot, prevDay, dateStr) {
  const bySymbol = new Map();
  for (const [symbol, live] of snapshot.bySymbol) {
    const prev = prevDay?.bySymbol.get(symbol);
    // Only equity series carry through; anything that wasn't EQ yesterday
    // isn't treated as EQ today.
    if (prev && prev.series !== "EQ") continue;

    const prevClose = live.prevClose ?? prev?.close ?? null;
    bySymbol.set(symbol, {
      symbol,
      series: "EQ",
      open: live.open ?? null,
      high: live.high ?? null,
      low: live.low ?? null,
      close: live.close,
      prevClose,
      volume: live.volume ?? 0,
      // Genuinely unavailable intraday — see the module header.
      deliveryQty: null,
      deliveryPct: prev?.deliveryPct ?? null,
      deliveryIsPreviousSession: true,
      isLive: true,
    });
  }
  return { date: dateStr, bySymbol, isLive: true };
}
