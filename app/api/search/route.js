// Server-side proxy for symbol search (autocomplete when adding a stock).

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
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`Upstream responded ${res.status}`);

    const data = await res.json();
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
    return Response.json(
      { error: "Search failed", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
