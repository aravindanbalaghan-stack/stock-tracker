// Shared client for Yahoo Finance's unofficial public endpoints.
//
// Previously this exact User-Agent string was copy-pasted into 16
// different files across app/api and lib. That's the kind of thing that's
// invisible until Yahoo changes something — see the comment history in
// app/api/quote/route.js about the "quote" endpoint starting to reject
// unauthenticated cloud-host requests — at which point "fix it" means
// hunting through a dozen files instead of one. Consolidating here so
// there's a single place to change the UA, add a timeout, or swap
// endpoints if Yahoo breaks again.

import { BROWSER_UA } from "@/lib/browserUA";

export const YAHOO_UA = BROWSER_UA;

/**
 * Fetch and JSON-parse a Yahoo Finance URL with the shared headers.
 * Returns null on any failure (network error, non-2xx, bad JSON) rather
 * than throwing — every caller in this app already treats a missing
 * quote/chart as "couldn't get this one" and degrades gracefully, so this
 * matches that contract instead of making each call site repeat its own
 * try/catch.
 */
export async function fetchYahooJson(url, { cache = "no-store", timeoutMs } = {}) {
  const controller = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": YAHOO_UA, Accept: "application/json" },
      ...(cache === "no-store" ? { cache: "no-store" } : { next: { revalidate: cache } }),
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`Yahoo Finance fetch failed for ${url}:`, err?.message || err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Appends the NSE (.NS) namespace unless the symbol already carries an
 * explicit exchange suffix (.NS or .BO for BSE). */
export function toYahooSymbol(symbol) {
  const s = symbol.trim().toUpperCase();
  if (s.endsWith(".NS") || s.endsWith(".BO")) return s;
  return `${s}.NS`;
}

// IST calendar date (YYYY-MM-DD) for a Yahoo epoch-seconds timestamp.
// Used anywhere a bar/quote's timestamp needs to be compared against a
// trading-session date rather than trusted at face value — Yahoo's chart
// endpoint has been observed to append a trailing "preview" bar stamped
// with today's date but carrying yesterday's close on non-trading days
// (weekends, and NSE holidays in particular), which is what the
// asOf-mislabeling bug in fetchDailyOHLCV traced back to.
export function istDateOf(epochSeconds) {
  return new Date(epochSeconds * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
