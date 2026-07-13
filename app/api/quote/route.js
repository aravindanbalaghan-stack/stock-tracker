// Server-side proxy for live quotes.
// Runs on the server (Vercel serverless function), so it can call Yahoo
// Finance directly without hitting browser CORS restrictions, and without
// exposing any key to the client.
//
// Symbols are plain NSE tickers, e.g. "RELIANCE", "TCS", "INFY".
// We append ".NS" for Yahoo's NSE namespace (use ".BO" for BSE if you
// prefer BSE pricing for a given symbol).

export const dynamic = "force-dynamic"; // never cache — this is a live-data endpoint

const YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";

function toYahooSymbol(sym) {
  const s = sym.trim().toUpperCase();
  if (s.endsWith(".NS") || s.endsWith(".BO")) return s;
  return `${s}.NS`;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get("symbols");

  if (!symbolsParam) {
    return Response.json({ error: "Missing ?symbols=SYM1,SYM2" }, { status: 400 });
  }

  const requested = symbolsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const yahooSymbols = requested.map(toYahooSymbol);

  try {
    const url = `${YAHOO_QUOTE_URL}?symbols=${encodeURIComponent(yahooSymbols.join(","))}`;
    const res = await fetch(url, {
      headers: {
        // Yahoo's endpoint blocks requests with no browser-like UA.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Upstream responded ${res.status}`);
    }

    const data = await res.json();
    const rawResults = data?.quoteResponse?.result ?? [];

    const results = requested.map((originalSymbol, i) => {
      const ySym = yahooSymbols[i];
      const match = rawResults.find((r) => r.symbol === ySym) || {};

      return {
        symbol: originalSymbol.toUpperCase(),
        name: match.shortName || match.longName || originalSymbol,
        exchange: match.fullExchangeName || (ySym.endsWith(".BO") ? "BSE" : "NSE"),
        price: match.regularMarketPrice ?? null,
        change: match.regularMarketChange ?? null,
        changePercent: match.regularMarketChangePercent ?? null,
        previousClose: match.regularMarketPreviousClose ?? null,
        dayHigh: match.regularMarketDayHigh ?? null,
        dayLow: match.regularMarketDayLow ?? null,
        volume: match.regularMarketVolume ?? null,
        marketState: match.marketState ?? null,
        currency: match.currency ?? "INR",
        updatedAt: match.regularMarketTime
          ? new Date(match.regularMarketTime * 1000).toISOString()
          : new Date().toISOString(),
        ok: Boolean(match.regularMarketPrice),
      };
    });

    return Response.json({ results, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return Response.json(
      { error: "Failed to fetch live quotes", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
