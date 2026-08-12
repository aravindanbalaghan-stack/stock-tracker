import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { getResolvedSectorList } from "@/lib/sectorOverrides";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const AVG_WINDOW = 30;
const BHAV_WINDOW = AVG_WINDOW + 2;
// Unclassified stocks number in the thousands, most of them illiquid. The
// list is capped and ordered by turnover so it surfaces the ones actually
// worth classifying rather than an unusable wall of shells.
const UNCLASSIFIED_CAP = 300;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const includeUnclassified = searchParams.get("unclassified") !== "0";

  try {
    const [days, sectorList] = await Promise.all([
      getRecentBhavcopies(BHAV_WINDOW, BHAV_WINDOW * 2 + 20),
      getResolvedSectorList(),
    ]);

    if (days.length < 2) {
      return Response.json(
        { error: "Not enough trading-day data available from NSE yet" },
        { status: 503 }
      );
    }
    const latest = days[days.length - 1];

    // Trailing volume average per symbol, computed once for everything
    // that traded today rather than per sector — stocks sit in more than
    // one sector, and recomputing per sector would repeat the work.
    const avgVolume = new Map();
    for (const symbol of latest.bySymbol.keys()) {
      const vols = [];
      for (let i = Math.max(0, days.length - 1 - AVG_WINDOW); i < days.length - 1; i++) {
        const v = days[i].bySymbol.get(symbol)?.volume;
        if (v > 0) vols.push(v);
      }
      if (vols.length) avgVolume.set(symbol, vols.reduce((a, b) => a + b, 0) / vols.length);
    }

    function rowFor(symbol) {
      const r = latest.bySymbol.get(symbol);
      if (!r || r.series !== "EQ" || r.close == null) return null;
      const avg = avgVolume.get(symbol) ?? null;
      return {
        symbol,
        close: r.close,
        changePercent:
          r.prevClose && r.close
            ? Math.round(((r.close - r.prevClose) / r.prevClose) * 10000) / 100
            : null,
        deliveryPct: r.deliveryPct,
        volume: r.volume,
        volumeRatio: avg && avg > 0 ? Math.round((r.volume / avg) * 100) / 100 : null,
        turnover: r.close * r.volume,
      };
    }

    const classified = new Set();
    const sectors = sectorList.map((s) => {
      const stocks = [];
      for (const symbol of s.symbols) {
        classified.add(symbol);
        const row = rowFor(symbol);
        if (row) stocks.push({ ...row, isAdded: s.addedSymbols.includes(symbol) });
      }
      stocks.sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0));

      const deliveries = stocks.map((x) => x.deliveryPct).filter((v) => v != null);
      return {
        key: s.key,
        name: s.name,
        listedCount: s.symbols.length,
        tradingCount: stocks.length,
        addedCount: s.addedSymbols.length,
        avgDeliveryPct: deliveries.length
          ? Math.round((deliveries.reduce((a, b) => a + b, 0) / deliveries.length) * 100) / 100
          : null,
        stocks,
      };
    });

    sectors.sort((a, b) => a.name.localeCompare(b.name));

    // Everything trading today that isn't in any sector — the working list
    // for filling gaps.
    let unclassified = [];
    let unclassifiedTotal = 0;
    if (includeUnclassified) {
      const all = [];
      for (const symbol of latest.bySymbol.keys()) {
        if (classified.has(symbol)) continue;
        const row = rowFor(symbol);
        if (row) all.push(row);
      }
      unclassifiedTotal = all.length;
      all.sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0));
      unclassified = all.slice(0, UNCLASSIFIED_CAP);
    }

    return Response.json({
      asOf: latest.date,
      sectorCount: sectors.length,
      classifiedCount: classified.size,
      unclassifiedTotal,
      unclassifiedShown: unclassified.length,
      unclassifiedCap: UNCLASSIFIED_CAP,
      sectors,
      unclassified,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to build the sector directory", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
