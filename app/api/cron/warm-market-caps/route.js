import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { getMarketCapsCr } from "@/lib/marketCap";

// Part of the nightly precompute: fills Panel's market-cap cache for the
// most-traded stocks, so Sectors / Delivery / screeners have them without
// asking NSE while you browse. Values already known (your imported data or
// the 5-day cache) cost nothing; only the rest go to NSE.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TOP_N = 700;

export async function GET() {
  const days = await getRecentBhavcopies(1, 10);
  const latest = days[days.length - 1];
  if (!latest) return Response.json({ error: "No NSE data" }, { status: 503 });
  const symbols = [...latest.bySymbol.entries()]
    .filter(([, r]) => r.series === "EQ" && r.close && r.volume)
    .sort((a, b) => b[1].close * b[1].volume - a[1].close * a[1].volume)
    .slice(0, TOP_N)
    .map(([s]) => s);
  const caps = await getMarketCapsCr(symbols, { nseLimit: 250 });
  const known = [...caps.values()].filter((v) => v != null).length;
  return Response.json({ asOf: latest.date, requested: symbols.length, known });
}
