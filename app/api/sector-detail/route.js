import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { getResolvedSectorList } from "@/lib/sectorOverrides";
import { fetchIndexOHLCV } from "@/lib/screenerIndicators";
import { ACCUMULATION_DELIVERY_THRESHOLD } from "@/lib/deliveryMetrics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The performance window, and the trailing average each day's volume is
// judged against — sized so the oldest day in the window still has a full
// 30 sessions behind it.
const WINDOW_DAYS = 22;
const AVG_WINDOW = 30;
const BHAV_WINDOW = WINDOW_DAYS + AVG_WINDOW + 5;

// Yahoo's symbol for the NIFTY 500. It isn't always resolvable, so the
// response records which benchmark actually answered rather than silently
// substituting one for the other.
const BENCHMARKS = [
  { symbol: "^CRSLDX", label: "NIFTY 500" },
  { symbol: "^NSEI", label: "NIFTY 50" },
];

async function fetchBenchmark(windowDays) {
  for (const b of BENCHMARKS) {
    const res = await fetchIndexOHLCV(b.symbol, "6mo").catch(() => null);
    const bars = res?.bars;
    if (!bars || bars.length < windowDays + 1) continue;
    const slice = bars.slice(-(windowDays + 1));
    const first = slice[0].c;
    const last = slice[slice.length - 1].c;
    if (!(first > 0)) continue;
    return {
      label: b.label,
      symbol: b.symbol,
      returnPct: Math.round(((last - first) / first) * 10000) / 100,
    };
  }
  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key) return Response.json({ error: "A sector key is required" }, { status: 400 });

  try {
    const sectors = await getResolvedSectorList();
    const sector = sectors.find((s) => s.key === key);
    if (!sector) return Response.json({ error: "Unknown sector" }, { status: 404 });

    const [days, benchmark] = await Promise.all([
      getRecentBhavcopies(BHAV_WINDOW, BHAV_WINDOW * 2 + 25),
      fetchBenchmark(WINDOW_DAYS).catch(() => null),
    ]);

    if (days.length < AVG_WINDOW + 2) {
      return Response.json(
        { error: "Not enough trading-day data available from NSE yet" },
        { status: 503 }
      );
    }

    const latest = days[days.length - 1];
    const windowStartIdx = Math.max(0, days.length - WINDOW_DAYS - 1);
    const windowDays = days.slice(windowStartIdx);

    // ---- Per-stock -----------------------------------------------------
    const stocks = [];
    for (const symbol of sector.symbols) {
      const today = latest.bySymbol.get(symbol);
      if (!today || today.series !== "EQ" || !today.volume || today.close == null) continue;

      // Return across the window, from the first session where the stock
      // actually traded.
      const windowRows = windowDays.map((d) => d.bySymbol.get(symbol)).filter(Boolean);
      if (windowRows.length < 2) continue;
      const firstClose = windowRows[0].close;
      const returnPct =
        firstClose > 0 ? Math.round(((today.close - firstClose) / firstClose) * 10000) / 100 : null;

      // Volume against this stock's own trailing 30-day average.
      const priorVols = [];
      for (let k = Math.max(0, days.length - 1 - AVG_WINDOW); k < days.length - 1; k++) {
        const v = days[k].bySymbol.get(symbol)?.volume;
        if (v > 0) priorVols.push(v);
      }
      const avgVol = priorVols.length ? priorVols.reduce((a, b) => a + b, 0) / priorVols.length : null;

      // Accumulation over the window: average delivery, and how many days
      // cleared the same threshold the Delivery screens use.
      const deliveries = windowRows.map((r) => r.deliveryPct).filter((v) => v != null);
      const avgDeliveryPct = deliveries.length
        ? Math.round((deliveries.reduce((a, b) => a + b, 0) / deliveries.length) * 100) / 100
        : null;
      const daysAboveThreshold = deliveries.filter((v) => v > ACCUMULATION_DELIVERY_THRESHOLD).length;

      // Volume-weighted delivery across the window — the same basis the
      // sector aggregate uses, so a stock and its sector are comparable.
      let wVol = 0;
      let wDel = 0;
      for (const r of windowRows) {
        if (!r.volume) continue;
        wVol += r.volume;
        wDel += r.deliveryQty ?? (r.deliveryPct != null ? (r.deliveryPct / 100) * r.volume : 0);
      }
      const weightedDeliveryPct = wVol > 0 ? Math.round((wDel / wVol) * 10000) / 100 : null;

      stocks.push({
        symbol,
        close: today.close,
        changePercent:
          today.prevClose && today.close
            ? Math.round(((today.close - today.prevClose) / today.prevClose) * 10000) / 100
            : null,
        returnPct,
        deliveryPct: today.deliveryPct,
        avgDeliveryPct,
        weightedDeliveryPct,
        daysAboveThreshold,
        daysCounted: deliveries.length,
        volume: today.volume,
        avgVolume: avgVol != null ? Math.round(avgVol) : null,
        volumeRatio: avgVol && avgVol > 0 ? Math.round((today.volume / avgVol) * 100) / 100 : null,
        windowVolume: wVol,
        isAdded: sector.addedSymbols.includes(symbol),
      });
    }

    // ---- Sector aggregate ----------------------------------------------
    // Return is equal-weighted across constituents: this answers "are the
    // stocks in this sector advancing", which a turnover-weighted figure
    // would let one heavyweight dominate.
    const returns = stocks.map((s) => s.returnPct).filter((v) => v != null);
    const sectorReturnPct = returns.length
      ? Math.round((returns.reduce((a, b) => a + b, 0) / returns.length) * 100) / 100
      : null;

    // Volume and delivery are volume-weighted, since those are quantities
    // that genuinely add up across the basket.
    const sumDayVolume = (day) =>
      sector.symbols.reduce((sum, sym) => {
        const r = day.bySymbol.get(sym);
        return sum + (r && r.series === "EQ" ? r.volume || 0 : 0);
      }, 0);

    const todayVolume = sumDayVolume(latest);
    const priorDayVolumes = [];
    for (let k = Math.max(0, days.length - 1 - AVG_WINDOW); k < days.length - 1; k++) {
      const v = sumDayVolume(days[k]);
      if (v > 0) priorDayVolumes.push(v);
    }
    const avgSectorVolume = priorDayVolumes.length
      ? priorDayVolumes.reduce((a, b) => a + b, 0) / priorDayVolumes.length
      : null;

    let sectorWVol = 0;
    let sectorWDel = 0;
    for (const day of windowDays) {
      for (const sym of sector.symbols) {
        const r = day.bySymbol.get(sym);
        if (!r || r.series !== "EQ" || !r.volume) continue;
        sectorWVol += r.volume;
        sectorWDel += r.deliveryQty ?? (r.deliveryPct != null ? (r.deliveryPct / 100) * r.volume : 0);
      }
    }
    const sectorDeliveryPct = sectorWVol > 0 ? Math.round((sectorWDel / sectorWVol) * 10000) / 100 : null;

    // ---- Relative performance ------------------------------------------
    for (const s of stocks) {
      s.vsSectorPct =
        s.returnPct != null && sectorReturnPct != null
          ? Math.round((s.returnPct - sectorReturnPct) * 100) / 100
          : null;
      s.vsBenchmarkPct =
        s.returnPct != null && benchmark
          ? Math.round((s.returnPct - benchmark.returnPct) * 100) / 100
          : null;
    }

    stocks.sort((a, b) => (b.vsSectorPct ?? -Infinity) - (a.vsSectorPct ?? -Infinity));

    return Response.json({
      key: sector.key,
      name: sector.name,
      asOf: latest.date,
      windowDays: WINDOW_DAYS,
      avgWindow: AVG_WINDOW,
      accumulationThreshold: ACCUMULATION_DELIVERY_THRESHOLD,
      constituentCount: sector.symbols.length,
      reportingCount: stocks.length,
      addedSymbols: sector.addedSymbols,
      sector: {
        returnPct: sectorReturnPct,
        deliveryPct: sectorDeliveryPct,
        volume: todayVolume || null,
        avgVolume: avgSectorVolume != null ? Math.round(avgSectorVolume) : null,
        volumeRatio:
          avgSectorVolume && avgSectorVolume > 0
            ? Math.round((todayVolume / avgSectorVolume) * 100) / 100
            : null,
        outperformers: stocks.filter((s) => (s.vsSectorPct ?? 0) > 0).length,
      },
      benchmark: benchmark
        ? { ...benchmark, vsSectorPct: sectorReturnPct != null ? Math.round((sectorReturnPct - benchmark.returnPct) * 100) / 100 : null }
        : null,
      stocks,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to build sector detail", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
