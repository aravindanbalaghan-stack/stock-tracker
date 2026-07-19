// Shared per-symbol computation used by the Delivery Leaders screen
// (app/api/delivery/route.js), the Sector Deliverability screen
// (app/api/sector-delivery/route.js), and the Breakouts screen
// (app/api/breakouts/route.js). All three work off the same bhavcopy
// history (see lib/nseBhavcopy.js), so the per-symbol math lives here once
// instead of being duplicated across routes.

export const ACCUMULATION_WINDOW = 20; // trading days
export const ACCUMULATION_DELIVERY_THRESHOLD = 50; // %
export const ACCUMULATION_MIN_DAYS = 10; // out of the 20-day window

// Delivery Leaders and Sector Deliverability can both be viewed as Daily,
// Weekly, or Monthly — this is how many trading days make up one "period"
// for each. Weekly/Monthly aren't calendar weeks/months; they're the most
// recent N trading days, which is what actually matters for a volume/
// delivery aggregate and sidesteps holiday-calendar edge cases.
export const PERIOD_TRADING_DAYS = { daily: 1, weekly: 5, monthly: 21 };
// How many periods of history the "expand a row" drill-down shows — e.g.
// with Weekly selected, expanding a stock or sector shows its last 10
// weeks of (volume-weighted) delivery %, not its last 10 days.
export const HISTORY_PERIODS = 10;
// How many trading days immediately BEFORE the period to use as the
// "average" baseline for the vs-avg-volume comparison — deliberately a
// fixed window regardless of period, so a weekly ratio and a monthly ratio
// are both "vs a typical 30-trading-day baseline", not comparing against
// windows of different lengths.
export const BASELINE_TRADING_DAYS = 30;
// getRecentBhavcopies(count) needs `count` = enough trading days to cover
// BOTH requirements: the current period + its 30-day baseline, AND the
// full HISTORY_PERIODS-deep drill-down history (period × HISTORY_PERIODS
// trading days) — whichever is larger. For Daily, the baseline dominates
// (31 > 10). For Weekly/Monthly, the history dominates (50 and 210 trading
// days respectively) — Monthly in particular means a much longer NSE
// fetch on first (uncached) load; see the loading-state copy in the tabs.
export function lookbackDaysFor(period, periods = HISTORY_PERIODS) {
  const periodDays = PERIOD_TRADING_DAYS[period] ?? 1;
  return Math.max(periodDays * periods, periodDays + BASELINE_TRADING_DAYS) + 5;
}

// NSE's daily file has no instrument-type flag, so ETFs/REITs/InvITs are
// told apart from ordinary stocks by naming convention. This catches the
// large majority (most ETFs end in "BEES" or contain "ETF") but isn't
// guaranteed exhaustive — add to KNOWN_NON_STOCK_SYMBOLS if something
// specific slips through.
const ETF_PATTERNS = [/BEES$/i, /ETF/i];
const KNOWN_NON_STOCK_SYMBOLS = new Set([
  // REITs
  "EMBASSY", "MINDSPACE", "BIRET", "NXST",
  // InvITs
  "IRBINVIT", "INDIGRID", "PGINVIT", "ANZEN", "CUBEINVIT", "POWERGRIDINVIT",
  // Common ETFs that don't match the naming patterns above
  "GOLDSHARE", "MON100", "MOM100", "MOM50", "MOGSEC", "MASPTOP50", "MAFANG",
  "LICNETFN50", "SETFNIF50", "SETFNN50", "UTINIFTETF", "HDFCNIFTY",
  "HDFCSML250", "HDFCNEXT50", "HDFCGROWTH", "HDFCSENSEX", "GOLDIETF",
  "SILVERIETF", "AXISGOLD", "ABSLGOLD",
]);

export function classify(symbol) {
  const s = symbol.toUpperCase();
  if (KNOWN_NON_STOCK_SYMBOLS.has(s)) return "other";
  if (ETF_PATTERNS.some((p) => p.test(s))) return "other";
  return "stock";
}

// Delivery %/volume history for the "expand a row" drill-down, chunked
// into `periods` buckets of `periodTradingDays` trading days each — with
// Daily selected (periodTradingDays=1) this is just the last `periods`
// individual days; with Weekly/Monthly selected, each bucket is volume-
// weighted across its `periodTradingDays` days, same math as
// computePeriodMetrics, so a "week" in the history strip lines up with
// what the headline metric would show if that week were the current one.
// `days` already covers the lookback window the caller fetched (see
// lookbackDaysFor), so this is a plain in-memory computation — no extra
// network calls.
export function buildRecentPeriodHistory(symbol, days, periodTradingDays = 1, periods = HISTORY_PERIODS) {
  const needed = periodTradingDays * periods;
  const window = days.slice(-needed);
  const chunks = [];
  for (let i = 0; i < window.length; i += periodTradingDays) {
    chunks.push(window.slice(i, i + periodTradingDays));
  }
  return chunks.map((chunkDays) => {
    let volume = 0;
    let deliveryQty = 0;
    for (const d of chunkDays) {
      const row = d.bySymbol.get(symbol);
      if (!row || row.series !== "EQ" || !row.volume) continue;
      volume += row.volume;
      deliveryQty += row.deliveryQty || 0;
    }
    const deliveryPct = volume > 0 ? Math.round((deliveryQty / volume) * 10000) / 100 : null;
    const startDate = chunkDays[0]?.date ?? null;
    const endDate = chunkDays[chunkDays.length - 1]?.date ?? null;
    return { date: endDate, startDate, endDate, deliveryPct, volume: volume || null };
  });
}

