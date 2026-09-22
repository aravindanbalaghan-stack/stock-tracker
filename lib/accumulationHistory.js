import { kv } from "@vercel/kv";

// Persists the FIRST date each symbol's delivery-based "in accumulation?"
// read (see computePeriodMetrics in lib/deliveryMetrics.js) turned Yes.
// inAccumulation itself is always recomputed live from the last 20
// trading days — nothing here drives that decision — this module only
// remembers WHEN it first turned Yes, so the Watchlist and Delivery tabs
// can show "since <date>" instead of just today's Yes/No.
//
// Written once per symbol and never overwritten while it keeps reading
// Yes, matching lib/screenerMembership.js's first-seen convention: a
// stock that's been in accumulation for two months still shows the date
// it FIRST qualified, not today.
//
// Falls back cleanly when KV isn't configured (same contract as every
// other *Store/*History module here) — callers just don't get a date.

const PREFIX = "accumulation:symbol:";

/**
 * Call with the symbols found to be inAccumulation === true as of
 * `asOfDate` — a real trading day (e.g. days[days.length-1].date), never
 * "today" the calendar date; see lib/yahooFinance.js's istDateOf / the
 * fetchDailyOHLCV fix for why that distinction matters elsewhere in this
 * app. Fire-and-forget from the caller's point of view — failures here
 * shouldn't affect the page the person is actually looking at.
 */
export async function recordAccumulationSnapshot(asOfDate, symbols) {
  if (!symbols?.length) return;
  try {
    const docs = await Promise.all(symbols.map((s) => kv.get(`${PREFIX}${s}`)));
    await Promise.all(
      symbols.map((symbol, i) => {
        if (docs[i]?.firstYes) return null; // already recorded — never overwritten
        return kv.set(`${PREFIX}${symbol}`, { firstYes: asOfDate });
      })
    );
  } catch {
    // KV not configured on this deployment — nothing more to do.
  }
}

/**
 * For each requested symbol, the date it first read as "in accumulation".
 * Returns null (not an empty object) if KV isn't reachable at all, so
 * callers can tell "no dates yet" apart from "couldn't check".
 */
export async function getAccumulationFirstSeen(symbols) {
  if (!symbols?.length) return {};
  try {
    const docs = await Promise.all(symbols.map((s) => kv.get(`${PREFIX}${s}`)));
    const result = {};
    symbols.forEach((symbol, i) => {
      result[symbol] = docs[i]?.firstYes ?? null;
    });
    return result;
  } catch {
    return null;
  }
}

/**
 * Clears a symbol's recorded first-seen date. Not used by any route today
 * — kept for the case where the accumulation heuristic's thresholds
 * change (see lib/deliveryMetrics.js) and old first-seen dates computed
 * under the previous thresholds should be forgotten rather than treated
 * as if they still apply.
 */
export async function clearAccumulationHistory(symbol) {
  try {
    await kv.del(`${PREFIX}${symbol}`);
  } catch {
    // KV not configured — nothing to clear.
  }
}
