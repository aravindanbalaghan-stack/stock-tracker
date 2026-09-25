// The six delivery-% buckets the Delivery tab is organized around, and
// the "how many times has this stock appeared in each bucket over the
// last 2 months" computation shown on both the Delivery tab and the
// Stock Insight page. Shared here rather than duplicated across
// app/api/delivery/route.js, app/api/sector-delivery/route.js, and
// app/api/stock-insight/route.js.
//
// Buckets are cumulative ("above 90%" is a subset of "above 50%"), not
// disjoint bins — a stock at 95% delivery genuinely belongs in every
// "above" tab down to 50%, matching how ACCUMULATION_DELIVERY_THRESHOLD
// elsewhere in this file already treats ">50%" as a single cumulative
// bar rather than a range. "Below 50%" is the one exception: it's
// everything the five "above" buckets exclude.

export const DELIVERY_BUCKETS = [
  { id: "90", label: "Above 90%", min: 90, max: null },
  { id: "80", label: "Above 80%", min: 80, max: null },
  { id: "70", label: "Above 70%", min: 70, max: null },
  { id: "60", label: "Above 60%", min: 60, max: null },
  { id: "50", label: "Above 50%", min: 50, max: null },
  { id: "below50", label: "Below 50%", min: null, max: 50 },
];

const DEFAULT_BUCKET_ID = "60";

export function getBucket(bucketId) {
  return DELIVERY_BUCKETS.find((b) => b.id === bucketId) ?? DELIVERY_BUCKETS.find((b) => b.id === DEFAULT_BUCKET_ID);
}

/** Whether a delivery % value falls inside the given bucket. Null/undefined
 * never matches — a stock with no delivery % reading shouldn't silently
 * count as "below 50%". */
export function matchesBucket(deliveryPct, bucketId) {
  if (deliveryPct == null) return false;
  const bucket = getBucket(bucketId);
  if (bucket.min != null && !(deliveryPct > bucket.min)) return false;
  if (bucket.max != null && !(deliveryPct <= bucket.max)) return false;
  return true;
}

// The five "above" buckets counted for appearance history — "below 50%"
// isn't counted the same way (see computeThresholdAppearances below);
// appearing there isn't an achievement to tally the way clearing a
// delivery bar is.
const APPEARANCE_BUCKET_IDS = ["90", "80", "70", "60", "50"];

// 2 calendar months, expressed as trading days with slack for holidays —
// same reasoning as BHAV_WINDOW elsewhere in this app (a plain 60/7*5
// calendar-to-trading conversion, plus a few days' cushion).
export const APPEARANCE_WINDOW_TRADING_DAYS = 44;

/**
 * For one symbol, how many days in the trailing `days` window (expected
 * to already be ~2 months / APPEARANCE_WINDOW_TRADING_DAYS long — this
 * function doesn't re-slice, callers control the window) had delivery %
 * clearing each of the five "above" buckets. A day clearing 90% also
 * counts toward 80/70/60/50 — same cumulative reasoning as the buckets
 * themselves, so summing the counts across buckets isn't meaningful, but
 * each individual count is.
 *
 * Returns { counts: { "90": n, "80": n, ... }, windowDays, windowStart,
 * windowEnd } — counts as a plain object (not a Map) so it serializes
 * straight to JSON for the API routes that use this.
 */
export function computeThresholdAppearances(symbol, days) {
  const counts = Object.fromEntries(APPEARANCE_BUCKET_IDS.map((id) => [id, 0]));
  let tradedDays = 0;
  for (const day of days) {
    const row = day.bySymbol.get(symbol);
    if (!row || row.series !== "EQ" || !row.volume || row.deliveryPct == null) continue;
    tradedDays++;
    for (const id of APPEARANCE_BUCKET_IDS) {
      if (matchesBucket(row.deliveryPct, id)) counts[id]++;
    }
  }
  return {
    counts,
    tradedDays,
    windowStart: days[0]?.date ?? null,
    windowEnd: days[days.length - 1]?.date ?? null,
  };
}

/** Batch form — same computation for many symbols against one shared
 * `days` window, so the window is only sliced/fetched once regardless of
 * how many symbols are being scored (used by the Delivery tab, which
 * needs this for every row it shows). */
export function computeThresholdAppearancesBatch(symbols, days) {
  const result = {};
  for (const symbol of symbols) {
    result[symbol] = computeThresholdAppearances(symbol, days);
  }
  return result;
}