// Core per-symbol computation, generalized over a "period" of the most
// recent `periodTradingDays` trading days instead of always being a
// single day. For periodTradingDays === 1 this reduces to exactly the old
// single-day math (delivery % for the day, volume for the day, previous-
// close-to-close change) — computeMetrics() below is that special case.
//
// For longer periods:
//  - deliveryPct is volume-weighted across the period (total delivered ÷
//    total traded), same reasoning as the sector aggregate: a plain
//    average of daily %s would let a single thin trading day swing the
//    number as much as the period's busiest day.
//  - changePercent is the period's return: latest close vs the close
//    immediately before the period started.
//  - volumeRatio compares the period's total volume to what
//    BASELINE_TRADING_DAYS of "normal" trading would produce (avg daily
//    volume over the pre-period baseline × periodTradingDays) — so a
//    weekly ratio and a monthly ratio are on the same footing.
//  - the accumulation heuristic is intentionally NOT period-dependent —
//    it's evaluated on the standard trailing 20-day window ending today,
//    same as always, since "is this currently building a position" is a
//    single ongoing read, not something that makes sense to ask "for last
//    month" separately.
export function computePeriodMetrics(symbol, days, periodTradingDays = 1) {
  if (days.length < periodTradingDays + 1) return null;

  const periodWindow = days.slice(-periodTradingDays);
  const preperiodWindow = days.slice(0, days.length - periodTradingDays);
  const latestDay = periodWindow[periodWindow.length - 1];
  const latest = latestDay.bySymbol.get(symbol);
  if (!latest || latest.series !== "EQ" || !latest.volume || latest.deliveryPct == null) return null;

  let periodVolume = 0;
  let periodDeliveryQty = 0;
  let tradedDays = 0;
  let periodOpenClose = null; // previous close going into the very first traded day of the period
  for (const d of periodWindow) {
    const row = d.bySymbol.get(symbol);
    if (!row || row.series !== "EQ" || !row.volume) continue;
    periodVolume += row.volume;
    periodDeliveryQty += row.deliveryQty || 0;
    tradedDays++;
    if (periodOpenClose == null) periodOpenClose = row.prevClose ?? row.close;
  }
  const deliveryPct = periodVolume > 0 ? (periodDeliveryQty / periodVolume) * 100 : null;
  const changePercent =
    periodOpenClose && latest.close ? ((latest.close - periodOpenClose) / periodOpenClose) * 100 : null;

  const baselineVolumes = preperiodWindow
    .slice(-BASELINE_TRADING_DAYS)
    .map((d) => d.bySymbol.get(symbol)?.volume)
    .filter((v) => typeof v === "number" && v > 0);
  const avgDailyVolume =
    baselineVolumes.length > 0 ? baselineVolumes.reduce((a, b) => a + b, 0) / baselineVolumes.length : null;
  const expectedPeriodVolume = avgDailyVolume != null ? avgDailyVolume * periodTradingDays : null;
  const volumeRatio =
    expectedPeriodVolume && expectedPeriodVolume > 0 ? periodVolume / expectedPeriodVolume : null;

  // Accumulation heuristic — always the standard trailing 20-day window
  // ending on the most recent trading day, independent of `periodTradingDays`.
  const accumulationWindow = days.slice(-ACCUMULATION_WINDOW);
  const windowRows = accumulationWindow.map((d) => d.bySymbol.get(symbol)?.deliveryPct ?? null);
  const daysAboveThreshold = windowRows.filter((v) => v != null && v > ACCUMULATION_DELIVERY_THRESHOLD).length;
  const oldestInWindow = accumulationWindow[0]?.bySymbol.get(symbol)?.close ?? null;
  const priceHeldOrRose = oldestInWindow != null ? latest.close >= oldestInWindow : null;
  const dailyBaselineVolumes = days
    .slice(0, -1)
    .map((d) => d.bySymbol.get(symbol)?.volume)
    .filter((v) => typeof v === "number" && v > 0);
  const avgDailyVolumeForAccum =
    dailyBaselineVolumes.length > 0
      ? dailyBaselineVolumes.reduce((a, b) => a + b, 0) / dailyBaselineVolumes.length
      : null;
  const volumeAboveAvg =
    avgDailyVolumeForAccum != null && avgDailyVolumeForAccum > 0 ? latest.volume > avgDailyVolumeForAccum : false;
  const inAccumulation =
    daysAboveThreshold >= ACCUMULATION_MIN_DAYS && priceHeldOrRose === true && volumeAboveAvg;

  return {
    symbol,
    category: classify(symbol),
    close: latest.close,
    changePercent: changePercent != null ? Math.round(changePercent * 100) / 100 : null,
    deliveryPct: deliveryPct != null ? Math.round(deliveryPct * 100) / 100 : null,
    volume: periodVolume,
    volumeRatio: volumeRatio != null ? Math.round(volumeRatio * 100) / 100 : null,
    periodTradingDays,
    tradedDays,
    daysOfAccumulation: daysAboveThreshold,
    accumulationWindowDays: windowRows.filter((v) => v != null).length,
    inAccumulation,
    _volumeAboveAvg: volumeAboveAvg,
  };
}

// Daily special case — used by Breakouts, which is always day-by-day by
// design regardless of any period selector elsewhere in the app.
export function computeMetrics(symbol, days) {
  return computePeriodMetrics(symbol, days, 1);
}
