import {
  fetchIntradayBars,
  fetchDailyBars,
  fetchConstituentIntradayVolumeByBucket,
  fetchConstituentDailyVolumeByDate,
  attachIntradayVolume,
  attachDailyVolume,
  groupByTradingDay,
  detectOpeningRangeBreakout,
  summarizeAfterBreakout,
  hasRealVolumeData,
  computeEMA,
  toWeeklyVolumes,
  MAX_INTRADAY_LOOKBACK_DAYS,
  GOOD_VOLUME_MULTIPLIER,
  NIFTY_BANK_CONSTITUENTS,
} from "@/lib/niftyBank";

export const dynamic = "force-dynamic";
// Same reasoning as app/api/delivery/route.js's Monthly view and
// app/api/niftybank/live/route.js — fetching 60 days of intraday data for
// 12 constituent stocks (plus the index itself) is a lot of upstream
// Yahoo calls on a cold cache.
export const maxDuration = 60;

const EMA_PERIOD = 21;
const AVG_VOLUME_WEEKS = 30;

function istToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const today = istToday();
  const earliestUsable = daysAgo(MAX_INTRADAY_LOOKBACK_DAYS);

  const requestedStart = searchParams.get("start") || earliestUsable;
  const requestedEnd = searchParams.get("end") || today;
  const volumeMultiplierParam = Number(searchParams.get("volumeMultiplier"));
  const volumeMultiplier =
    Number.isFinite(volumeMultiplierParam) && volumeMultiplierParam > 0 ? volumeMultiplierParam : GOOD_VOLUME_MULTIPLIER;

  // Clamp to what Yahoo can actually provide rather than silently
  // returning nothing — the response reports both the requested and the
  // actually-usable range so the UI can tell the person their request got
  // narrowed, and why.
  const start = requestedStart < earliestUsable ? earliestUsable : requestedStart;
  const end = requestedEnd > today ? today : requestedEnd;

  if (start > end) {
    return Response.json({ error: "Start date must be before end date" }, { status: 400 });
  }

  try {
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
    const dailyBars = attachDailyVolume(rawDailyBars || [], dailyVolume.totals);

    const hasVolumeData = hasRealVolumeData(intradayBars);
    const days = groupByTradingDay(intradayBars).filter(([date]) => date >= start && date <= end);
    const dailyHasVolumeData = hasRealVolumeData(dailyBars);

    // EMA and weekly-volume context computed once across the whole daily
    // series, then looked up per backtest day — see below for why the
    // lookup uses the value from the trading day BEFORE each backtest day
    // (avoiding lookahead: a trader watching the 9:15 open doesn't have
    // that day's own close yet).
    const sortedDaily = [...(dailyBars || [])].sort((a, b) => a.t - b.t);
    const dailyDateKeys = sortedDaily.map(
      (b) => new Date(b.t * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
    );
    const closes = sortedDaily.map((b) => b.c);
    const emaSeries = computeEMA(closes, EMA_PERIOD);
    const weeklyVolumePairs = toWeeklyVolumes(sortedDaily); // [ [weekStartDate, volume], ... ]

    function contextAsOf(dateKey) {
      // Index of the last daily bar strictly before `dateKey`.
      let idx = -1;
      for (let i = 0; i < dailyDateKeys.length; i++) {
        if (dailyDateKeys[i] < dateKey) idx = i;
        else break;
      }
      const ema21 = idx >= 0 && emaSeries[idx] != null ? Math.round(emaSeries[idx] * 100) / 100 : null;

      // Completed weeks strictly before the week containing `dateKey`.
      const weekMonday = (() => {
        const d = new Date(`${dateKey}T00:00:00+05:30`);
        const day = (d.getUTCDay() + 6) % 7;
        d.setUTCDate(d.getUTCDate() - day);
        return d.toISOString().slice(0, 10);
      })();
      const priorWeeks = weeklyVolumePairs.filter(([wk]) => wk < weekMonday).map(([, v]) => v);
      const avgVolume30w =
        dailyHasVolumeData && priorWeeks.length >= AVG_VOLUME_WEEKS
          ? Math.round(priorWeeks.slice(-AVG_VOLUME_WEEKS).reduce((a, b) => a + b, 0) / AVG_VOLUME_WEEKS)
          : null;

      return { ema21, avgVolume30w };
    }

    // Diagnostics so a run that finds nothing is legible rather than a
    // flat "0 rows" — how many days got partway there vs. not at all.
    let daysWithBreakout5Only = 0;
    let daysWithNeither = 0;

    const rows = [];
    for (const [date, dayBars] of days) {
      const signal = detectOpeningRangeBreakout(dayBars, { volumeMultiplier, hasVolumeData });
      if (!signal) continue;
      if (!signal.triggered) {
        if (signal.breakout5) daysWithBreakout5Only++;
        else daysWithNeither++;
        continue;
      }

      const after = summarizeAfterBreakout(dayBars, signal.breakout10);
      const { ema21, avgVolume30w } = contextAsOf(date);

      rows.push({
        date,
        first5High: signal.first5High,
        first10High: signal.first10High,
        breakout5Time: signal.breakout5.time,
        breakout5Price: signal.breakout5.price,
        breakout10Time: signal.breakout10.time,
        breakout10Price: signal.breakout10.price,
        dayVolume: hasVolumeData ? signal.dayVolume : null,
        ema21,
        avgVolume30w,
        ...after,
      });
    }

    return Response.json({
      requestedStart,
      requestedEnd,
      usableStart: start,
      usableEnd: end,
      earliestUsableStart: earliestUsable,
      tradingDaysScanned: days.length,
      triggeredCount: rows.length,
      daysWithBreakout5Only,
      daysWithNeither,
      hasVolumeData,
      volumeSource: "constituents",
      volumeConstituentsReporting: intradayVolume.contributingSymbols.length,
      volumeConstituentsTotal: NIFTY_BANK_CONSTITUENTS.length,
      rows,
      criteria: {
        goodVolumeMultiplier: volumeMultiplier,
        emaPeriod: EMA_PERIOD,
        avgVolumeWeeks: AVG_VOLUME_WEEKS,
        maxIntradayLookbackDays: MAX_INTRADAY_LOOKBACK_DAYS,
      },
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to run NIFTY BANK backtest", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
