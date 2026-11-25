import { serveCached } from "@/lib/precompute";
import { refreshAll, loadStored, loadDeals, cashView, oiView, sectorView, dealViews, expiryFlags } from "@/lib/fii";
import { getResolvedSectorList } from "@/lib/sectorOverrides";

// FII / DII tab: cash flows, derivatives positioning, NSDL sector flows and
// FII / DII bulk-block deals. Refreshed by the nightly precompute run (and on
// a cache miss); served from the stored result otherwise.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const WINDOWS = [
  { id: "1w", label: "1 week", days: 7 },
  { id: "1m", label: "1 month", days: 31 },
  { id: "3m", label: "3 months", days: 92 },
];
const since = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

async function compute() {
  // Each source is independent; give the slow ones a ceiling so the page
  // still answers from what's stored.
  const refresh = await Promise.race([refreshAll(), new Promise((r) => setTimeout(() => r({ timedOut: true }), 70000))]);
  const [stored, deals, sectorList] = await Promise.all([loadStored(), loadDeals(since(92)), getResolvedSectorList().catch(() => [])]);
  const sectorBySymbol = new Map();
  for (const s of sectorList) for (const sym of s.symbols ?? []) if (!sectorBySymbol.has(sym)) sectorBySymbol.set(sym, s.name);
  const sectorOf = (sym) => sectorBySymbol.get(sym) ?? null;

  const allDates = [...new Set([...Object.keys(stored.cash), ...Object.keys(stored.oi), ...Object.keys(stored.idx)])];
  const expiry = expiryFlags(allDates, stored.holidays);
  const cash = cashView(stored.cash, stored.idx, expiry);
  const oi = oiView(stored.oi, stored.idx, expiry);
  const sectors = sectorView(stored.sectors);
  const windows = Object.fromEntries(WINDOWS.map((w) => [w.id, dealViews(deals.filter((x) => x.d >= since(w.days)), sectorOf)]));
  const recent = [...deals].sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 60).map((x) => ({ ...x, sector: sectorOf(x.s) }));
  const asOf = [cash.latest?.date, oi.latest?.date, deals.reduce((m, x) => (x.d > m ? x.d : m), "")].filter(Boolean).sort().at(-1) ?? null;

  return Response.json({
    asOf,
    cash,
    oi,
    sectors,
    deals: { windows, windowList: WINDOWS, recent, total: deals.length },
    refresh,
  });
}

export async function GET(request) {
  return serveCached(request, { name: "fii-v2", vary: [], cacheable: () => true }, compute);
}
