import { fetchDailyOHLCV } from "@/lib/screenerIndicators";
import { kv } from "@/lib/kv";
import { getSessionUser } from "@/lib/auth";
import { getJournal } from "@/lib/journalStore";
import { getEntries } from "@/lib/analysis";
import { getHoldings } from "@/lib/holdingsStore";
import { getCorporateEvents } from "@/lib/corporateEvents";
import { SCREENS, SCREEN_ORDER } from "@/lib/screens";

// GET /api/chart?symbol=TCS — everything the stock page chart draws:
// 5 years of daily candles plus the overlays only Panel has —
// when its screeners fired on the stock, corporate events, and (for the
// signed-in user) Journal trades, Analysis ideas/studies and the holding.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const istDate = (t) => new Date((t + 19800) * 1000).toISOString().slice(0, 10);

// A stock sits on a screener for days at a time — mark where each run
// started, not every day of it.
function runStarts(dates) {
  const out = [];
  let prev = null;
  for (const d of [...dates].sort()) {
    if (!prev || (new Date(`${d}T00:00:00Z`) - new Date(`${prev}T00:00:00Z`)) / 86400000 > 6) out.push(d);
    prev = d;
  }
  return out;
}

export async function GET(request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9&\-]+$/.test(symbol)) return Response.json({ error: "Expected ?symbol=" }, { status: 400 });

  const user = await getSessionUser();
  const [hist, membership, events, journal, analysis, holdings] = await Promise.all([
    fetchDailyOHLCV(symbol, "5y"),
    kv.get(`screener-membership:symbol:${symbol}`).catch(() => null),
    getCorporateEvents().catch(() => ({ events: [] })),
    user ? getJournal(user).catch(() => []) : [],
    user ? getEntries(user).catch(() => []) : [],
    user ? getHoldings(user).catch(() => null) : null,
  ]);
  if (!hist?.bars?.length) return Response.json({ error: `No price history for ${symbol}` }, { status: 404 });

  const bars = hist.bars.map((b) => ({ time: istDate(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0 }));

  const signals = [];
  for (const [screenId, dates] of Object.entries(membership?.occurrences ?? {})) {
    if (!SCREEN_ORDER.includes(screenId) || !Array.isArray(dates)) continue;
    for (const d of runStarts(dates)) signals.push({ date: d, screen: screenId, label: SCREENS[screenId]?.label ?? screenId });
  }

  const trades = (journal ?? [])
    .filter((t) => t.symbol === symbol && !t.draft)
    .map((t) => ({
      id: t.id,
      side: t.side,
      entryDate: t.entryDate,
      entryPrice: t.entryPrice,
      exitDate: t.exitDate,
      exitPrice: t.exitPrice,
      quantity: t.quantity,
      stopLoss: t.stopLoss,
      target: t.target,
      setup: t.setup,
    }));

  const ideas = [];
  const studies = [];
  for (const e of analysis ?? []) {
    for (const i of e.ideas ?? []) if (i.symbol === symbol) ideas.push({ date: e.date, direction: i.direction, entry: i.entry, stop: i.stop, target: i.target, setup: i.setup });
    for (const st of e.studies ?? [])
      if (st.symbol === symbol) studies.push({ date: e.date, verdict: st.verdict, supports: st.supports, resistances: st.resistances, patterns: st.patterns });
  }

  const holdingList = Array.isArray(holdings) ? holdings : holdings?.entries ?? [];
  const holding = holdingList.find((h) => h.symbol === symbol) ?? null;

  return Response.json({
    symbol,
    asOf: bars[bars.length - 1].time,
    bars,
    signals: signals.sort((a, b) => (a.date < b.date ? -1 : 1)),
    events: (events.events ?? []).filter((e) => e.symbol === symbol).map((e) => ({ date: e.date, type: e.type, title: e.title })),
    trades,
    ideas,
    studies,
    holding: holding ? { quantity: holding.quantity, avgPrice: holding.avgPrice, buyDate: holding.buyDate } : null,
  });
}
