import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { computeMetrics, ACCUMULATION_WINDOW, BASELINE_TRADING_DAYS } from "@/lib/deliveryMetrics";
import { recordAccumulationSnapshot, getAccumulationFirstSeen } from "@/lib/accumulationHistory";

// Cheap, symbol-list-scoped accumulation read for the Watchlist tab —
// deliberately separate from app/api/delivery/route.js, which only
// returns rows above a delivery-% threshold and so can't be relied on to
// cover every watchlist symbol (a stock can be inAccumulation === true on
// its 20-day trailing read while today's single-day delivery % happens to
// sit under that threshold). This route computes the same heuristic
// directly for exactly the symbols asked for.

export const dynamic = "force-dynamic";

// Same reasoning as the accumulation section of app/api/stock-insight/
// route.js: the trailing 20-day accumulation window needs a 30-day
// volume baseline behind its OLDEST day too, plus slack for holidays.
const BHAV_WINDOW = ACCUMULATION_WINDOW + BASELINE_TRADING_DAYS + 5;

function avgVol(symbol, window) {
  const v = window.map((d) => d.bySymbol.get(symbol)?.volume).filter((x) => typeof x === "number" && x > 0);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get("symbols");
  if (!symbolsParam) {
    return Response.json({ error: "Missing ?symbols=SYM1,SYM2" }, { status: 400 });
  }
  const symbols = [...new Set(symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (symbols.length === 0) return Response.json({ asOf: null, results: {} });

  try {
    const days = await getRecentBhavcopies(BHAV_WINDOW, BHAV_WINDOW * 2 + 20);
    if (days.length < 5) {
      return Response.json(
        { error: "Not enough trading-day data available from NSE yet" },
        { status: 503 }
      );
    }
    const latest = days[days.length - 1];

    const yesToday = [];
    const results = {};
    for (const symbol of symbols) {
      const metrics = computeMetrics(symbol, days);
      const inAccumulation = metrics?.inAccumulation ?? null;
      if (inAccumulation) yesToday.push(symbol);
      results[symbol] = {
        inAccumulation,
        daysOfAccumulation: metrics?.daysOfAccumulation ?? null,
        accumulationWindowDays: metrics?.accumulationWindowDays ?? null,
        // Latest session's bhavcopy figures for the Watchlist columns.
        // Delivery % only exists in the end-of-day file, so all three come
        // from the same session to stay comparable with each other.
        turnoverCr: metrics?.turnoverCr ?? null,
        volumeRatio30d: metrics?.volumeRatio ?? null,
        deliveryPct: metrics?.deliveryPct ?? null,
        // The latest session's own volume, and two 30-session averages:
        //   avgVolume30     — the 30 sessions BEFORE the latest (what the
        //                     latest session's "vs 30D" is measured against)
        //   avgVolume30Live — the 30 sessions UP TO the latest, the right
        //                     baseline for a live, still-forming session
        latestVolume: latest.bySymbol.get(symbol)?.volume ?? null,
        avgVolume30: avgVol(symbol, days.slice(-31, -1)),
        avgVolume30Live: avgVol(symbol, days.slice(-30)),
      };
    }

    // Fire-and-forget — same first-seen bookkeeping as the Delivery tab's
    // full-universe pass (see app/api/delivery/route.js), so a watchlist
    // symbol gets its "first seen" date recorded even if nobody has
    // opened the Delivery tab today.
    recordAccumulationSnapshot(latest.date, yesToday).catch(() => {});

    const firstSeen = await getAccumulationFirstSeen(symbols);
    for (const symbol of symbols) {
      results[symbol].firstYes = firstSeen?.[symbol] ?? null;
    }

    return Response.json({ asOf: latest.date, results });
  } catch (err) {
    console.error("watchlist-accumulation: failed to compute accumulation status:", err?.message || err);
    return Response.json(
      { error: "Failed to compute accumulation status", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
