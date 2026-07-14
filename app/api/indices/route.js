import { NSE_INDICES } from "@/lib/indices";

export const dynamic = "force-dynamic";

// See app/api/quote/route.js for why we use the chart endpoint instead of
// v7/finance/quote — the latter now rejects unauthenticated cloud requests.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchChartMeta(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=5d`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.chart?.result?.[0]?.meta ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const metas = await Promise.all(NSE_INDICES.map((i) => fetchChartMeta(i.symbol)));

    const merged = NSE_INDICES.map(({ symbol, name }, i) => {
      const meta = metas[i];
      if (!meta) {
        return { symbol, name, price: null, change: null, changePercent: null, dayHigh: null, dayLow: null, ok: false };
      }
      const price = meta.regularMarketPrice ?? null;
      const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
      const change = price != null && prevClose != null ? price - prevClose : null;
      const changePercent = change != null && prevClose ? (change / prevClose) * 100 : null;
      return {
        symbol,
        name,
        price,
        change,
        changePercent,
        dayHigh: meta.regularMarketDayHigh ?? null,
        dayLow: meta.regularMarketDayLow ?? null,
        ok: price != null,
      };
    });

    const ranked = merged
      .filter((m) => m.ok)
      .sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity));

    return Response.json({
      top5: ranked.slice(0, 5),
      all: merged,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to fetch index data", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
