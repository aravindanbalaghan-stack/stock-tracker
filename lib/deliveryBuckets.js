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

// Each appearance day's "vs avg volume" is judged against its own
// trailing 30-day average — same convention as the Accumulation table on
// the Stock Insight page (see buildDayRow there) and the accumulation
// heuristic in lib/deliveryMetrics.js. Callers must fetch at least this
// many extra trading days BEFORE the appearance window for the earliest
// appearance days to get a real average rather than a thin one — see
// APPEARANCE_LOOKBACK_TRADING_DAYS below for the combined total.
const VOLUME_AVG_DAYS = 30;

// How many trading days a caller should fetch to compute
// computeThresholdAppearances correctly: the appearance window itself,
// plus enough prior days for the OLDEST appearance day's volume average
// to be a real 30-day average rather than truncated. Exported so
// app/api/delivery/route.js can size its own bhavcopy fetch around it.
export const APPEARANCE_LOOKBACK_TRADING_DAYS = APPEARANCE_WINDOW_TRADING_DAYS + VOLUME_AVG_DAYS;

/**
 * For one symbol, how many days fell in each of the five "above" buckets
 * over the trailing `windowTradingDays` (default
 * APPEARANCE_WINDOW_TRADING_DAYS) of `days` — PLUS the specific days
 * themselves: date, delivery %, that day's volume, its volume against
 * its own trailing 30-day average, and its price move — so a caller can
 * show not just a count but the same detail the Accumulation table
 * shows for any other day.
 *
 * `days` should be the FULL fetched array, not pre-sliced to the
 * appearance window — this function does its own windowing, and needs
 * the days BEFORE the window to compute a real volume average for the
 * earliest appearance days (see APPEARANCE_LOOKBACK_TRADING_DAYS).
 *
 * Since the buckets are disjoint ranges (see DELIVERY_BUCKETS above), a
 * single day contributes to exactly one bucket's count.
 *
 * Returns { counts: { "90": n, ... }, daysDetail: { "90": [{date, close,
 * changePercent, deliveryPct, volume, volumeRatio}, ...], ... } (most
 * recent first), tradedDays, windowStart, windowEnd } — plain
 * objects/arrays, not Maps, so this serializes straight to JSON for the
 * API routes that use it.
 */
export function computeThresholdAppearances(symbol, days, windowTradingDays = APPEARANCE_WINDOW_TRADING_DAYS) {
  const counts = Object.fromEntries(APPEARANCE_BUCKET_IDS.map((id) => [id, 0]));
  const daysDetail = Object.fromEntries(APPEARANCE_BUCKET_IDS.map((id) => [id, []]));
  const start = Math.max(0, days.length - windowTradingDays);
  let tradedDays = 0;

  for (let i = start; i < days.length; i++) {
    const day = days[i];
    const row = day.bySymbol.get(symbol);
    if (!row || row.series !== "EQ" || !row.volume || row.deliveryPct == null) continue;
    tradedDays++;

    const priorVols = days
      .slice(Math.max(0, i - VOLUME_AVG_DAYS), i)
      .map((d) => d.bySymbol.get(symbol)?.volume)
      .filter((v) => v > 0);
    const avgVol = priorVols.length ? priorVols.reduce((a, b) => a + b, 0) / priorVols.length : null;
    const changePercent =
      row.prevClose && row.close ? Math.round(((row.close - row.prevClose) / row.prevClose) * 10000) / 100 : null;
    const volumeRatio = avgVol && avgVol > 0 ? Math.round((row.volume / avgVol) * 100) / 100 : null;

    for (const id of APPEARANCE_BUCKET_IDS) {
      if (matchesBucket(row.deliveryPct, id)) {
        counts[id]++;
        daysDetail[id].push({
          date: day.date,
          close: row.close,
          changePercent,
          deliveryPct: row.deliveryPct,
          volume: row.volume,
          volumeRatio,
        });
      }
    }
  }
  for (const id of APPEARANCE_BUCKET_IDS) daysDetail[id].reverse(); // most recent first
  return {
    counts,
    daysDetail,
    tradedDays,
    windowStart: days[start]?.date ?? null,
    windowEnd: days[days.length - 1]?.date ?? null,
  };
}

/** Batch form — same computation for many symbols against one shared
 * `days` window, so the window is only sliced/fetched once regardless of
 * how many symbols are being scored (used by the Delivery tab, which
 * needs this for every row it shows). */
export function computeThresholdAppearancesBatch(symbols, days, windowTradingDays = APPEARANCE_WINDOW_TRADING_DAYS) {
  const result = {};
  for (const symbol of symbols) {
    result[symbol] = computeThresholdAppearances(symbol, days, windowTradingDays);
  }
  return result;
}
