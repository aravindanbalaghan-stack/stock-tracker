// The six delivery-% buckets the Delivery tab is organized around, and
// the "how many times, and when, has this stock appeared in each bucket
// over the last 2 months" computation shown on both the Delivery tab and
// the Stock Insight page. Shared here rather than duplicated across
// app/api/delivery/route.js, app/api/sector-delivery/route.js, and
// app/api/stock-insight/route.js.
//
// Buckets are disjoint RANGES, not cumulative thresholds — a stock at 95%
// delivery belongs in "Above 90%" only, not also in "Above 80% and below
// 90%". Boundaries are exclusive on the low end, inclusive on the high
// end ((80, 90], etc.) so every delivery % value falls in exactly one
// bucket, with no gap and no double-count at a boundary.

export const DELIVERY_BUCKETS = [
  { id: "90", label: "Above 90%", min: 90, max: null },
  { id: "80", label: "Above 80% and below 90%", min: 80, max: 90 },
  { id: "70", label: "Above 70% and below 80%", min: 70, max: 80 },
  { id: "60", label: "Above 60% and below 70%", min: 60, max: 70 },
  { id: "50", label: "Above 50% and below 60%", min: 50, max: 60 },
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
// delivery bucket is.
const APPEARANCE_BUCKET_IDS = ["90", "80", "70", "60", "50"];

// 2 calendar months, expressed as trading days with slack for holidays —
// same reasoning as BHAV_WINDOW elsewhere in this app (a plain 60/7*5
// calendar-to-trading conversion, plus a few days' cushion).
export const APPEARANCE_WINDOW_TRADING_DAYS = 44;

/**
 * For one symbol, how many days in the trailing `days` window (expected
 * to already be ~2 months / APPEARANCE_WINDOW_TRADING_DAYS long — this
 * function doesn't re-slice, callers control the window) fell in each of
 * the five "above" buckets, PLUS the specific days themselves (date,
 * delivery %, and that day's volume) so a caller can show not just a
 * count but exactly when — and how much volume traded — on each one.
 *
 * Since the buckets are now disjoint ranges (see DELIVERY_BUCKETS above),
 * a single day contributes to exactly one bucket's count, unlike the
 * earlier cumulative design.
 *
 * Returns { counts: { "90": n, ... }, daysDetail: { "90": [{date,
 * deliveryPct, volume}, ...], ... } (most recent first), tradedDays,
 * windowStart, windowEnd } — plain objects/arrays, not Maps, so this
 * serializes straight to JSON for the API routes that use it.
 */
export function computeThresholdAppearances(symbol, days) {
  const counts = Object.fromEntries(APPEARANCE_BUCKET_IDS.map((id) => [id, 0]));
  const daysDetail = Object.fromEntries(APPEARANCE_BUCKET_IDS.map((id) => [id, []]));
  let tradedDays = 0;
  for (const day of days) {
    const row = day.bySymbol.get(symbol);
    if (!row || row.series !== "EQ" || !row.volume || row.deliveryPct == null) continue;
    tradedDays++;
    for (const id of APPEARANCE_BUCKET_IDS) {
      if (matchesBucket(row.deliveryPct, id)) {
        counts[id]++;
        daysDetail[id].push({ date: day.date, deliveryPct: row.deliveryPct, volume: row.volume });
      }
    }
  }
  for (const id of APPEARANCE_BUCKET_IDS) daysDetail[id].reverse(); // most recent first
  return {
    counts,
    daysDetail,
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
