import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { computeMetrics } from "@/lib/deliveryMetrics";

// Same bhavcopy data source as the Delivery tab — no market-cap lookup
// involved here, so this route never touches the (flakier) NSE session
// endpoint and stays fast and reliable.
export const dynamic = "force-dynamic";

const BREAKOUT_DAYS = 10; // show one section per trading day, most recent first
const VOLUME_LOOKBACK = 31; // 1 "as of" day + 30 trailing days for that day's volume average —
// same window size Delivery Leaders uses, just recomputed fresh for each of the 10 days below.
// Total history needed: enough trailing days for the OLDEST of the 10 sections to still get a
// full 30-day volume average behind it.
const TOTAL_DAYS_NEEDED = VOLUME_LOOKBACK + BREAKOUT_DAYS - 1;

const DELIVERY_PCT_MIN = 70; // %
const CHANGE_PCT_MIN = 1; // % above previous close
const VOLUME_RATIO_MIN = 2; // x of that day's 30-day average volume

export async function GET() {
  try {
    // Wider calendar lookback than the default (60) since we need ~40
    // trading days, and a holiday-heavy stretch can eat into that margin.
    const days = await getRecentBhavcopies(TOTAL_DAYS_NEEDED, 90);
    if (days.length < 2) {
      return Response.json(
        { error: "Not enough trading-day data available from NSE yet" },
        { status: 503 }
      );
    }

    const daysToShow = Math.min(BREAKOUT_DAYS, days.length);
    const sections = [];

    // Walk backward from the most recent trading day. For each one, run
    // the exact same per-symbol computation Delivery Leaders uses, but
    // with "today" pinned to that day and its own trailing 30-day window
    // for the volume average — i.e. re-deriving what the Breakouts screen
    // would have shown if you'd loaded it on that day.
    for (let offset = 0; offset < daysToShow; offset++) {
      const idx = days.length - 1 - offset;
      const windowStart = Math.max(0, idx - VOLUME_LOOKBACK + 1);
      const window = days.slice(windowStart, idx + 1);
      const dayInfo = days[idx];

      const rows = [];
      for (const symbol of dayInfo.bySymbol.keys()) {
        const metrics = computeMetrics(symbol, window);
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

      rows.sort((a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0));
      sections.push({ date: dayInfo.date, results: rows });
    }

    return Response.json({
      sections,
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
