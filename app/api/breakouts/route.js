import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { computeMetrics } from "@/lib/deliveryMetrics";

// Same bhavcopy data source as the Delivery tab — no market-cap lookup
// involved here, so this route never touches the (flakier) NSE session
// endpoint and stays fast and reliable.
export const dynamic = "force-dynamic";

const LOOKBACK_DAYS = 31; // 1 "today" + 30 trailing days for the volume average

const DELIVERY_PCT_MIN = 70; // %
const CHANGE_PCT_MIN = 1; // % above previous close
const VOLUME_RATIO_MIN = 2; // x of the 30-day average volume

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

    const rows = [];
    for (const symbol of latest.bySymbol.keys()) {
      const metrics = computeMetrics(symbol, days);
      if (!metrics) continue;
      const { deliveryPct, changePercent, volumeRatio } = metrics;
      if (
        deliveryPct != null &&
        deliveryPct > DELIVERY_PCT_MIN &&
        changePercent != null &&
        changePercent > CHANGE_PCT_MIN &&
        volumeRatio != null &&
        volumeRatio >= VOLUME_RATIO_MIN
      ) {
        const { _volumeAboveAvg, ...rest } = metrics;
        rows.push(rest);
      }
    }

    // Strongest volume surge first — arguably the most "unusual" signal
    // of the three filters.
    rows.sort((a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0));

    return Response.json({
      asOf: latest.date,
      results: rows,
      tradingDaysUsed: days.length,
      criteria: {
        deliveryPctMin: DELIVERY_PCT_MIN,
        changePctMin: CHANGE_PCT_MIN,
        volumeRatioMin: VOLUME_RATIO_MIN,
      },
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to compute breakout screen", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
