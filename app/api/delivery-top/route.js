import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { computePeriodMetrics, PERIOD_TRADING_DAYS, BASELINE_TRADING_DAYS, buildRecentPeriodHistory } from "@/lib/deliveryMetrics";
import { getMarketCapsCr } from "@/lib/marketCap";

// GET /api/delivery-top?period=weekly|monthly&date=&minVolRatio=&minTurnoverCr=
//
// Delivery tab → "Top 20 · Weekly" / "Top 20 · Monthly": the 20 stocks with
// the highest delivery % over the last week (5 sessions) or month (21),
// counting ONLY stocks that also traded with real size over that period:
//   - volume at least `minVolRatio` × normal (default 1.5×; "normal" = the
//     30 sessions before the period, scaled to the period's length), and
//   - average daily turnover at least ₹`minTurnoverCr` Cr (default 10).
// High delivery on tiny volume means little; high delivery while volume
// and money both expand is the accumulation worth looking at.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOP_N = 20;
// Delivery-% trend shown per row: 10 weeks, or 6 months (a deeper monthly
// history would mean ~200 daily files on a cold cache).
const HIST = { weekly: 10, monthly: 6 };
const MAX_ASOF_TRADING_DAYS = 23;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") === "weekly" ? "weekly" : "monthly";
  const P = PERIOD_TRADING_DAYS[period];
  const minVolRatio = Math.max(0, Number(searchParams.get("minVolRatio")) || 1.5);
  const minTurnoverCr = Math.max(0, Number(searchParams.get("minTurnoverCr")) || 10);
  const dateParam = searchParams.get("date");
  const asOf = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;

  try {
    // Two periods (this + the previous, for the change column) plus the
    // 30-session volume baseline, plus room for the as-of picker.
    const need = Math.max(P * HIST[period], P * 2 + BASELINE_TRADING_DAYS) + 5 + (asOf ? MAX_ASOF_TRADING_DAYS : 0);
    let days = await getRecentBhavcopies(need, need * 2 + 20);
    if (asOf) days = days.filter((d) => d.date <= asOf);
    if (days.length < P + BASELINE_TRADING_DAYS) {
      return Response.json({ error: "Not enough NSE data for this period yet" }, { status: 503 });
    }
    const latest = days[days.length - 1];
    const prevDays = days.slice(0, -P);

    let considered = 0;
    let passed = [];
    for (const [symbol, row] of latest.bySymbol) {
      if (row.series !== "EQ" || !row.close || row.close < 20) continue;
      const m = computePeriodMetrics(symbol, days, P);
      if (!m || m.category !== "stock" || m.deliveryPct == null) continue;
      considered++;
      if (m.tradedDays < Math.ceil(P * 0.8)) continue;
      const avgTurnoverCr = m.turnoverCr != null ? m.turnoverCr / m.tradedDays : null;
      if (!(m.volumeRatio >= minVolRatio) || !(avgTurnoverCr >= minTurnoverCr)) continue;
      const prev = computePeriodMetrics(symbol, prevDays, P);
      passed.push({
        symbol,
        close: m.close,
        changePercent: m.changePercent,
        deliveryPct: m.deliveryPct,
        prevDeliveryPct: prev?.deliveryPct ?? null,
        deliveryChange: prev?.deliveryPct != null ? Math.round((m.deliveryPct - prev.deliveryPct) * 100) / 100 : null,
        volume: m.volume,
        volumeRatio: m.volumeRatio,
        turnoverCr: m.turnoverCr,
        avgTurnoverCr: Math.round(avgTurnoverCr * 100) / 100,
        deliveredValueCr: m.turnoverCr != null ? Math.round(((m.turnoverCr * m.deliveryPct) / 100) * 100) / 100 : null,
        inAccumulation: m.inAccumulation,
        daysOfAccumulation: m.daysOfAccumulation,
      });
    }
    const qualifying = passed.length;
    passed.sort((a, b) => b.deliveryPct - a.deliveryPct || b.deliveredValueCr - a.deliveredValueCr);
    passed = passed.slice(0, TOP_N);

    const caps = await getMarketCapsCr(passed.map((r) => r.symbol), { nseLimit: TOP_N });
    const rows = passed.map((r, i) => ({
      ...r,
      rank: i + 1,
      marketCapCr: caps.get(r.symbol) != null ? Math.round(caps.get(r.symbol)) : null,
      deliveryHistory: buildRecentPeriodHistory(r.symbol, days, P, Math.min(HIST[period], Math.floor(days.length / P))),
    }));

    return Response.json({
      period,
      asOf: latest.date,
      windowFirstDate: days[days.length - P]?.date ?? null,
      criteria: { periodTradingDays: P, minVolRatio, minTurnoverCr, topN: TOP_N, baselineDays: BASELINE_TRADING_DAYS },
      considered,
      qualifying,
      rows,
    });
  } catch (err) {
    return Response.json({ error: "Couldn't build the top delivery list", detail: String(err?.message || err) }, { status: 502 });
  }
}
