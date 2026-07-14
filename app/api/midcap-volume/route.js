import { MIDCAP_UNIVERSE } from "@/lib/midcapUniverse";

// Live route — no bhavcopy involved. Price and volume are both things
// Yahoo reports intraday (same source the Watchlist tab uses), so unlike
// Delivery Leaders, this screen has no reason to be stuck on once-a-day
// data. It re-scans the whole midcap universe on every request.
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CONCURRENCY = 15;
const AVG_VOLUME_WINDOW = 30; // trading days

async function fetchQuoteAndHistory(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS?interval=1d&range=2mo`;
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
    const volumes = result.indicators?.quote?.[0]?.volume || [];

    const bars = timestamps
      .map((_, i) => ({ c: closes[i], v: volumes[i] }))
      .filter((b) => b.c != null);

    if (bars.length < 6) return null;

    // Today's bar (if the market is open, this is still filling up) is
    // excluded from the historical average — we compare *today's live*
    // volume against the trailing history, not against itself.
    const historical = bars.slice(0, -1).slice(-AVG_VOLUME_WINDOW);
    const historicalVolumes = historical.map((b) => b.v).filter((v) => typeof v === "number" && v > 0);
    if (historicalVolumes.length < 5) return null;

    const avgVolume = historicalVolumes.reduce((a, b) => a + b, 0) / historicalVolumes.length;

    const price = meta.regularMarketPrice ?? bars[bars.length - 1].c ?? null;
    const prevCloseBar = bars[bars.length - 2]?.c;
    const prevClose = prevCloseBar ?? meta.previousClose ?? meta.chartPreviousClose ?? null;
    const liveVolume = meta.regularMarketVolume ?? bars[bars.length - 1].v ?? null;

    if (price == null || liveVolume == null) return null;

    const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : null;

    return {
      symbol,
      close: price,
      changePercent,
      volume: liveVolume,
      avgVolume30d: Math.round(avgVolume),
      volumeRatio: avgVolume > 0 ? liveVolume / avgVolume : null,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const rows = [];
    for (let i = 0; i < MIDCAP_UNIVERSE.length; i += CONCURRENCY) {
      const batch = MIDCAP_UNIVERSE.slice(i, i + CONCURRENCY);
      const fetched = await Promise.all(batch.map(fetchQuoteAndHistory));
      for (const r of fetched) {
        if (r && r.volumeRatio != null && r.volumeRatio > 1) rows.push(r);
      }
    }

    rows.sort((a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0));

    return Response.json({
      fetchedAt: new Date().toISOString(),
      results: rows.slice(0, 20),
      universeSize: MIDCAP_UNIVERSE.length,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to compute midcap volume screen", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
