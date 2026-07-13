import { getRecentBhavcopies } from "@/lib/nseBhavcopy";

export const revalidate = 1800;

const LOOKBACK_DAYS = 31; // 1 "today" + 30 trailing days for the volume average
const DELIVERY_HISTORY_DAYS = 10;

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
    const history = days.slice(0, -1);
    const deliveryWindow = days.slice(-DELIVERY_HISTORY_DAYS); // last 10 trading days, oldest→newest

    const rows = [];
    for (const [symbol, today] of latest.bySymbol.entries()) {
      if (today.series !== "EQ") continue; // BE-series is 100% delivery by rule — not a meaningful signal
      if (!today.volume || today.deliveryPct == null) continue;

      const pastVolumes = history
        .map((d) => d.bySymbol.get(symbol)?.volume)
        .filter((v) => typeof v === "number" && v > 0);

      if (pastVolumes.length < 5) continue;

      const avgVolume = pastVolumes.reduce((a, b) => a + b, 0) / pastVolumes.length;
      if (today.volume <= avgVolume) continue;

      const deliveryHistory = deliveryWindow.map((d) => ({
        date: d.date,
        deliveryPct: d.bySymbol.get(symbol)?.deliveryPct ?? null,
      }));

      rows.push({
        symbol,
        close: today.close,
        volume: today.volume,
        avgVolume30d: Math.round(avgVolume),
        volumeRatio: avgVolume > 0 ? today.volume / avgVolume : null,
        deliveryPct: today.deliveryPct,
        deliveryHistory,
      });
    }

    rows.sort((a, b) => (b.deliveryPct ?? 0) - (a.deliveryPct ?? 0));

    return Response.json({
      asOf: latest.date,
      results: rows.slice(0, 20),
      tradingDaysUsed: days.length,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to compute delivery screen", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
