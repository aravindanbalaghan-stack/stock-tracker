// Data + signal logic for the NIFTY BANK Trading tab. Separate from
// lib/wma.js because that file's fetchDailySeries hardcodes the ".NS"
// suffix used for individual stocks — indices like ^NSEBANK use their raw
// Yahoo symbol instead (same distinction lib/indices.js already makes).

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const NIFTY_BANK_SYMBOL = "^NSEBANK";

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

async function fetchChart(interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    NIFTY_BANK_SYMBOL
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

// Daily OHLCV — used for the 21 EMA and the 30-week average volume.
// range=2y gives enough history for both a stable EMA and 30+ weeks of
// completed weekly buckets even after dropping the current in-progress
// week.
export async function fetchDailyBars(range = "2y") {
  return fetchChart("1d", range);
}

// Intraday OHLCV. `range` must respect Yahoo's ~60-day retention window
// for sub-daily intervals — see MAX_INTRADAY_LOOKBACK_DAYS.
export async function fetchIntradayBars(interval = "5m", range = "60d") {
  return fetchChart(interval, range);
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

// Opening-range-breakout detection for one trading day's intraday bars
// (already sorted ascending, one entry per candle). Two-stage signal:
//  1. "5-min breakout" — some candle after the first one closes above the
//     first candle's high, on good volume.
//  2. "10-min breakout" — some candle from the third candle onward (i.e.
//     only once the first two candles — the first 10 minutes — have
//     actually completed) closes above the combined high of the first
//     two candles, on good volume, confirming the move.
// Both stages must fire for the day to count as a "setup" — see
// buildBacktestRow for what gets reported once they do.
export function detectOpeningRangeBreakout(dayBars) {
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
    const avgVolSoFar = average(volsSoFar) ?? 0;
    const goodVolume = avgVolSoFar > 0 && (bar.v ?? 0) > avgVolSoFar * GOOD_VOLUME_MULTIPLIER;

    if (!breakout5 && bar.c > first5High && goodVolume) {
      breakout5 = { index: i, time: bar.t, price: bar.c, volume: bar.v };
    }
    if (breakout5 && !breakout10 && i >= 2 && bar.c > first10High && goodVolume) {
      breakout10 = { index: i, time: bar.t, price: bar.c, volume: bar.v };
    }

    volsSoFar.push(bar.v ?? 0);
    if (breakout5 && breakout10) break;
  }

  return {
    first5High,
    first10High,
    dayVolume: dayBars.reduce((sum, b) => sum + (b.v ?? 0), 0),
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
