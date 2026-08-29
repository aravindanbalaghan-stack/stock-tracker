import { kv } from "@vercel/kv";

// Screener results are computed on the fly and never persisted — so "is
// this stock part of any screener, and since when" isn't answerable from a
// single request without re-running every screen across the whole
// universe, which is far too expensive to do just to render the Delivery
// tab. This module is the small piece of state that makes it cheap:
//
//   - Every time a screen finishes computing "today's" result (see
//     recordScreenSnapshot, called from app/api/screeners/route.js), it
//     writes: (a) the current member list for that screen, overwriting
//     yesterday's, and (b) a first-seen date per (screen, symbol), written
//     ONCE and never overwritten — so a stock that qualified a month ago,
//     dropped out, and re-qualified today still shows its original date,
//     not today's.
//   - Readers (getMembershipForSymbols) then just do cheap key lookups
//     instead of recomputing anything.
//
// Same "falls back to null when KV isn't configured" contract as
// lib/watchlistStore.js — callers treat a null/failed lookup as "membership
// tracking unavailable" and simply don't show the column data, rather than
// failing the page.

const SNAPSHOT_PREFIX = "screener-membership:snapshot:"; // one per screen — today's member list
const SYMBOL_PREFIX = "screener-membership:symbol:"; // one per symbol — first-seen-by-screen history

/**
 * Call after a screen finishes computing its result for TODAY (not a
 * historical `date=` lookup — see the caller for that guard). Fire-and-
 * forget from the caller's point of view: failures here shouldn't affect
 * the screen result the person is actually looking at.
 */
export async function recordScreenSnapshot(screenId, asOfDate, symbols) {
  try {
    await kv.set(`${SNAPSHOT_PREFIX}${screenId}`, { asOf: asOfDate, symbols });
  } catch {
    return; // KV not configured on this deployment — nothing more to do
  }

  try {
    const docs = await Promise.all(symbols.map((s) => kv.get(`${SYMBOL_PREFIX}${s}`)));
    await Promise.all(
      symbols.map((symbol, i) => {
        const doc = docs[i] && typeof docs[i] === "object" ? docs[i] : { screens: {} };
        if (!doc.screens) doc.screens = {};
        // Only set it the FIRST time this screen has ever recorded this
        // symbol — that's what makes the date mean "initially added"
        // rather than "last time it was still qualifying".
        if (!doc.screens[screenId]) doc.screens[screenId] = asOfDate;
        return kv.set(`${SYMBOL_PREFIX}${symbol}`, doc);
      })
    );
  } catch {
    // Non-fatal — the snapshot (current membership) still saved above;
    // only the first-seen bookkeeping for this run may be incomplete.
  }
}

/**
 * For each requested symbol: which screens it's CURRENTLY part of (per the
 * latest snapshot each screen wrote), and the earliest first-seen date
 * among those currently-qualifying screens. Returns null if KV isn't
 * reachable at all; returns an entry with empty screens for symbols that
 * simply aren't in any screener right now.
 */
export async function getMembershipForSymbols(symbols, screenIds) {
  if (!symbols?.length) return {};
  try {
    const snaps = await Promise.all(screenIds.map((id) => kv.get(`${SNAPSHOT_PREFIX}${id}`)));
    const currentSets = {};
    screenIds.forEach((id, i) => {
      currentSets[id] = new Set(Array.isArray(snaps[i]?.symbols) ? snaps[i].symbols : []);
    });

    const docs = await Promise.all(symbols.map((s) => kv.get(`${SYMBOL_PREFIX}${s}`)));
    const result = {};
    symbols.forEach((symbol, i) => {
      const currentScreens = screenIds.filter((id) => currentSets[id].has(symbol));
      const doc = docs[i];
      let firstAdded = null;
      if (doc?.screens) {
        for (const id of currentScreens) {
          const d = doc.screens[id];
          if (d && (!firstAdded || d < firstAdded)) firstAdded = d;
        }
      }
      result[symbol] = { screens: currentScreens, firstAdded };
    });
    return result;
  } catch {
    return null; // KV unavailable — caller shows the columns as "—"
  }
}
