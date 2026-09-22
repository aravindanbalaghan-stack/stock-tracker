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
