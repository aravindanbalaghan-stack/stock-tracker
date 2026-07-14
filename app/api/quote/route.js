// Server-side proxy for live quotes.
// Runs on the server (Vercel serverless function), so it can call Yahoo
// Finance directly without hitting browser CORS restrictions, and without
// exposing any key to the client.
//
// Symbols are plain NSE tickers, e.g. "RELIANCE", "TCS", "INFY".
// We append ".NS" for Yahoo's NSE namespace (use ".BO" for BSE if you
// prefer BSE pricing for a given symbol).
//
// NOTE: this uses Yahoo's "chart" endpoint rather than "v7/finance/quote".
// The quote endpoint started rejecting unauthenticated requests from cloud
// hosts (Vercel, AWS, etc.) with a 401 — the chart endpoint (same data
// Yahoo's own stock-price charts use) has proven more reliable for
// unauthenticated server-side calls.

export const dynamic = "force-dynamic"; // never cache — this is a live-data endpoint

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function toYahooSymbol(sym) {
  const s = sym.trim().toUpperCase();
  if (s.endsWith(".NS") || s.endsWith(".BO")) return s;
  return `${s}.NS`;
}

async function fetchChartQuote(yahooSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooSymbol
  )}?interval=1d&range=5d`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    // Only keep (timestamp, close) pairs where a close actually exists —
    // the most recent bar can be null intraday.
    const validCloses = timestamps.map((_, i) => closes[i]).filter((c) => c != null);

    const price = meta.regularMarketPrice ?? validCloses[validCloses.length - 1] ?? null;

    // IMPORTANT: don't trust meta.chartPreviousClose here — it's the close
    // from *before the requested range started*, not necessarily
    // yesterday's close (with range=5d it can be ~6 trading days back,
    // which silently inflates % change). Instead, take the second-to-last
    // close in the actual daily series returned, which is always the
    // prior trading day's close.
    let prevClose = null;
    if (validCloses.length >= 2) {
      prevClose = validCloses[validCloses.length - 2];
    } else {
      prevClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
    }

    return { meta, price, prevClose };
  } catch {
    return null;
  }
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
    const chartResults = await Promise.all(yahooSymbols.map(fetchChartQuote));

    const results = requested.map((originalSymbol, i) => {
      const chart = chartResults[i];
      const ySym = yahooSymbols[i];

      if (!chart || chart.price == null) {
        return {
          symbol: originalSymbol.toUpperCase(),
          name: originalSymbol,
          exchange: ySym.endsWith(".BO") ? "BSE" : "NSE",
          price: null,
          change: null,
          changePercent: null,
          previousClose: null,
          dayHigh: null,
          dayLow: null,
          volume: null,
          marketState: null,
          currency: "INR",
          updatedAt: new Date().toISOString(),
          ok: false,
        };
      }

      const { meta, price, prevClose } = chart;
      const change = price != null && prevClose != null ? price - prevClose : null;
      const changePercent = change != null && prevClose ? (change / prevClose) * 100 : null;

      return {
        symbol: originalSymbol.toUpperCase(),
        name: meta.longName || meta.shortName || originalSymbol,
        exchange: meta.fullExchangeName || (ySym.endsWith(".BO") ? "BSE" : "NSE"),
        price,
        change,
        changePercent,
        previousClose: prevClose,
        dayHigh: meta.regularMarketDayHigh ?? null,
        dayLow: meta.regularMarketDayLow ?? null,
        volume: meta.regularMarketVolume ?? null,
        marketState: meta.marketState ?? null,
        currency: meta.currency ?? "INR",
        updatedAt: meta.regularMarketTime
          ? new Date(meta.regularMarketTime * 1000).toISOString()
          : new Date().toISOString(),
        ok: true,
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
