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
const SYMBOL_PREFIX = "screener-membership:symbol:"; // one per symbol — first-seen-by-screen history + occurrence log
// Cap on how many dates are kept per (screen, symbol) in the occurrence
// log below — about half a year of trading days, comfortably more than
// any "appeared N times in the last M days" reader in this app needs
// (the Pocket Pivot column and the Movers "Pocket Pivot repeaters"
// backtest both look back 10-30 days), while keeping each KV document
// bounded regardless of how long a symbol keeps qualifying.
const OCCURRENCE_CAP = 120;

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
        const doc = docs[i] && typeof docs[i] === "object" ? docs[i] : { screens: {}, occurrences: {} };
        if (!doc.screens) doc.screens = {};
        if (!doc.occurrences) doc.occurrences = {};
        // Only set it the FIRST time this screen has ever recorded this
        // symbol — that's what makes the date mean "initially added"
        // rather than "last time it was still qualifying".
        if (!doc.screens[screenId]) doc.screens[screenId] = asOfDate;

        // Occurrence log: every date this screen has flagged the symbol,
        // used for "appeared N times in the last M days" (see the
        // Pocket Pivot tab's appearance column and the Movers "Pocket
        // Pivot repeaters" backtest). Deduped against the last entry —
        // recordScreenSnapshot can run more than once for the same
        // trading day (e.g. someone reloading the tab), and this must
        // not count that as two appearances.
        const existing = Array.isArray(doc.occurrences[screenId]) ? doc.occurrences[screenId] : [];
        if (existing[existing.length - 1] !== asOfDate) {
          doc.occurrences[screenId] = [...existing, asOfDate].slice(-OCCURRENCE_CAP);
        }

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

/**
 * The current (most recently recorded) member list for a screen — i.e.
 * what a live run of that screen returned last time recordScreenSnapshot
 * was called for it. Used by the Movers "Pocket Pivot repeaters" section
 * as its candidate pool, rather than re-running the (expensive) screen
 * itself. Returns null if KV isn't reachable, or if the screen has never
 * been recorded (nobody has opened that tab yet on this deployment).
 */
export async function getCurrentMembers(screenId) {
  try {
    const snap = await kv.get(`${SNAPSHOT_PREFIX}${screenId}`);
    return Array.isArray(snap?.symbols) ? { asOf: snap.asOf ?? null, symbols: snap.symbols } : null;
  } catch {
    return null;
  }
}

/**
 * How many times, and on which dates, each symbol has appeared in a
 * given screen — read from the occurrence log recorded by
 * recordScreenSnapshot above. `sinceDate` (a "YYYY-MM-DD" trading date,
 * inclusive) restricts the count to a trailing window — e.g. the Pocket
 * Pivot tab passes the date 30 trading days back to answer "how many
 * times in the last 30 days".
 *
 * IMPORTANT: this log only has entries from the day this feature
 * shipped onward — screen results were never persisted historically
 * before recordScreenSnapshot started keeping this log, so a stock that
 * genuinely appeared in Pocket Pivot every week for the last year will
 * still show a low count until enough real days have passed. There is
 * no way to backfill this retroactively without re-running the full
 * (expensive, weekly-history-dependent) screen across the whole universe
 * for every past trading day, which is not practical to do on request.
 *
 * Returns null if KV isn't reachable at all, so callers can distinguish
 * "no data yet" from "couldn't check".
 */
export async function getOccurrenceHistory(screenId, symbols, sinceDate) {
  if (!symbols?.length) return {};
  try {
    const docs = await Promise.all(symbols.map((s) => kv.get(`${SYMBOL_PREFIX}${s}`)));
    const result = {};
    symbols.forEach((symbol, i) => {
      const all = Array.isArray(docs[i]?.occurrences?.[screenId]) ? docs[i].occurrences[screenId] : [];
      const dates = sinceDate ? all.filter((d) => d >= sinceDate) : all;
      result[symbol] = { dates, count: dates.length, totalCount: all.length };
    });
    return result;
  } catch {
    return null;
  }
}
