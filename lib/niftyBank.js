// Data + signal logic for the NIFTY BANK Trading tab. Separate from
// lib/wma.js because that file's fetchDailySeries hardcodes the ".NS"
// suffix used for individual stocks — indices like ^NSEBANK use their raw
// Yahoo symbol instead (same distinction lib/indices.js already makes).

import { INDEX_CONSTITUENTS } from "@/lib/indexConstituents";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const NIFTY_BANK_SYMBOL = "^NSEBANK";

// The index itself has no real trade volume (see hasRealVolumeData's
// comment below) — but its 12 constituents do. Reusing the same
// hand-maintained list the Top Indices tab already has for ^NSEBANK
// means there's one source of truth instead of two.
export const NIFTY_BANK_CONSTITUENTS = INDEX_CONSTITUENTS["^NSEBANK"] ?? [];

// Yahoo's own hard limit, not a choice made here: intraday data (any
// interval under 1 day) is only retained for ~60 days, regardless of
// candle size. There is no way to get a genuine 3-month intraday
// backtest from this data source — 60 days (roughly the last 2 months of
// trading) is the practical ceiling. See NiftyBankTab.js for how this is
// surfaced to the person using the app.
export const MAX_INTRADAY_LOOKBACK_DAYS = 58; // slightly under 60 as a safety margin against Yahoo's own edge

const IST_TZ = "Asia/Kolkata";

function istDateKey(epochSeconds) {
  // en-CA gives YYYY-MM-DD directly, which is what every other date key
  // in this codebase (bhavcopy dates, etc.) already uses.
  return new Date(epochSeconds * 1000).toLocaleDateString("en-CA", { timeZone: IST_TZ });
}

async function fetchChart(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=${interval}&range=${range}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const bars = timestamps
      .map((t, i) => ({
        t,
        o: quote.open?.[i] ?? null,
        h: quote.high?.[i] ?? null,
        l: quote.low?.[i] ?? null,
        c: quote.close?.[i] ?? null,
        v: quote.volume?.[i] ?? null,
      }))
      .filter((b) => b.h != null && b.l != null && b.c != null);
    return bars;
  } catch {
    return null;
  }
}

// Daily OHLCV for the index — used for the 21 EMA (close-based, so the
// index's own always-0 volume doesn't matter here). range=2y gives enough
// history for both a stable EMA and 30+ weeks of completed weekly buckets
// even after dropping the current in-progress week.
export async function fetchDailyBars(range = "2y") {
  return fetchChart(NIFTY_BANK_SYMBOL, "1d", range);
}

// Intraday OHLC for the index (price levels only — volume comes from
// fetchConstituentIntradayVolumeByBucket instead, see below). `range`
// must respect Yahoo's ~60-day retention window for sub-daily intervals —
// see MAX_INTRADAY_LOOKBACK_DAYS.
export async function fetchIntradayBars(interval = "5m", range = "60d") {
  return fetchChart(NIFTY_BANK_SYMBOL, interval, range);
}

const CONSTITUENT_FETCH_CONCURRENCY = 6;

