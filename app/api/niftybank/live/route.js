import {
  fetchIntradayBars,
  fetchDailyBars,
  fetchConstituentIntradayVolumeByBucket,
  fetchConstituentDailyVolumeByDate,
  attachIntradayVolume,
  attachDailyVolume,
  groupByTradingDay,
  detectOpeningRangeBreakout,
  buildTimeOfDayVolumeBaseline,
  hasRealVolumeData,
  computeEMA,
  toWeeklyVolumes,
  NIFTY_BANK_CONSTITUENTS,
} from "@/lib/niftyBank";

export const dynamic = "force-dynamic";
// Fetching + summing 12 constituent stocks' intraday data (for real
// volume, since the index itself reports none), across up to 60 days (for
// a meaningful time-of-day volume baseline — see buildTimeOfDayVolumeBaseline
// in lib/niftyBank.js), takes longer than a single-symbol, single-day fetch.
export const maxDuration = 60;

const EMA_PERIOD = 21;
const AVG_VOLUME_WEEKS = 30;

function istToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const volumeMultiplierParam = Number(searchParams.get("volumeMultiplier"));
  const volumeMultiplier = Number.isFinite(volumeMultiplierParam) && volumeMultiplierParam > 0 ? volumeMultiplierParam : undefined;

  try {
    // 60d rather than just today/a few days: the "good volume" check
    // compares each candle to the historical average volume at that same
    // time-of-day (see buildTimeOfDayVolumeBaseline) rather than a
    // same-day running average, which needs several weeks of prior
    // sessions to be a meaningful baseline, not just 1-4 data points.
    const [rawIntradayBars, rawDailyBars, intradayVolume, dailyVolume] = await Promise.all([
      fetchIntradayBars("5m", "60d"),
      fetchDailyBars("2y"),
      fetchConstituentIntradayVolumeByBucket("5m", "60d"),
      fetchConstituentDailyVolumeByDate("2y"),
    ]);

    if (!rawIntradayBars || rawIntradayBars.length === 0) {
      return Response.json(
        { error: "Yahoo's intraday feed for NIFTY BANK returned no data — try again shortly" },
        { status: 503 }
      );
    }

    // Real volume, summed from the 12 NIFTY BANK constituent stocks,
    // overlaid onto the index's own price bars (the index itself always
    // reports 0 — see hasRealVolumeData's comment in lib/niftyBank.js).
    const intradayBars = attachIntradayVolume(rawIntradayBars, intradayVolume.totals, intradayVolume.bucketSeconds);
    const hasVolumeData = hasRealVolumeData(intradayBars);

    const days = groupByTradingDay(intradayBars);
    const timeOfDayBaseline = hasVolumeData ? buildTimeOfDayVolumeBaseline(days) : null;
    const [asOf, todayBars] = days[days.length - 1];
    const signal = detectOpeningRangeBreakout(todayBars, { volumeMultiplier, hasVolumeData, timeOfDayBaseline });

    const today = istToday();
    // Daily bars strictly before today — today's own daily candle (if
    // Yahoo has already started forming one) is excluded so the EMA/avg
    // volume context reflects only fully-closed sessions, same causal
    // reasoning as the backtest route.
    const priorDailyBars = attachDailyVolume(rawDailyBars || [], dailyVolume.totals).filter((b) => {
      const key = new Date(b.t * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      return key < today;
    });
    const dailyHasVolumeData = hasRealVolumeData(priorDailyBars);

    const closes = priorDailyBars.map((b) => b.c).filter((c) => c != null);
    const emaSeries = computeEMA(closes, EMA_PERIOD);
    const ema21 = emaSeries.length > 0 ? Math.round(emaSeries[emaSeries.length - 1] * 100) / 100 : null;

    const weeklyVolumes = toWeeklyVolumes(priorDailyBars).map(([, v]) => v);
    const completedWeeks = weeklyVolumes.slice(0, -1); // drop the current, still-forming week
    const avgVolume30w =
      dailyHasVolumeData && completedWeeks.length >= AVG_VOLUME_WEEKS
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
      dayVolume: hasVolumeData ? (signal?.dayVolume ?? null) : null,
      hasVolumeData,
      volumeSource: "constituents",
      volumeConstituentsReporting: intradayVolume.contributingSymbols.length,
      volumeConstituentsTotal: NIFTY_BANK_CONSTITUENTS.length,
      breakout5: signal?.breakout5 ?? null,
      breakout10: signal?.breakout10 ?? null,
      triggered: signal?.triggered ?? false,
      ema21,
      avgVolume30w,
      criteria: { emaPeriod: EMA_PERIOD, avgVolumeWeeks: AVG_VOLUME_WEEKS, volumeMultiplier: volumeMultiplier ?? null },
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to compute NIFTY BANK live status", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
