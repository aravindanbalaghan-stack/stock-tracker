import { getCorporateEvents } from "@/lib/corporateEvents";
import { istToday } from "@/lib/marketHours";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/events               → upcoming events (today onward) for every stock, keyed by symbol
// GET /api/events?symbol=TCS    → that stock's upcoming AND recent (last 30 days) events
export async function GET(request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase();
  const { events, status, fetchedAt } = await getCorporateEvents();
  const today = istToday();
  if (symbol) {
    const mine = events.filter((e) => e.symbol === symbol);
    return Response.json({
      symbol,
      today,
      status,
      fetchedAt,
      upcoming: mine.filter((e) => e.date >= today),
      recent: mine.filter((e) => e.date < today).reverse(),
    });
  }
  const bySymbol = {};
  for (const e of events) {
    if (e.date < today) continue;
    (bySymbol[e.symbol] ??= []).push({ date: e.date, type: e.type, title: e.title });
  }
  return Response.json({ today, status, fetchedAt, bySymbol });
}