// Sums each constituent stock's intraday volume into 5-minute buckets
// (or whatever `interval` implies) and adds the buckets together — this
// is the NIFTY BANK "volume" actually used for signal detection, since
// the index itself reports none. Bucketing by a fixed epoch-aligned
// window (rather than trusting each stock's bar timestamps to line up
// exactly) is what makes summing across 12 independently-fetched series
// safe: NSE's 9:15 IST open lands exactly on a 5-minute UTC boundary, so
// flooring every bar's timestamp to the nearest bucket consistently
// groups the "same" 5 minutes across stocks even if Yahoo's per-symbol
// bar generation has minor jitter.
export async function fetchConstituentIntradayVolumeByBucket(interval = "5m", range = "60d") {
  const bucketSeconds = interval === "5m" ? 300 : interval === "15m" ? 900 : interval === "10m" ? 600 : 300;
  const totals = new Map(); // bucketEpoch -> summed volume
  const contributingSymbols = new Set(); // which constituents actually returned data, for diagnostics

  for (let i = 0; i < NIFTY_BANK_CONSTITUENTS.length; i += CONSTITUENT_FETCH_CONCURRENCY) {
    const batch = NIFTY_BANK_CONSTITUENTS.slice(i, i + CONSTITUENT_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map((symbol) => fetchChart(`${symbol}.NS`, interval, range).catch(() => null))
    );
    results.forEach((bars, idx) => {
      if (!bars || bars.length === 0) return;
      contributingSymbols.add(batch[idx]);
      for (const bar of bars) {
        if (bar.v == null) continue;
        const bucket = Math.floor(bar.t / bucketSeconds) * bucketSeconds;
        totals.set(bucket, (totals.get(bucket) ?? 0) + bar.v);
      }
    });
  }

  return { totals, contributingSymbols: [...contributingSymbols], bucketSeconds };
}

// Same idea as above but for daily bars, keyed by IST calendar date
// instead of an epoch bucket — daily bars are one-per-trading-day so a
// date-string key is simpler and doesn't depend on intraday alignment.
export async function fetchConstituentDailyVolumeByDate(range = "2y") {
  const totals = new Map(); // "YYYY-MM-DD" -> summed volume
  const contributingSymbols = new Set();

  for (let i = 0; i < NIFTY_BANK_CONSTITUENTS.length; i += CONSTITUENT_FETCH_CONCURRENCY) {
    const batch = NIFTY_BANK_CONSTITUENTS.slice(i, i + CONSTITUENT_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map((symbol) => fetchChart(`${symbol}.NS`, "1d", range).catch(() => null))
    );
    results.forEach((bars, idx) => {
      if (!bars || bars.length === 0) return;
      contributingSymbols.add(batch[idx]);
      for (const bar of bars) {
        if (bar.v == null) continue;
        const key = istDateKey(bar.t);
        totals.set(key, (totals.get(key) ?? 0) + bar.v);
      }
    });
  }

  return { totals, contributingSymbols: [...contributingSymbols] };
}

// Overlays aggregated constituent volume onto the index's own price bars,
// matching each bar to its 5-minute bucket. Bars with no matching bucket
// (a stock-only holiday quirk, or a bucket where every constituent
// happened to be missing data) keep v: null rather than silently
// becoming 0, so "no data" and "genuinely zero volume" stay distinguishable.
export function attachIntradayVolume(bars, volumeByBucket, bucketSeconds = 300) {
  return bars.map((bar) => {
    const bucket = Math.floor(bar.t / bucketSeconds) * bucketSeconds;
    const v = volumeByBucket.get(bucket);
    return { ...bar, v: v ?? null };
  });
}

// Same overlay for daily bars, keyed by IST date instead of a bucket.
export function attachDailyVolume(bars, volumeByDate) {
  return bars.map((bar) => {
    const key = istDateKey(bar.t);
    const v = volumeByDate.get(key);
    return { ...bar, v: v ?? null };
  });
}

// Groups intraday bars by IST trading day, sorted ascending both across
// days and within each day (Yahoo already returns bars in order, but this
// doesn't assume that).
export function groupByTradingDay(bars) {
  const byDay = new Map();
  for (const bar of bars) {
    const key = istDateKey(bar.t);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(bar);
  }
  for (const dayBars of byDay.values()) dayBars.sort((a, b) => a.t - b.t);
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)); // [ [date, bars[]], ... ] oldest first
}

