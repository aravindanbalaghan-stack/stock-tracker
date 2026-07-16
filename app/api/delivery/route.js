import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { getSessionCookies, nseApiFetchWithCookies } from "@/lib/nseSession";
import {
  computeMetrics,
  ACCUMULATION_WINDOW,
  ACCUMULATION_DELIVERY_THRESHOLD,
  ACCUMULATION_MIN_DAYS,
} from "@/lib/deliveryMetrics";

// See app/api/midcap-volume/route.js — freshness is controlled per-file
// inside lib/nseBhavcopy.js, so this route always runs fresh.
export const dynamic = "force-dynamic";

const LOOKBACK_DAYS = 31; // 1 "today" + 30 trailing days for the volume average
const DELIVERY_PCT_MIN = 60; // % — sole criterion for the ranked list (market-cap bucketing removed)
const MARKET_CAP_LOOKUP_CAP = 60; // NSE's session-based lookup is comparatively expensive/rate-limited,
// so market cap is only fetched for the top N by delivery % even though the list itself is unbounded.
// Rows beyond the cap still show — just with marketCapCr: null ("—" in the UI) — same graceful-degrade
// behavior as when NSE fails a specific lookup.
const CONCURRENCY = 10; // NSE's bot protection blocks cloud IPs more aggressively than Yahoo did —
// kept lower than the old Yahoo concurrency (20) to go easier on the session.
const MARKET_CAP_TIMEOUT_MS = 4000; // NSE can occasionally stall rather than fail fast — without a hard
// timeout, a handful of stalled requests can blow past Vercel's function time limit and take the
// *entire* route down. Aborting slow ones keeps the route reliable even when NSE is flaky.

// Market cap comes from NSE's own quote-equity endpoint (via the
// cookie-session helper also used by the Research tab) rather than
// Yahoo's quoteSummary endpoint. Yahoo's quoteSummary is the same family
// of endpoint that app/api/quote/route.js documents as rejecting
// unauthenticated cloud-host requests with a 401. NSE returns
// totalMarketCap already in crores, so no unit conversion is needed.
async function fetchMarketCapCr(symbol, cookies) {
  const data = await nseApiFetchWithCookies(
    `/api/quote-equity?symbol=${encodeURIComponent(symbol)}&section=trade_info`,
    cookies,
    MARKET_CAP_TIMEOUT_MS
  );
  if (!data) return null;

  const direct = data?.marketDeptOrderBook?.tradeInfo?.totalMarketCap;
  if (typeof direct === "number") return direct;

  // Fallback: derive from shares issued x last price if NSE's direct
  // field isn't present for this symbol.
  const issuedSize = data?.securityInfo?.issuedSize;
  const lastPrice = data?.priceInfo?.lastPrice;
  if (typeof issuedSize === "number" && typeof lastPrice === "number") {
    return (issuedSize * lastPrice) / 1e7; // rupees -> crore
  }
  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const searchSymbol = searchParams.get("symbol");

  try {
    const days = await getRecentBhavcopies(LOOKBACK_DAYS);
    if (days.length < 2) {
      return Response.json(
        { error: "Not enough trading-day data available from NSE yet" },
        { status: 503 }
      );
    }
    const latest = days[days.length - 1];

    // Single-symbol lookup — used by the search box. Not restricted to
    // the delivery % threshold, since the point of search is to look up
    // whatever you ask for.
    if (searchSymbol) {
      const symbol = searchSymbol.trim().toUpperCase();
      const metrics = computeMetrics(symbol, days);
      if (!metrics) {
        return Response.json({ error: `No delivery data found for ${symbol}` }, { status: 404 });
      }
      const marketCapCr =
        metrics.category === "stock" ? await fetchMarketCapCr(symbol, await getSessionCookies()) : null;
      const { category, _volumeAboveAvg, ...rest } = metrics;
      return Response.json({
        asOf: latest.date,
        result: {
          ...rest,
          category,
          marketCapCr: marketCapCr != null ? Math.round(marketCapCr) : null,
        },
      });
    }

    // Ranked screens: every stock/ETF with delivery % above the threshold,
    // sorted by delivery % descending. No market-cap segregation anymore —
    // market cap is now just a displayed column (see loop below).
    const candidates = [];
    for (const symbol of latest.bySymbol.keys()) {
      const metrics = computeMetrics(symbol, days);
      if (metrics && metrics.deliveryPct != null && metrics.deliveryPct > DELIVERY_PCT_MIN) {
        candidates.push(metrics);
      }
    }

    const other = candidates
      .filter((c) => c.category === "other")
      .sort((a, b) => (b.deliveryPct ?? 0) - (a.deliveryPct ?? 0))
      .map(({ category, _volumeAboveAvg, ...rest }) => rest);

    const stockCandidates = candidates
      .filter((c) => c.category === "stock")
      .sort((a, b) => (b.deliveryPct ?? 0) - (a.deliveryPct ?? 0));

    const capLookupTargets = stockCandidates.slice(0, MARKET_CAP_LOOKUP_CAP);

    // Fetch the NSE session cookie ONCE and reuse it across every
    // market-cap lookup in this batch, rather than redoing the homepage
    // handshake per symbol (which would be slow and more likely to get
    // the session flagged).
    const cookies = capLookupTargets.length > 0 ? await getSessionCookies() : "";

    const marketCaps = [];
    for (let i = 0; i < capLookupTargets.length; i += CONCURRENCY) {
      const batch = capLookupTargets.slice(i, i + CONCURRENCY);
      const caps = await Promise.all(batch.map((c) => fetchMarketCapCr(c.symbol, cookies)));
      marketCaps.push(...caps);
    }

    const stocks = stockCandidates.map((c, i) => {
      const capCr = i < marketCaps.length ? marketCaps[i] : null;
      const { category, _volumeAboveAvg, ...rest } = c;
      return { ...rest, marketCapCr: capCr != null ? Math.round(capCr) : null };
    });

    return Response.json({
      asOf: latest.date,
      stocks,
      other,
      tradingDaysUsed: days.length,
      criteria: {
        deliveryPctMin: DELIVERY_PCT_MIN,
        marketCapLookupCap: MARKET_CAP_LOOKUP_CAP,
        accumulationWindow: ACCUMULATION_WINDOW,
        accumulationDeliveryThreshold: ACCUMULATION_DELIVERY_THRESHOLD,
        accumulationMinDays: ACCUMULATION_MIN_DAYS,
      },
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to compute delivery screen", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
