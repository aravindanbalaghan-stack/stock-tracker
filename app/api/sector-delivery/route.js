import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { computeMetrics, buildRecentHistory } from "@/lib/deliveryMetrics";
import { SECTOR_LIST } from "@/lib/sectors";

// Same bhavcopy data source as Delivery Leaders/Breakouts — no external
// lookups beyond NSE's own daily file, so this stays fast and reliable.
export const dynamic = "force-dynamic";

const LOOKBACK_DAYS = 31; // 1 "today" + 30 trailing days, same window Delivery Leaders uses
const SECTOR_HISTORY_DAYS = 10; // trading days shown when a sector row is expanded

// A sector's delivery % is NOT the average of its stocks' individual
// delivery %s — that would let a single low-volume stock swing the sector
// number just as much as the sector's most-traded name. Instead it's the
// volume-weighted aggregate: total shares delivered across every
// constituent that traded, divided by total shares traded — the same way
// NSE itself would roll delivery data up across a basket.
function sumSectorDay(symbols, dayInfo) {
  let volume = 0;
  let deliveryQty = 0;
  let matched = 0;
  for (const symbol of symbols) {
    const row = dayInfo.bySymbol.get(symbol);
    if (!row || row.series !== "EQ" || !row.volume) continue;
    volume += row.volume;
    deliveryQty += row.deliveryQty || 0;
    matched++;
  }
  return { volume, deliveryQty, matched };
}

function weightedPct(volume, deliveryQty) {
  if (!volume) return null;
  return Math.round((deliveryQty / volume) * 10000) / 100;
}

export async function GET() {
  try {
    const days = await getRecentBhavcopies(LOOKBACK_DAYS);
    if (days.length < 2) {
      return Response.json(
        { error: "Not enough trading-day data available from NSE yet" },
        { status: 503 }
      );
    }
    const latest = days[days.length - 1];
    const trailingDays = days.slice(0, -1); // everything except today, for the volume average

    const sectors = SECTOR_LIST.map(({ key, name, symbols }) => {
      const today = sumSectorDay(symbols, latest);
      const deliveryPct = weightedPct(today.volume, today.deliveryQty);

      const pastVolumes = trailingDays
        .map((d) => sumSectorDay(symbols, d).volume)
        .filter((v) => v > 0);
      const avgVolume =
        pastVolumes.length > 0 ? pastVolumes.reduce((a, b) => a + b, 0) / pastVolumes.length : null;
      const volumeRatio = avgVolume && avgVolume > 0 ? today.volume / avgVolume : null;

      const deliveryHistory = days.slice(-SECTOR_HISTORY_DAYS).map((d) => {
        const s = sumSectorDay(symbols, d);
        return { date: d.date, deliveryPct: weightedPct(s.volume, s.deliveryQty), volume: s.volume || null };
      });

      // Per-stock breakdown for the expand panel — reuses the exact same
      // per-symbol computation Delivery Leaders and Breakouts use, so the
      // numbers line up with what you'd see if you searched the same
      // symbol there. Sorted by delivery % so the sector's own "leaders"
      // surface first.
      const constituents = symbols
        .map((s) => computeMetrics(s, days))
        .filter(Boolean)
        .map(({ category, _volumeAboveAvg, ...rest }) => ({
          ...rest,
          deliveryHistory: buildRecentHistory(rest.symbol, days, SECTOR_HISTORY_DAYS),
        }))
        .sort((a, b) => (b.deliveryPct ?? 0) - (a.deliveryPct ?? 0));

      const changeValues = constituents.map((c) => c.changePercent).filter((v) => v != null);
      const avgChangePercent =
        changeValues.length > 0
          ? Math.round((changeValues.reduce((a, b) => a + b, 0) / changeValues.length) * 100) / 100
          : null;

      return {
        key,
        name,
        constituentCount: symbols.length,
        matchedCount: today.matched,
        deliveryPct,
        avgChangePercent,
        volume: today.volume || null,
        volumeRatio,
        deliveryHistory,
        constituents,
      };
    });

    sectors.sort((a, b) => (b.deliveryPct ?? 0) - (a.deliveryPct ?? 0));

    return Response.json({
      asOf: latest.date,
      sectors,
      tradingDaysUsed: days.length,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to compute sector delivery screen", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