// Standard EMA, causal (each value only depends on itself and earlier
// values) — index i of the returned array is "as of" values[i], so using
// series[i-1] for a signal computed at bar i avoids lookahead bias.
export function computeEMA(values, period) {
  if (!values || values.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

// Resamples daily bars into one summed volume per ISO week (Mon-Sun),
// oldest first — same week-bucketing convention as lib/wma.js's
// toWeeklyCloses, just summing volume instead of taking the last close.
export function toWeeklyVolumes(dailyBars) {
  const weeks = new Map();
  for (const bar of dailyBars) {
    if (bar.v == null) continue;
    const d = new Date(bar.t * 1000);
    const monday = new Date(d);
    const day = (monday.getUTCDay() + 6) % 7;
    monday.setUTCDate(monday.getUTCDate() - day);
    const key = monday.toISOString().slice(0, 10);
    weeks.set(key, (weeks.get(key) ?? 0) + bar.v);
  }
  return [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)); // [ [weekStart, volume], ... ]
}

function average(arr) {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

// A candle's volume counts as "good" if it's meaningfully above the
// average of the day's candles seen so far — a simple relative-volume
// check, not a claim about institutional activity. GOOD_VOLUME_MULTIPLIER
// is the one knob that defines "meaningfully" here.
export const GOOD_VOLUME_MULTIPLIER = 1.5;

// NIFTY BANK is an index, not a traded instrument — only its constituent
// stocks and derivatives actually trade, so Yahoo's own quote page for
// ^NSEBANK shows "Volume: 0", and its intraday chart data reports 0 for
// every candle. The routes work around this by overlaying real volume
// aggregated from the 12 constituent stocks (see
// fetchConstituentIntradayVolumeByBucket/attachIntradayVolume above)
// before bars ever reach this function. hasRealVolumeData is the
// fallback check for the unlikely case that overlay comes back empty too
// (e.g. all 12 constituent fetches failed) — without it, a volume filter
// requiring "> some multiple of a 0 average" would silently fail every
// single day regardless of price action, which is exactly what happened
// before the constituent overlay existed.
export function hasRealVolumeData(bars) {
  return (bars || []).some((b) => (b.v ?? 0) > 0);
}

function istTimeSlotKey(epochSeconds) {
  // "09:15", "09:20", ... — groups candles by time-of-day across
  // different days, regardless of which specific day each one is from.
  return new Date(epochSeconds * 1000).toLocaleTimeString("en-GB", {
    timeZone: IST_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Average volume observed at each 5-minute time-of-day slot (e.g.
// "09:15"), computed across every day in `groupedDays` (the output of
// groupByTradingDay). This exists because comparing a candle's volume to
// a same-day cumulative average is unreliable near the open: the very
// first candle (9:15-9:20) is almost always the day's highest-volume
// candle (opening auction settlement, overnight orders executing), so a
// same-day average is anchored artificially high right when a genuine
// opening-range breakout would need to clear it, and then drifts down as
// the day goes on — which pushes detected breakouts later than they
// actually happened, since an ordinary afternoon candle only looks "high
// volume" relative to an average dragged down from the open. Comparing
// each candle to the historical average AT THAT SAME TIME OF DAY sidesteps
// this: the baseline for the 9:15 slot is itself computed from other
// days' 9:15 candles, which are typically elevated too, so it's a fair
// like-for-like comparison from the very first candle of the day.
export function buildTimeOfDayVolumeBaseline(groupedDays) {
  const bySlot = new Map(); // slotKey -> volumes[]
  for (const [, dayBars] of groupedDays) {
    for (const bar of dayBars) {
      if (bar.v == null) continue;
      const slot = istTimeSlotKey(bar.t);
      if (!bySlot.has(slot)) bySlot.set(slot, []);
      bySlot.get(slot).push(bar.v);
    }
  }
  const avgBySlot = new Map();
  for (const [slot, vols] of bySlot) {
    avgBySlot.set(slot, vols.reduce((a, b) => a + b, 0) / vols.length);
  }
  return avgBySlot;
}

// Opening-range-breakout detection for one trading day's intraday bars
// (already sorted ascending, one entry per candle). Two-stage signal:
//  1. "5-min breakout" — some candle after the first one trades above the
//     first candle's high, on good volume.
//  2. "10-min breakout" — some candle from the third candle onward (i.e.
//     only once the first two candles — the first 10 minutes — have
//     actually completed) trades above the combined high of the first
//     two candles, on good volume, confirming the move.
// Both stages must fire for the day to count as a "setup". `hasVolumeData`
// should come from hasRealVolumeData() run once over the whole fetched
// dataset (not per-day) — see the routes that call this. `timeOfDayBaseline`
// (from buildTimeOfDayVolumeBaseline) is strongly preferred over the
// same-day fallback — see that function's comment for why.
export function detectOpeningRangeBreakout(
  dayBars,
  { volumeMultiplier = GOOD_VOLUME_MULTIPLIER, hasVolumeData = true, timeOfDayBaseline = null } = {}
) {
  if (!dayBars || dayBars.length < 3) return null;

  const first5 = dayBars[0];
  const second = dayBars[1];
  const first5High = first5.h;
  const first10High = Math.max(first5.h, second.h);

  let breakout5 = null;
  let breakout10 = null;
  const volsSoFar = [first5.v ?? 0];

  for (let i = 1; i < dayBars.length; i++) {
    const bar = dayBars[i];

    let goodVolume;
    if (!hasVolumeData) {
      // No real volume data at all — the condition can't meaningfully
      // gate anything, so treat it as satisfied rather than unmeetable.
      goodVolume = true;
    } else if (timeOfDayBaseline) {
      const baseline = timeOfDayBaseline.get(istTimeSlotKey(bar.t));
      goodVolume = baseline != null && baseline > 0 && (bar.v ?? 0) > baseline * volumeMultiplier;
    } else {
      // Fallback when no time-of-day baseline was supplied (e.g. not
      // enough historical days fetched yet) — same-day cumulative
      // average, with the opening-candle-skew caveat above.
      const avgVolSoFar = average(volsSoFar) ?? 0;
      goodVolume = avgVolSoFar > 0 && (bar.v ?? 0) > avgVolSoFar * volumeMultiplier;
    }

    // Using the candle's HIGH (not close) to test the break — "breaks the
    // high" means price traded above that level, which is a looser and
    // more standard reading than requiring the candle to close above it.
    if (!breakout5 && bar.h > first5High && goodVolume) {
      breakout5 = { index: i, time: bar.t, price: bar.h, volume: bar.v };
    }
    if (breakout5 && !breakout10 && i >= 2 && bar.h > first10High && goodVolume) {
      breakout10 = { index: i, time: bar.t, price: bar.h, volume: bar.v };
    }

    volsSoFar.push(bar.v ?? 0);
    if (breakout5 && breakout10) break;
  }

  return {
    first5High,
    first10High,
    dayVolume: dayBars.reduce((sum, b) => sum + (b.v ?? 0), 0),
    hasVolumeData,
    breakout5,
    breakout10,
    triggered: !!(breakout5 && breakout10),
  };
}

// "What happened next" for a triggered day — price action from the
// 10-min-breakout candle through the end of the available session data
// for that day.
export function summarizeAfterBreakout(dayBars, breakout10) {
  const after = dayBars.slice(breakout10.index + 1);
  const lastBar = dayBars[dayBars.length - 1];
  const highAfter = after.length > 0 ? Math.max(...after.map((b) => b.h)) : breakout10.price;
  const lowAfter = after.length > 0 ? Math.min(...after.map((b) => b.l)) : breakout10.price;
  const dayClose = lastBar.c;
  const pctFrom = (target) => (breakout10.price ? ((target - breakout10.price) / breakout10.price) * 100 : null);

  return {
    dayClose,
    dayHighAfterBreakout: highAfter,
    dayLowAfterBreakout: lowAfter,
    closeVsBreakoutPct: pctFrom(dayClose) != null ? Math.round(pctFrom(dayClose) * 100) / 100 : null,
    maxGainPct: pctFrom(highAfter) != null ? Math.round(pctFrom(highAfter) * 100) / 100 : null,
    maxDrawdownPct: pctFrom(lowAfter) != null ? Math.round(pctFrom(lowAfter) * 100) / 100 : null,
  };
}
