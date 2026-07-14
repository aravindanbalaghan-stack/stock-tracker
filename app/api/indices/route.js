import { NSE_INDICES } from "@/lib/indices";

export const dynamic = "force-dynamic";

// See app/api/quote/route.js for why we use the chart endpoint, and why we
// compute prevClose from the daily series instead of trusting
// meta.chartPreviousClose (it's range-relative, not "yesterday").
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function fetchChartQuote(symbol) {
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
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const validCloses = timestamps.map((_, i) => closes[i]).filter((c) => c != null);

    const price = meta.regularMarketPrice ?? validCloses[validCloses.length - 1] ?? null;
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

export async function GET() {
  try {
    const charts = await Promise.all(NSE_INDICES.map((i) => fetchChartQuote(i.symbol)));

    const merged = NSE_INDICES.map(({ symbol, name }, i) => {
      const chart = charts[i];
      if (!chart || chart.price == null) {
        return { symbol, name, price: null, change: null, changePercent: null, dayHigh: null, dayLow: null, ok: false };
      }
      const { meta, price, prevClose } = chart;
      const change = prevClose != null ? price - prevClose : null;
      const changePercent = change != null && prevClose ? (change / prevClose) * 100 : null;
      return {
        symbol,
        name,
        price,
        change,
        changePercent,
        dayHigh: meta.regularMarketDayHigh ?? null,
        dayLow: meta.regularMarketDayLow ?? null,
        ok: true,
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
