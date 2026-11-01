// F&O universe + lot sizes for Trading Suggestions.
//
// Sources, tried in order:
//   1. NSE's market-lot file (nsearchives.nseindia.com/content/fo/fo_mktlots.csv)
//      — every F&O underlying with its lot size per expiry. The archive
//      host is the same one the bhavcopy comes from, so it's usually
//      reachable from Vercel when the NSE API isn't.
//   2. NSE's "SECURITIES IN F&O" index constituents (API, cookie-gated) —
//      symbols only, no lot sizes.
//   3. Fallback: the most liquid stocks by turnover in the bhavcopy. NOT the
//      real F&O list — the response says so.

import { getSessionCookies, nseApiFetchWithCookies } from "@/lib/nseSession";
import { getRecentBhavcopies } from "@/lib/nseBhavcopy";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const LOTS_URL = "https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv";
const INDEX_UNDERLYINGS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"]);
const FALLBACK_SIZE = 180;

let cache = null; // { at, value }
const CACHE_MS = 12 * 60 * 60 * 1000;

async function fromLotsFile() {
  try {
    const res = await fetch(LOTS_URL, {
      headers: { "User-Agent": UA, Accept: "text/csv" },
      next: { revalidate: 43200 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.startsWith("<")) return null;
    const lots = {};
    for (const line of text.split(/\r?\n/)) {
      const cells = line.split(",").map((x) => x.trim());
      if (cells.length < 3) continue;
      const symbol = cells[1]?.toUpperCase();
      if (!symbol || symbol === "SYMBOL" || !/^[A-Z0-9&\-]+$/.test(symbol)) continue;
      const lot = cells.slice(2).map(Number).find((n) => Number.isFinite(n) && n > 0);
      if (lot) lots[symbol] = lot;
    }
    const stocks = Object.keys(lots).filter((s) => !INDEX_UNDERLYINGS.has(s));
    return stocks.length >= 50 ? { stocks, lots, source: "NSE F&O market-lot file" } : null;
  } catch {
    return null;
  }
}

async function fromIndexApi() {
  try {
    const cookies = await getSessionCookies();
    const data = await nseApiFetchWithCookies(
      `/api/equity-stockIndices?index=${encodeURIComponent("SECURITIES IN F&O")}`,
      cookies,
      8000
    );
    const stocks = (data?.data ?? [])
      .map((r) => (typeof r?.symbol === "string" ? r.symbol.trim().toUpperCase() : null))
      .filter((s) => s && !s.includes(" ") && !INDEX_UNDERLYINGS.has(s));
    const unique = [...new Set(stocks)];
    return unique.length >= 50 ? { stocks: unique, lots: {}, source: "NSE 'Securities in F&O' list (no lot sizes)" } : null;
  } catch {
    return null;
  }
}

async function fromLiquidity() {
  const days = await getRecentBhavcopies(20, 40);
  const turnover = new Map();
  for (const d of days) {
    for (const [sym, r] of d.bySymbol) {
      if (r.series !== "EQ" || !r.close || !r.volume) continue;
      turnover.set(sym, (turnover.get(sym) ?? 0) + r.close * r.volume);
    }
  }
  const stocks = [...turnover.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, FALLBACK_SIZE)
    .map(([s]) => s);
  return {
    stocks,
    lots: {},
    source: `Approximation — NSE's F&O list was unreachable, so the ${FALLBACK_SIZE} most liquid stocks are used instead`,
    approximate: true,
  };
}

/** { stocks: string[], lots: {SYMBOL: lot}, source, approximate? } */
export async function getFnoUniverse() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = (await fromLotsFile()) ?? (await fromIndexApi()) ?? (await fromLiquidity());
  if (!value.approximate) cache = { at: Date.now(), value };
  return value;
}

/** BANKNIFTY lot size from the same file, or null. */
export async function getBankNiftyLot() {
  try {
    const res = await fetch(LOTS_URL, {
      headers: { "User-Agent": UA, Accept: "text/csv" },
      next: { revalidate: 43200 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) {
      const cells = line.split(",").map((x) => x.trim());
      if (cells[1]?.toUpperCase() === "BANKNIFTY") {
        return cells.slice(2).map(Number).find((n) => Number.isFinite(n) && n > 0) ?? null;
      }
    }
    return null;
  } catch {
    return null;
  }
}
