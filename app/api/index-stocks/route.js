import { INDEX_CONSTITUENTS } from "@/lib/indexConstituents";
import { fetchChartQuote } from "@/app/api/indices/route";

export const dynamic = "force-dynamic";

function toYahooSymbol(sym) {
  return `${sym.trim().toUpperCase()}.NS`;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const index = searchParams.get("index");

  const constituents = INDEX_CONSTITUENTS[index];
  if (!constituents) {
    return Response.json({ error: "No constituent list available for this index" }, { status: 404 });
  }

  try {
    const charts = await Promise.all(
      constituents.map((sym) => fetchChartQuote(toYahooSymbol(sym)))
    );

    const rows = constituents
      .map((symbol, i) => {
        const chart = charts[i];
        if (!chart || chart.price == null || chart.prevClose == null) return null;
        const change = chart.price - chart.prevClose;
        const changePercent = chart.prevClose ? (change / chart.prevClose) * 100 : null;
        return { symbol, price: chart.price, change, changePercent };
      })
      .filter(Boolean);

    rows.sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity));

    return Response.json({ index, top5: rows.slice(0, 5) });
  } catch (err) {
    return Response.json(
      { error: "Failed to fetch index constituents", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
