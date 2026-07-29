// Indicator math for the Chartink-style screeners in
// app/api/screeners/route.js.
//
// Why the data comes from two places:
//   * NSE bhavcopy gives every listed symbol's OHLCV + delivery % in ONE
//     file per trading day, so it's the only sensible way to evaluate the
//     whole ~2000-stock universe. But a 200-day SMA would mean ~200
//     separate file fetches, which is far too slow for a request.
//   * Yahoo gives a year of daily bars for ONE symbol per call.
//
// So each screen runs its cheap, short-window conditions against a small
// bhavcopy window first (that's what narrows 2000 stocks down to tens),
// then fetches Yahoo history only for the survivors to evaluate the
// long-horizon indicators (150/200 SMA, 52-week extremes, 10-week volume
// average). See SHORTLIST_CAP in the route for the ceiling on that.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// --- Basic series helpers -------------------------------------------------
// All of these take arrays ordered OLDEST FIRST and return the value "as
// of" the most recent element, which is how every caller uses them.

export function sma(values, period) {
  if (!values || values.length < period) return null;
  const window = values.slice(-period);
  return window.reduce((a, b) => a + b, 0) / period;
}

// Weighted moving average: most recent bar carries the most weight.
export function wma(values, period) {
  if (!values || values.length < period) return null;
  const window = values.slice(-period);
  let weighted = 0;
  let weightSum = 0;
  window.forEach((v, i) => {
    const w = i + 1;
    weighted += v * w;
    weightSum += w;
  });
  return weighted / weightSum;
}

// Standard EMA seeded with the first value, matching the convention used
// in lib/niftyBank.js's computeEMA so the two agree.
export function ema(values, period) {
  if (!values || values.length === 0) return null;
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

// --- Weekly resampling ----------------------------------------------------

// Groups daily bars into ISO weeks (Mon-Sun), oldest first. Same
// week-keying convention as lib/wma.js and lib/niftyBank.js so weekly
// figures are consistent across the app.
export function toWeeklyBars(dailyBars) {
  const weeks = new Map();
  for (const bar of dailyBars) {
    const d = new Date(bar.t * 1000);
    const monday = new Date(d);
    const dayOfWeek = (monday.getUTCDay() + 6) % 7; // 0 = Monday
    monday.setUTCDate(monday.getUTCDate() - dayOfWeek);
    const key = monday.toISOString().slice(0, 10);

    const existing = weeks.get(key);
    if (!existing) {
      weeks.set(key, { key, h: bar.h, l: bar.l, c: bar.c, v: bar.v ?? 0 });
    } else {
      existing.h = Math.max(existing.h, bar.h);
      existing.l = Math.min(existing.l, bar.l);
      existing.c = bar.c; // later bar in the same week wins — the week's close so far
      existing.v += bar.v ?? 0;
    }
  }
  return [...weeks.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

// Highest weekly high / lowest weekly low over the last `weeks` completed
// weeks — Chartink's `weekly max(52, weekly high)` / `weekly min(52, weekly low)`.
export function weeklyExtremes(weeklyBars, periods = 52) {
  if (!weeklyBars || weeklyBars.length === 0) return { high: null, low: null };
  const window = weeklyBars.slice(-periods);
  return {
    high: Math.max(...window.map((w) => w.h)),
    low: Math.min(...window.map((w) => w.l)),
  };
}

// --- Yahoo daily history --------------------------------------------------

/**
 * Full OHLCV daily history for one NSE symbol. `range` of 2y gives enough
 * runway for a 200-day SMA and 52 completed weeks even after holidays.
 * Returns oldest-first bars, or null if the symbol couldn't be fetched.
 */
export async function fetchDailyOHLCV(symbol, range = "2y") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=1d&range=${range}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const bars = timestamps
      .map((t, i) => ({
        t,
        o: q.open?.[i] ?? null,
        h: q.high?.[i] ?? null,
        l: q.low?.[i] ?? null,
        c: q.close?.[i] ?? null,
        v: q.volume?.[i] ?? null,
      }))
      .filter((b) => b.c != null && b.h != null && b.l != null);

    return {
      bars,
      // Yahoo reports the instrument's first trading day here, which is
      // what the IPO Base scan uses to confirm a listing date rather than
      // inferring it purely from bhavcopy absence.
      firstTradeDate: result.meta?.firstTradeDate ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch Yahoo history for many symbols with bounded concurrency, matching
 * the pattern already used by lib/wma.js's fetchWma30Batch.
 */
export async function fetchDailyOHLCVBatch(symbols, { concurrency = 8, range = "2y" } = {}) {
  const out = new Map();
  const unique = [...new Set(symbols)];
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((s) => fetchDailyOHLCV(s, range).catch(() => null)));
    batch.forEach((s, idx) => out.set(s, results[idx]));
  }
  return out;
}

// --- Per-symbol series from bhavcopy -------------------------------------

/**
 * Pulls one symbol's rows out of a bhavcopy day list (oldest first),
 * returning only the days where the symbol actually traded. `days` comes
 * from getRecentBhavcopies().
 */
export function symbolSeries(symbol, days) {
  const out = [];
  for (const day of days) {
    const row = day.bySymbol.get(symbol);
    if (!row) continue;
    out.push({ date: day.date, ...row });
  }
  return out;
}
