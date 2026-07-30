// Resolves the ~500-stock scanning universe for the Stage 2 screen.
//
// Two sources, tried in order, because neither is reliable on its own:
//
//  1. NSE's own index-constituent endpoint. This is the real NIFTY 500
//     membership, but NSE blocks datacentre IPs frequently, so on a hosted
//     deploy it fails often enough that it can't be the only path.
//
//  2. A liquidity ranking derived from the bhavcopy data already in hand:
//     the top N stocks by average daily turnover. This can never fail
//     (it's local computation) and overlaps heavily with the real index,
//     since NIFTY 500 membership is itself largely a size/liquidity
//     screen. It is NOT identical, though, and the API response says which
//     source was used so the UI can be honest about it.

import { getSessionCookies, nseApiFetchWithCookies } from "@/lib/nseSession";

const NSE_TIMEOUT_MS = 8000;
export const TARGET_UNIVERSE_SIZE = 500;

/**
 * Live NIFTY 500 membership from NSE. Returns null if unreachable.
 */
export async function fetchNifty500FromNSE() {
  try {
    const cookies = await getSessionCookies();
    const data = await nseApiFetchWithCookies(
      `/api/equity-stockIndices?index=${encodeURIComponent("NIFTY 500")}`,
      cookies,
      NSE_TIMEOUT_MS
    );
    const rows = data?.data;
    if (!Array.isArray(rows) || rows.length < 100) return null;

    // The payload leads with a synthetic row for the index itself; real
    // constituents are the ones with a plain symbol.
    const symbols = rows
      .map((r) => (typeof r?.symbol === "string" ? r.symbol.trim().toUpperCase() : null))
      .filter((s) => s && s !== "NIFTY 500" && !s.includes(" "));

    const unique = [...new Set(symbols)];
    return unique.length >= 100 ? unique : null;
  } catch {
    return null;
  }
}

/**
 * Fallback universe: the most liquid `size` stocks by average daily
 * turnover (close x volume) across the bhavcopy window supplied.
 *
 * `universe` is the array of { symbol, series } built by the screener
 * route from today's bhavcopy.
 */
export function topByTurnover(universe, size = TARGET_UNIVERSE_SIZE) {
  const scored = universe.map(({ symbol, series }) => {
    const turnovers = series
      .map((d) => (d.close != null && d.volume ? d.close * d.volume : 0))
      .filter((t) => t > 0);
    const avgTurnover = turnovers.length
      ? turnovers.reduce((a, b) => a + b, 0) / turnovers.length
      : 0;
    return { symbol, avgTurnover };
  });
  scored.sort((a, b) => b.avgTurnover - a.avgTurnover);
  return scored.slice(0, size).map((s) => s.symbol);
}

/**
 * Resolves the universe, preferring the real index and falling back to
 * liquidity. Returns the symbol list plus which source produced it.
 */
export async function resolveWideUniverse(universe, size = TARGET_UNIVERSE_SIZE) {
  const fromNSE = await fetchNifty500FromNSE();
  if (fromNSE) {
    // Intersect with what actually traded today — the index list can carry
    // symbols that are suspended or in a different series.
    const tradedToday = new Set(universe.map((u) => u.symbol));
    const usable = fromNSE.filter((s) => tradedToday.has(s));
    if (usable.length >= 100) {
      return {
        symbols: usable,
        source: "nifty500",
        sourceLabel: `NIFTY 500 constituents from NSE (${usable.length} of ${fromNSE.length} listed members traded today)`,
      };
    }
  }

  const fallback = topByTurnover(universe, size);
  return {
    symbols: fallback,
    source: "turnover",
    sourceLabel: `Top ${fallback.length} stocks by average daily turnover — NSE's index-constituent endpoint was unreachable, so this liquidity ranking stands in for the NIFTY 500. It overlaps heavily but is not identical.`,
  };
}
