import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import {
  computePeriodMetrics,
  buildRecentPeriodHistory,
  PERIOD_TRADING_DAYS,
  HISTORY_PERIODS,
  BASELINE_TRADING_DAYS,
  lookbackDaysFor,
} from "@/lib/deliveryMetrics";
import { SECTOR_LIST } from "@/lib/sectors";

// Same bhavcopy data source as Delivery Leaders/Breakouts — no external
// lookups beyond NSE's own daily file, so this stays fast and reliable.
export const dynamic = "force-dynamic";
// See app/api/delivery/route.js for why this is bumped — Monthly view's
// 10-period-deep history needs ~215 trading days of bhavcopy on a cold
// cache.
export const maxDuration = 60;

// A sector's delivery % is NOT the average of its stocks' individual
// delivery %s — that would let a single low-volume stock swing the sector
// number just as much as the sector's most-traded name. Instead it's the
// volume-weighted aggregate: total shares delivered across every
// constituent that traded, divided by total shares traded — the same way
// NSE itself would roll delivery data up across a basket. sumSectorDays
// takes an array of one or more days so the same helper covers Daily,
// Weekly, and Monthly — for Daily it's just called with a one-day array.
function sumSectorDays(symbols, dayInfos) {
  let volume = 0;
  let deliveryQty = 0;
  const matchedSymbols = new Set();
  for (const dayInfo of dayInfos) {
    for (const symbol of symbols) {
      const row = dayInfo.bySymbol.get(symbol);
      if (!row || row.series !== "EQ" || !row.volume) continue;
      volume += row.volume;
      deliveryQty += row.deliveryQty || 0;
      matchedSymbols.add(symbol);
    }
  }
  return { volume, deliveryQty, matched: matchedSymbols.size };
}

function weightedPct(volume, deliveryQty) {
  if (!volume) return null;
  return Math.round((deliveryQty / volume) * 10000) / 100;
}

// Sector-level equivalent of buildRecentPeriodHistory — same bucketing
// (periods × periodTradingDays trading days, most recent bucket last),
// but each bucket is the whole sector's volume-weighted delivery %
// instead of one symbol's.
function buildSectorPeriodHistory(symbols, days, periodTradingDays, periods) {
  const needed = periodTradingDays * periods;
  const window = days.slice(-needed);
  const chunks = [];
  for (let i = 0; i < window.length; i += periodTradingDays) {
    chunks.push(window.slice(i, i + periodTradingDays));
  }
  return chunks.map((chunkDays) => {
    const { volume, deliveryQty } = sumSectorDays(symbols, chunkDays);
    const startDate = chunkDays[0]?.date ?? null;
    const endDate = chunkDays[chunkDays.length - 1]?.date ?? null;
    return { date: endDate, startDate, endDate, deliveryPct: weightedPct(volume, deliveryQty), volume: volume || null };
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const periodParam = searchParams.get("period");
  const period = PERIOD_TRADING_DAYS[periodParam] ? periodParam : "daily";
  const periodTradingDays = PERIOD_TRADING_DAYS[period];

  try {
    const lookback = lookbackDaysFor(period);
    const days = await getRecentBhavcopies(lookback, lookback * 2 + 20);
    if (days.length < periodTradingDays + 1) {
      return Response.json(
        { error: "Not enough trading-day data available from NSE yet for this period" },
        { status: 503 }
      );
    }
    const latest = days[days.length - 1];
    const periodWindow = days.slice(-periodTradingDays);
    // Baseline for the "vs avg volume" comparison: a fixed-length window
    // immediately BEFORE the period, so a weekly ratio and a monthly ratio
    // are both "vs a typical 30-trading-day baseline" rather than windows
    // of different lengths.
    const baselineWindow = days.slice(0, days.length - periodTradingDays).slice(-BASELINE_TRADING_DAYS);

    const sectors = SECTOR_LIST.map(({ key, name, symbols }) => {
      const periodTotals = sumSectorDays(symbols, periodWindow);
      const deliveryPct = weightedPct(periodTotals.volume, periodTotals.deliveryQty);

      const baselineDailyVolumes = baselineWindow
        .map((d) => sumSectorDays(symbols, [d]).volume)
        .filter((v) => v > 0);
      const avgDailyVolume =
        baselineDailyVolumes.length > 0
          ? baselineDailyVolumes.reduce((a, b) => a + b, 0) / baselineDailyVolumes.length
          : null;
      const expectedPeriodVolume = avgDailyVolume != null ? avgDailyVolume * periodTradingDays : null;
      const volumeRatio =
        expectedPeriodVolume && expectedPeriodVolume > 0 ? periodTotals.volume / expectedPeriodVolume : null;

      // Sector-level average change % reflects whichever period is
      // selected (period return per stock, averaged).
      const periodChangeValues = symbols
        .map((s) => computePeriodMetrics(s, days, periodTradingDays)?.changePercent)
        .filter((v) => v != null);
      const avgChangePercent =
        periodChangeValues.length > 0
          ? Math.round((periodChangeValues.reduce((a, b) => a + b, 0) / periodChangeValues.length) * 100) / 100
          : null;

      // Sector's own delivery % trend, bucketed the same way as the
      // headline metric — with Weekly selected this is the last 10 weeks,
      // not the last 10 days.
      const deliveryHistory = buildSectorPeriodHistory(symbols, days, periodTradingDays, HISTORY_PERIODS);

      // Per-stock breakdown for the expand panel — now follows the same
      // period as the sector total (e.g. each constituent's own Weekly
      // delivery %, not always today's daily number), so the numbers you
      // see when you drill into a sector line up with what that stock
      // would show if you searched it on Delivery Leaders with the same
      // period selected. Sorted by delivery % so the sector's own
      // "leaders" surface first.
      const constituents = symbols
        .map((s) => computePeriodMetrics(s, days, periodTradingDays))
        .filter(Boolean)
        .map(({ category, _volumeAboveAvg, ...rest }) => ({
          ...rest,
          deliveryHistory: buildRecentPeriodHistory(rest.symbol, days, periodTradingDays, HISTORY_PERIODS),
        }))
        .sort((a, b) => (b.deliveryPct ?? 0) - (a.deliveryPct ?? 0));

      return {
        key,
        name,
        constituentCount: symbols.length,
        matchedCount: periodTotals.matched,
        deliveryPct,
        avgChangePercent,
        volume: periodTotals.volume || null,
        volumeRatio,
        deliveryHistory,
        constituents,
      };
    });

    sectors.sort((a, b) => (b.deliveryPct ?? 0) - (a.deliveryPct ?? 0));

    return Response.json({
      asOf: latest.date,
      period,
      sectors,
      tradingDaysUsed: days.length,
      criteria: { periodTradingDays, historyPeriods: HISTORY_PERIODS },
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to compute sector delivery screen", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
