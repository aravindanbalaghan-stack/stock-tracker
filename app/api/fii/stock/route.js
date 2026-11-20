import { loadDeals } from "@/lib/fii";

// One stock's FII / DII bulk & block deals (last ~4 months) — for the stock
// page's "FII bought / sold" badge. Reads only what the nightly run stored.

export const dynamic = "force-dynamic";

const r2 = (n) => Math.round(n * 100) / 100;

export async function GET(request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) return Response.json({ error: "Missing ?symbol=" }, { status: 400 });
  try {
    const all = await loadDeals(new Date(Date.now() - 130 * 86400000).toISOString().slice(0, 10));
    const deals = all.filter((x) => x.s === symbol).sort((a, b) => (a.d < b.d ? 1 : -1));
    const net = (who, days) => {
      const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const xs = deals.filter((x) => x.w === who && x.d >= from);
      return xs.length ? { netCr: r2(xs.reduce((a, x) => a + (x.side === "B" ? x.cr : -x.cr), 0)), deals: xs.length, last: xs[0].d } : null;
    };
    return Response.json({
      symbol,
      deals,
      fii: { m1: net("FII", 31), m3: net("FII", 92), all: net("FII", 130) },
      dii: { m1: net("DII", 31), m3: net("DII", 92), all: net("DII", 130) },
      coveredDays: new Set(all.map((x) => x.d)).size,
    });
  } catch {
    return Response.json({ symbol, deals: [], fii: {}, dii: {}, unavailable: true });
  }
}
