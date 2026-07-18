import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { getSessionCookies, nseApiFetchWithCookies } from "@/lib/nseSession";
import {
  computePeriodMetrics,
  buildRecentHistory,
  PERIOD_TRADING_DAYS,
  lookbackDaysFor,
  ACCUMULATION_WINDOW,
  ACCUMULATION_DELIVERY_THRESHOLD,
  ACCUMULATION_MIN_DAYS,
} from "@/lib/deliveryMetrics";
import { fetchWma30, fetchWma30Batch } from "@/lib/wma";

// See app/api/midcap-volume/route.js — freshness is controlled per-file
// inside lib/nseBhavcopy.js, so this route always runs fresh.
export const dynamic = "force-dynamic";

const DELIVERY_HISTORY_DAYS = 10; // trading days shown when a row/search result is expanded — always daily
const DELIVERY_PCT_MIN = 60; // % — sole criterion for the ranked list (market-cap bucketing removed)
const WMA_LOOKUP_CAP = 60; // Yahoo's chart endpoint tolerates more volume than NSE's session-based
// lookup, but there's no reason to fetch it for rows nobody will scroll to — same cap as market cap,
// and reusing the same capLookupTargets list means both batches cover the same top rows.
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
  const periodParam = searchParams.get("period");
  const period = PERIOD_TRADING_DAYS[periodParam] ? periodParam : "daily";
  const periodTradingDays = PERIOD_TRADING_DAYS[period];

  try {
    const lookback = lookbackDaysFor(period);
    // getRecentBhavcopies walks backward one weekday at a time and skips
    // holidays automatically, so it needs a generous calendar-day budget
    // to find `lookback` actual trading days — a plain 1:1 would come up
    // short once lookback gets into Monthly territory.
    const days = await getRecentBhavcopies(lookback, lookback * 2 + 20);
    if (days.length < periodTradingDays + 1) {
      return Response.json(
        { error: "Not enough trading-day data available from NSE yet for this period" },
        { status: 503 }
      );
    }
    const latest = days[days.length - 1];

    // Single-symbol lookup — used by the search box. Not restricted to
    // the delivery % threshold, since the point of search is to look up
    // whatever you ask for.
    if (searchSymbol) {
      const symbol = searchSymbol.trim().toUpperCase();
      const metrics = computePeriodMetrics(symbol, days, periodTradingDays);
      if (!metrics) {
        return Response.json({ error: `No delivery data found for ${symbol}` }, { status: 404 });
      }
      const isStock = metrics.category === "stock";
      const [marketCapCr, wma30] = await Promise.all([
        isStock ? fetchMarketCapCr(symbol, await getSessionCookies()) : Promise.resolve(null),
        isStock ? fetchWma30(symbol).catch(() => null) : Promise.resolve(null),
      ]);
      const deliveryHistory = buildRecentHistory(symbol, days, DELIVERY_HISTORY_DAYS);
      const { category, _volumeAboveAvg, ...rest } = metrics;
      return Response.json({
        asOf: latest.date,
        period,
        result: {
          ...rest,
          category,
          marketCapCr: marketCapCr != null ? Math.round(marketCapCr) : null,
          wma30: wma30 != null ? Math.round(wma30 * 100) / 100 : null,
          deliveryHistory,
        },
      });
    }

    // Ranked screens: every stock/ETF with delivery % above the threshold,
    // sorted by delivery % descending. No market-cap segregation anymore —
    // market cap is now just a displayed column (see loop below).
    const candidates = [];
    for (const symbol of latest.bySymbol.keys()) {
      const metrics = computePeriodMetrics(symbol, days, periodTradingDays);
      if (metrics && metrics.deliveryPct != null && metrics.deliveryPct > DELIVERY_PCT_MIN) {
        candidates.push(metrics);
      }
    }

    const other = candidates
      .filter((c) => c.category === "other")
      .sort((a, b) => (b.deliveryPct ?? 0) - (a.deliveryPct ?? 0))
      .map(({ category, _volumeAboveAvg, ...rest }) => ({
        ...rest,
        deliveryHistory: buildRecentHistory(rest.symbol, days, DELIVERY_HISTORY_DAYS),
      }));

    const stockCandidates = candidates
      .filter((c) => c.category === "stock")
      .sort((a, b) => (b.deliveryPct ?? 0) - (a.deliveryPct ?? 0));

    const capLookupTargets = stockCandidates.slice(0, MARKET_CAP_LOOKUP_CAP);
    const wmaLookupTargets = stockCandidates.slice(0, WMA_LOOKUP_CAP);

    // Fetch the NSE session cookie ONCE and reuse it across every
    // market-cap lookup in this batch, rather than redoing the homepage
    // handshake per symbol (which would be slow and more likely to get
    // the session flagged).
    const cookies = capLookupTargets.length > 0 ? await getSessionCookies() : "";

    const marketCapsPromise = (async () => {
      const marketCaps = [];
      for (let i = 0; i < capLookupTargets.length; i += CONCURRENCY) {
        const batch = capLookupTargets.slice(i, i + CONCURRENCY);
        const caps = await Promise.all(batch.map((c) => fetchMarketCapCr(c.symbol, cookies)));
        marketCaps.push(...caps);
      }
      return marketCaps;
    })();

    // Runs alongside the market-cap batch above rather than after it —
    // two independent rate-limited upstreams (NSE session vs Yahoo chart
    // API), no reason to serialize them.
    const wmaPromise = fetchWma30Batch(
      wmaLookupTargets.map((c) => c.symbol),
      { concurrency: CONCURRENCY }
    );

    const [marketCaps, wmaMap] = await Promise.all([marketCapsPromise, wmaPromise]);

    const stocks = stockCandidates.map((c, i) => {
      const capCr = i < marketCaps.length ? marketCaps[i] : null;
      const wma30 = wmaMap.get(c.symbol) ?? null;
      const { category, _volumeAboveAvg, ...rest } = c;
      return {
        ...rest,
        marketCapCr: capCr != null ? Math.round(capCr) : null,
        wma30: wma30 != null ? Math.round(wma30 * 100) / 100 : null,
        deliveryHistory: buildRecentHistory(c.symbol, days, DELIVERY_HISTORY_DAYS),
      };
    });

    return Response.json({
      asOf: latest.date,
      period,
      stocks,
      other,
      tradingDaysUsed: days.length,
      criteria: {
        deliveryPctMin: DELIVERY_PCT_MIN,
        marketCapLookupCap: MARKET_CAP_LOOKUP_CAP,
        wmaLookupCap: WMA_LOOKUP_CAP,
        deliveryHistoryDays: DELIVERY_HISTORY_DAYS,
        periodTradingDays,
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
