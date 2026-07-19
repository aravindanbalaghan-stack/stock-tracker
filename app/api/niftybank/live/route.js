import {
  fetchIntradayBars,
  fetchDailyBars,
  groupByTradingDay,
  detectOpeningRangeBreakout,
  computeEMA,
  toWeeklyVolumes,
} from "@/lib/niftyBank";

export const dynamic = "force-dynamic";

const EMA_PERIOD = 21;
const AVG_VOLUME_WEEKS = 30;

function istToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export async function GET() {
  try {
    // range=5d rather than 1d: 1d can come back empty in the minutes right
    // after market open, or on a day NSE was closed — 5d guarantees at
    // least one complete prior session to fall back to, and grouping by
    // day + taking the most recent group handles both cases the same way.
    const [intradayBars, dailyBars] = await Promise.all([
      fetchIntradayBars("5m", "5d"),
      fetchDailyBars("2y"),
    ]);

    if (!intradayBars || intradayBars.length === 0) {
      return Response.json(
        { error: "Yahoo's intraday feed for NIFTY BANK returned no data — try again shortly" },
        { status: 503 }
      );
    }

    const days = groupByTradingDay(intradayBars);
    const [asOf, todayBars] = days[days.length - 1];
    const signal = detectOpeningRangeBreakout(todayBars);

    const today = istToday();
    // Daily bars strictly before today — today's own daily candle (if
    // Yahoo has already started forming one) is excluded so the EMA/avg
    // volume context reflects only fully-closed sessions, same causal
    // reasoning as the backtest route.
    const priorDailyBars = (dailyBars || []).filter((b) => {
      const key = new Date(b.t * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      return key < today;
    });

    const closes = priorDailyBars.map((b) => b.c).filter((c) => c != null);
    const emaSeries = computeEMA(closes, EMA_PERIOD);
    const ema21 = emaSeries.length > 0 ? Math.round(emaSeries[emaSeries.length - 1] * 100) / 100 : null;

    const weeklyVolumes = toWeeklyVolumes(priorDailyBars).map(([, v]) => v);
    const completedWeeks = weeklyVolumes.slice(0, -1); // drop the current, still-forming week
    const avgVolume30w =
      completedWeeks.length >= AVG_VOLUME_WEEKS
        ? Math.round(completedWeeks.slice(-AVG_VOLUME_WEEKS).reduce((a, b) => a + b, 0) / AVG_VOLUME_WEEKS)
        : null;

    const latest = todayBars[todayBars.length - 1];

    return Response.json({
      asOf,
      candlesToday: todayBars.length,
      latestPrice: latest?.c ?? null,
      latestTime: latest?.t ?? null,
      first5High: signal?.first5High ?? null,
      first10High: signal?.first10High ?? null,
      dayVolume: signal?.dayVolume ?? null,
      breakout5: signal?.breakout5 ?? null,
      breakout10: signal?.breakout10 ?? null,
      triggered: signal?.triggered ?? false,
      ema21,
      avgVolume30w,
      criteria: { emaPeriod: EMA_PERIOD, avgVolumeWeeks: AVG_VOLUME_WEEKS },
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to compute NIFTY BANK live status", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
