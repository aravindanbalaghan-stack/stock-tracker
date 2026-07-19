import {
  fetchIntradayBars,
  fetchDailyBars,
  fetchConstituentIntradayVolumeByBucket,
  fetchConstituentDailyVolumeByDate,
  attachIntradayVolume,
  attachDailyVolume,
  groupByTradingDay,
  buildRollingVolumeSeries,
  findSwingHighs,
  findBreakAfter,
  hasRealVolumeData,
  MAX_INTRADAY_LOOKBACK_DAYS,
  GOOD_VOLUME_MULTIPLIER,
  NIFTY_BANK_CONSTITUENTS,
} from "@/lib/niftyBank";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const IST_TZ = "Asia/Kolkata";
function istDateKeyOf(epochSeconds) {
  return new Date(epochSeconds * 1000).toLocaleDateString("en-CA", { timeZone: IST_TZ });
}

function istToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: IST_TZ });
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: IST_TZ });
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
  const requireVolume = searchParams.get("requireVolume") !== "false";

  const start = requestedStart < earliestUsable ? earliestUsable : requestedStart;
  const end = requestedEnd > today ? today : requestedEnd;

  if (start > end) {
    return Response.json({ error: "Start date must be before end date" }, { status: 400 });
  }

  try {
    const [rawIntradayBars, intradayVolume] = await Promise.all([
      fetchIntradayBars("5m", "60d"),
      fetchConstituentIntradayVolumeByBucket("5m", "60d"),
    ]);

    if (!rawIntradayBars || rawIntradayBars.length === 0) {
      return Response.json(
        { error: "Yahoo's intraday feed for NIFTY BANK returned no data — try again shortly" },
        { status: 503 }
      );
    }

    const intradayBars = attachIntradayVolume(rawIntradayBars, intradayVolume.totals, intradayVolume.bucketSeconds);
    const hasVolumeData = hasRealVolumeData(intradayBars);
    const allDays = groupByTradingDay(intradayBars);

    const rolling5 = buildRollingVolumeSeries(allDays, 5);
    const rolling10 = buildRollingVolumeSeries(allDays, 10);

    // Swing highs (pivot highs) on the 10-minute candle series — a
    // 2-candle-each-side fractal, the standard definition: this 10-min
    // candle's high is greater than the 2 before and 2 after it. Only
    // confirmed once those 2 following candles have printed.
    const allSwingHighs = findSwingHighs(rolling10.continuous, { lookback: 2, lookforward: 2 });
    const swingHighsInRange = allSwingHighs.filter((s) => {
      const d = istDateKeyOf(s.time);
      return d >= start && d <= end;
    });

    const swingHighs = swingHighsInRange.map((swing) => {
      const break5 = findBreakAfter(rolling5.continuous, swing.confirmedAtTime, swing.price, {
        requireVolume,
        hasVolumeData,
        rollingAvgByTime: rolling5.rollingAvgByTime,
        volumeMultiplier,
      });
      const break10 = findBreakAfter(rolling10.continuous, swing.confirmedAtTime, swing.price, {
        requireVolume,
        hasVolumeData,
        rollingAvgByTime: rolling10.rollingAvgByTime,
        volumeMultiplier,
      });
      return {
        date: istDateKeyOf(swing.time),
        time: swing.time,
        price: swing.price,
        confirmedAtTime: swing.confirmedAtTime,
        break5,
        break10,
      };
    });

    swingHighs.sort((a, b) => b.time - a.time); // most recent first

    return Response.json({
      requestedStart,
      requestedEnd,
      usableStart: start,
      usableEnd: end,
      earliestUsableStart: earliestUsable,
      swingHighCount: swingHighs.length,
      brokenBothCount: swingHighs.filter((s) => s.break5 && s.break10).length,
      hasVolumeData,
      requireVolume,
      volumeSource: "constituents",
      volumeConstituentsReporting: intradayVolume.contributingSymbols.length,
      volumeConstituentsTotal: NIFTY_BANK_CONSTITUENTS.length,
      swingHighs,
      criteria: {
        goodVolumeMultiplier: volumeMultiplier,
        maxIntradayLookbackDays: MAX_INTRADAY_LOOKBACK_DAYS,
        rollingVolumeWindow: 30,
        swingLookback: 2,
        swingLookforward: 2,
      },
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to compute NIFTY BANK swing highs", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
