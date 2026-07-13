import { NSE_INDICES } from "@/lib/indices";

export const dynamic = "force-dynamic";

const YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function GET() {
  try {
    const symbols = NSE_INDICES.map((i) => i.symbol);
    const url = `${YAHOO_QUOTE_URL}?symbols=${encodeURIComponent(symbols.join(","))}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Upstream responded ${res.status}`);

    const data = await res.json();
    const rawResults = data?.quoteResponse?.result ?? [];

    const merged = NSE_INDICES.map(({ symbol, name }) => {
      const match = rawResults.find((r) => r.symbol === symbol) || {};
      return {
        symbol,
        name,
        price: match.regularMarketPrice ?? null,
        change: match.regularMarketChange ?? null,
        changePercent: match.regularMarketChangePercent ?? null,
        dayHigh: match.regularMarketDayHigh ?? null,
        dayLow: match.regularMarketDayLow ?? null,
        ok: Boolean(match.regularMarketPrice),
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
