import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import {
  computeMetrics,
  computePeriodMetrics,
  buildRecentHistory,
  PERIOD_TRADING_DAYS,
  BASELINE_TRADING_DAYS,
  lookbackDaysFor,
} from "@/lib/deliveryMetrics";
import { SECTOR_LIST } from "@/lib/sectors";

// Same bhavcopy data source as Delivery Leaders/Breakouts — no external
// lookups beyond NSE's own daily file, so this stays fast and reliable.
export const dynamic = "force-dynamic";

const SECTOR_HISTORY_DAYS = 10; // trading days shown when a sector row is expanded — always daily

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
      // selected (period return per stock, averaged) — separate from the
      // constituent breakdown table below, which always shows today's
      // numbers regardless of period, same reasoning as Delivery Leaders.
      const periodChangeValues = symbols
        .map((s) => computePeriodMetrics(s, days, periodTradingDays)?.changePercent)
        .filter((v) => v != null);
      const avgChangePercent =
        periodChangeValues.length > 0
          ? Math.round((periodChangeValues.reduce((a, b) => a + b, 0) / periodChangeValues.length) * 100) / 100
          : null;

      const deliveryHistory = days.slice(-SECTOR_HISTORY_DAYS).map((d) => {
        const s = sumSectorDays(symbols, [d]);
        return { date: d.date, deliveryPct: weightedPct(s.volume, s.deliveryQty), volume: s.volume || null };
      });

      // Per-stock breakdown for the expand panel — reuses the exact same
      // per-symbol computation Delivery Leaders and Breakouts use, so the
      // numbers line up with what you'd see if you searched the same
      // symbol there. Always today's daily numbers, regardless of the
      // sector-level period selected. Sorted by delivery % so the
      // sector's own "leaders" surface first.
      const constituents = symbols
        .map((s) => computeMetrics(s, days))
        .filter(Boolean)
        .map(({ category, _volumeAboveAvg, ...rest }) => ({
          ...rest,
          deliveryHistory: buildRecentHistory(rest.symbol, days, SECTOR_HISTORY_DAYS),
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
      criteria: { periodTradingDays },
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to compute sector delivery screen", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
