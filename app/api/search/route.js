// Server-side proxy for symbol search (autocomplete when adding a stock).
import { fetchYahooJson } from "@/lib/yahooFinance";

export const dynamic = "force-dynamic";

const YAHOO_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");

  if (!q || q.trim().length < 1) {
    return Response.json({ results: [] });
  }

  try {
    const url = `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`;
    const data = await fetchYahooJson(url);
    if (!data) throw new Error("Upstream search request failed");

    const quotes = data?.quotes ?? [];

    const results = quotes
      .filter((q) => q.symbol && (q.symbol.endsWith(".NS") || q.symbol.endsWith(".BO")))
      .map((q) => ({
        symbol: q.symbol.replace(/\.(NS|BO)$/, ""),
        exchange: q.symbol.endsWith(".BO") ? "BSE" : "NSE",
        name: q.shortname || q.longname || q.symbol,
      }));

    return Response.json({ results });
  } catch (err) {
    console.error("search: Yahoo search failed:", err?.message || err);
    return Response.json(
      { error: "Search failed", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
