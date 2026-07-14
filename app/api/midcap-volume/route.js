import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { MIDCAP_UNIVERSE } from "@/lib/midcapUniverse";

// Always run fresh — freshness is controlled per-file inside
// lib/nseBhavcopy.js instead (30 min for the last 2 days, 7 days for
// older/historical files that can't change). Caching the whole route's
// output on top of that was compounding into multi-day-stale data.
export const dynamic = "force-dynamic";

const LOOKBACK_DAYS = 31; // 1 "today" + 30 trailing days for the average

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
    const history = days.slice(0, -1); // everything before latest, for the average

    const rows = [];
    for (const symbol of MIDCAP_UNIVERSE) {
      const today = latest.bySymbol.get(symbol);
      if (!today || !today.volume) continue;

      const pastVolumes = history
        .map((d) => d.bySymbol.get(symbol)?.volume)
        .filter((v) => typeof v === "number" && v > 0);

      if (pastVolumes.length < 5) continue; // not enough history to trust an average

      const avgVolume = pastVolumes.reduce((a, b) => a + b, 0) / pastVolumes.length;
      if (today.volume <= avgVolume) continue;

      const changePercent =
        today.prevClose && today.close
          ? ((today.close - today.prevClose) / today.prevClose) * 100
          : null;

      rows.push({
        symbol,
        close: today.close,
        changePercent,
        volume: today.volume,
        avgVolume30d: Math.round(avgVolume),
        volumeRatio: avgVolume > 0 ? today.volume / avgVolume : null,
        deliveryPct: today.deliveryPct,
      });
    }

    rows.sort((a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0));

    return Response.json({
      asOf: latest.date,
      results: rows.slice(0, 20),
      universeSize: MIDCAP_UNIVERSE.length,
      tradingDaysUsed: days.length,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to compute midcap volume screen", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
