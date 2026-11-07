import { getMarketCapsCr } from "@/lib/marketCap";

export const dynamic = "force-dynamic";

// NSE's quote-equity endpoint (see lib/marketCap.js) is comparatively
// expensive and rate-limited compared to the Yahoo-backed routes — the
// same reason app/api/delivery/route.js and app/api/screeners/route.js
// only ever look it up for a capped top-N, not their whole universe. The
// Sectors tab is expected to call this with a filtered (usually single-
// sector) symbol list, which naturally stays well under this cap; a
// request for more than this many symbols is truncated rather than
// risking the request timing out or the NSE session getting flagged.
const MAX_SYMBOLS = 150;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get("symbols");
  if (!symbolsParam) return Response.json({ error: "Missing ?symbols=SYM1,SYM2" }, { status: 400 });

  const symbols = [...new Set(symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 2000);
  if (symbols.length === 0) return Response.json({ results: {} });

  try {
    // Imported and cached values come back for every symbol; only up to
    // MAX_SYMBOLS still-unknown ones are asked of NSE live.
    const capMap = await getMarketCapsCr(symbols, { nseLimit: MAX_SYMBOLS });
    const results = {};
    for (const symbol of symbols) {
      const cap = capMap.get(symbol);
      results[symbol] = cap != null ? Math.round(cap) : null;
    }
    return Response.json({ results, cap: MAX_SYMBOLS });
  } catch (err) {
    console.error("market-cap: failed to fetch market caps:", err?.message || err);
    return Response.json(
      { error: "Failed to fetch market cap", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
