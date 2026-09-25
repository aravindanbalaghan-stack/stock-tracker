import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { getSessionCookies } from "@/lib/nseSession";
import { fetchMarketCapCr } from "@/lib/marketCap";
import {
  computePeriodMetrics,
  buildRecentPeriodHistory,
  PERIOD_TRADING_DAYS,
  HISTORY_PERIODS,
  lookbackDaysFor,
  ACCUMULATION_WINDOW,
  ACCUMULATION_DELIVERY_THRESHOLD,
  ACCUMULATION_MIN_DAYS,
} from "@/lib/deliveryMetrics";
import { DELIVERY_BUCKETS, matchesBucket, APPEARANCE_WINDOW_TRADING_DAYS, computeThresholdAppearancesBatch, computeThresholdAppearances } from "@/lib/deliveryBuckets";
import { fetchWma30, fetchWma30Batch } from "@/lib/wma";
import { fetchDebut, fetchDebutBatch, withDebut } from "@/lib/debut";
import { getMembershipForSymbols } from "@/lib/screenerMembership";
import { recordAccumulationSnapshot } from "@/lib/accumulationHistory";
import { ensureScreenerFreshness } from "@/lib/screenerFreshness";
import { SCREEN_ORDER, SCREENS } from "@/lib/screens";

// See app/api/midcap-volume/route.js — freshness is controlled per-file
// inside lib/nseBhavcopy.js, so this route always runs fresh.
export const dynamic = "force-dynamic";
// How far back the "as of" picker may go, in trading days — about a
// calendar month, matching the Screener tabs.
const MAX_ASOF_TRADING_DAYS = 23;
// Monthly view's history drill-down needs ~215 trading days of bhavcopy on
// a cold cache (see lookbackDaysFor) — that's a lot of individual NSE
// fetches the first time anyone loads Monthly. Bump the function timeout
// so that doesn't get killed mid-fetch; subsequent loads are fast since
// each day's file is cached (see lib/nseBhavcopy.js). If your Vercel plan
// caps below 60s, lower this and consider trimming HISTORY_PERIODS in
// lib/deliveryMetrics.js instead.
export const maxDuration = 60;

const WMA_LOOKUP_CAP = 60; // Yahoo's chart endpoint tolerates more volume than NSE's session-based
// lookup, but there's no reason to fetch it for rows nobody will scroll to — same cap as market cap,
// and reusing the same capLookupTargets list means both batches cover the same top rows.
const MARKET_CAP_LOOKUP_CAP = 60; // NSE's session-based lookup is comparatively expensive/rate-limited,
// so market cap is only fetched for the top N by delivery % even though the list itself is unbounded.
// Rows beyond the cap still show — just with marketCapCr: null ("—" in the UI) — same graceful-degrade
// behavior as when NSE fails a specific lookup.
const CONCURRENCY = 10; // NSE's bot protection blocks cloud IPs more aggressively than Yahoo did —
// kept lower than the old Yahoo concurrency (20) to go easier on the session.

// Attaches "is this in any Screener tab right now, and since when" to a
// delivery row. Screener membership is tracked separately (see
// lib/screenerMembership.js) because computing it here would mean
// re-running every screen across the whole universe just to render this
// tab — the membership store makes it a handful of cheap key lookups
// instead. Fails soft: if KV isn't reachable, rows just don't get the
// fields rather than the whole tab breaking.
async function withScreenerMembership(rows) {
  const membership = await getMembershipForSymbols(
    rows.map((r) => r.symbol),
    SCREEN_ORDER
  );
  if (!membership) return rows;
  return rows.map((r) => {
    const m = membership[r.symbol];
    return {
      ...r,
      screenerScreens: m?.screens?.map((id) => SCREENS[id]?.label ?? id) ?? [],
      screenerFirstAdded: m?.firstAdded ?? null,
    };
  });
}

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const searchSymbol = searchParams.get("symbol");
  const periodParam = searchParams.get("period");
  const dateParam = searchParams.get("date");
  const bucketParam = searchParams.get("bucket");
  const bucket = DELIVERY_BUCKETS.some((b) => b.id === bucketParam) ? bucketParam : "60";
  const period = PERIOD_TRADING_DAYS[periodParam] ? periodParam : "daily";
  const periodTradingDays = PERIOD_TRADING_DAYS[period];

  try {
    // "As of" support: only a plain YYYY-MM-DD is accepted, never a future
    // date. The window is fetched wider and sliced, rather than teaching
    // getRecentBhavcopies to start from an arbitrary day — the per-date
    // files are cached for a week, so a historical run largely reuses what
    // a previous run already pulled.
    const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    let asOfDate = null;
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      asOfDate = dateParam > todayIST ? todayIST : dateParam;
    }

    // Wide enough for whichever is bigger: the period's own lookback, or
    // the 2-month window the threshold-appearance history (see
    // lib/deliveryBuckets.js) needs — bhavcopy day-files are cached
    // individually, so asking for the wider of the two costs nothing
    // extra once both are warm.
    const lookback =
      Math.max(lookbackDaysFor(period), APPEARANCE_WINDOW_TRADING_DAYS) + (asOfDate ? MAX_ASOF_TRADING_DAYS : 0);
    // getRecentBhavcopies walks backward one weekday at a time and skips
    // holidays automatically, so it needs a generous calendar-day budget
    // to find `lookback` actual trading days — a plain 1:1 would come up
    // short once lookback gets into Monthly territory.
    const allDays = await getRecentBhavcopies(lookback, lookback * 2 + 20);
    let days = allDays;
    if (asOfDate) {
      days = allDays.filter((d) => d.date <= asOfDate);
      if (days.length < periodTradingDays + 1) {
        return Response.json(
          { error: `Not enough trading-day data at or before ${asOfDate}. Pick a more recent date.` },
          { status: 503 }
        );
      }
      days = days.slice(-Math.max(lookbackDaysFor(period), APPEARANCE_WINDOW_TRADING_DAYS));
    }
    if (days.length < periodTradingDays + 1) {
      return Response.json(
        { error: "Not enough trading-day data available from NSE yet for this period" },
        { status: 503 }
      );
    }
    const latest = days[days.length - 1];
    // The trailing ~2-month slice used for threshold-appearance counts —
    // always the most recent APPEARANCE_WINDOW_TRADING_DAYS of `days`,
    // independent of the period/bucket selected above.
    const appearanceWindow = days.slice(-APPEARANCE_WINDOW_TRADING_DAYS);

    // Single-symbol lookup — used by the search box. Not restricted to
    // the delivery % bucket, since the point of search is to look up
    // whatever you ask for.
    if (searchSymbol) {
      const symbol = searchSymbol.trim().toUpperCase();
      const metrics = computePeriodMetrics(symbol, days, periodTradingDays);
      if (!metrics) {
        return Response.json({ error: `No delivery data found for ${symbol}` }, { status: 404 });
      }
      const isStock = metrics.category === "stock";
      const [marketCapCr, wma30, debut] = await Promise.all([
        isStock ? fetchMarketCapCr(symbol, await getSessionCookies()) : Promise.resolve(null),
        isStock ? fetchWma30(symbol).catch(() => null) : Promise.resolve(null),
        fetchDebut(symbol).catch(() => null),
      ]);
      const deliveryHistory = buildRecentPeriodHistory(symbol, days, periodTradingDays, HISTORY_PERIODS);
      const { category, _volumeAboveAvg, ...rest } = metrics;
      const [enriched] = isStock ? await withScreenerMembership([rest]) : [rest];
      return Response.json({
        asOf: latest.date,
      // First session actually included, so the UI can state the exact
      // range rather than inferring it from a trading-day count.
      windowFirstDate: days[Math.max(0, days.length - periodTradingDays)]?.date ?? null,
      requestedDate: asOfDate,
      dateAdjusted: !!asOfDate && asOfDate !== latest.date,
        period,
        result: withDebut(
          {
            ...enriched,
            category,
            marketCapCr: marketCapCr != null ? Math.round(marketCapCr) : null,
            wma30: wma30 != null ? Math.round(wma30 * 100) / 100 : null,
            deliveryHistory,
            thresholdAppearances: isStock ? computeThresholdAppearances(symbol, appearanceWindow) : null,
          },
          debut
        ),
      });
    }

    // Ranked screens: every stock/ETF whose delivery % falls in the
    // selected bucket, sorted by delivery % descending. No market-cap
    // segregation anymore — market cap is now just a displayed column
    // (see loop below).
    const candidates = [];
    // Accumulation first-seen bookkeeping (see lib/accumulationHistory.js)
    // rides along on this same full-universe loop — computePeriodMetrics
    // is already being called for every symbol here regardless of the
    // delivery-% bucket below, so recording which ones currently read
    // inAccumulation === true costs nothing extra. Only recorded for a
    // real "today, daily period" run — never for a historical `date=`
    // lookup or a non-daily period, so browsing old dates or switching to
    // Weekly/Monthly can't record a false "first seen" date.
    const inAccumulationToday = [];
    const isRealtimeDaily = period === "daily" && !asOfDate;
    for (const symbol of latest.bySymbol.keys()) {
      const metrics = computePeriodMetrics(symbol, days, periodTradingDays);
      if (metrics && matchesBucket(metrics.deliveryPct, bucket)) {
        candidates.push(metrics);
      }
      if (isRealtimeDaily && metrics?.inAccumulation) inAccumulationToday.push(symbol);
    }
    if (isRealtimeDaily && inAccumulationToday.length) {
      recordAccumulationSnapshot(latest.date, inAccumulationToday).catch(() => {});
    }

    const other = candidates
      .filter((c) => c.category === "other")
      .sort((a, b) => (b.deliveryPct ?? 0) - (a.deliveryPct ?? 0))
      .map(({ category, _volumeAboveAvg, ...rest }) => ({
        ...rest,
        deliveryHistory: buildRecentPeriodHistory(rest.symbol, days, periodTradingDays, HISTORY_PERIODS),
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

    // Listing debut for the same capped set of top rows. Runs alongside
    // the other two lookups — a debut price is cached for 30 days, so
    // this is effectively free after the first load.
    const debutPromise = fetchDebutBatch(
      wmaLookupTargets.map((c) => c.symbol),
      { concurrency: CONCURRENCY }
    );

    // Screener-membership freshness (see lib/screenerFreshness.js) —
    // only pursued for a real "today" run, same guard as the
    // accumulation bookkeeping above: browsing a historical date or a
    // non-daily period shouldn't kick off a same-day screener recompute.
    // Runs alongside the other three lookups rather than blocking them.
    const freshnessPromise = isRealtimeDaily
      ? ensureScreenerFreshness(origin, latest.date).catch(() => null)
      : Promise.resolve(null);

    const [marketCaps, wmaMap, debutMap, freshness] = await Promise.all([
      marketCapsPromise,
      wmaPromise,
      debutPromise,
      freshnessPromise,
    ]);

    // Threshold-appearance history (see lib/deliveryBuckets.js) — how
    // many of the last ~2 months' trading days each stock cleared each
    // bucket. Computed for every stock candidate, not just the capped
    // lookup targets above — it's pure bhavcopy math, no external calls,
    // so there's no cost reason to cap it the way market cap/WMA are.
    const appearancesBySymbol = computeThresholdAppearancesBatch(
      stockCandidates.map((c) => c.symbol),
      appearanceWindow
    );

    const stocks = await withScreenerMembership(
      stockCandidates.map((c, i) => {
        const capCr = i < marketCaps.length ? marketCaps[i] : null;
        const wma30 = wmaMap.get(c.symbol) ?? null;
        const { category, _volumeAboveAvg, ...rest } = c;
        return withDebut(
          {
            ...rest,
            marketCapCr: capCr != null ? Math.round(capCr) : null,
            wma30: wma30 != null ? Math.round(wma30 * 100) / 100 : null,
            deliveryHistory: buildRecentPeriodHistory(c.symbol, days, periodTradingDays, HISTORY_PERIODS),
            thresholdAppearances: appearancesBySymbol[c.symbol] ?? null,
          },
          debutMap.get(c.symbol)
        );
      })
    );

    return Response.json({
      asOf: latest.date,
      // First session actually included, so the UI can state the exact
      // range rather than inferring it from a trading-day count.
      windowFirstDate: days[Math.max(0, days.length - periodTradingDays)]?.date ?? null,
      requestedDate: asOfDate,
      dateAdjusted: !!asOfDate && asOfDate !== latest.date,
      period,
      bucket,
      stocks,
      other,
      tradingDaysUsed: days.length,
      // Which screens' membership data is/isn't from today — see
      // lib/screenerFreshness.js. Null when this wasn't a real-time daily
      // run (historical date, or Weekly/Monthly selected), since
      // freshness isn't pursued in that case.
      screenerFreshness: freshness,
      criteria: {
        marketCapLookupCap: MARKET_CAP_LOOKUP_CAP,
        wmaLookupCap: WMA_LOOKUP_CAP,
        historyPeriods: HISTORY_PERIODS,
        periodTradingDays,
        accumulationWindow: ACCUMULATION_WINDOW,
        accumulationDeliveryThreshold: ACCUMULATION_DELIVERY_THRESHOLD,
        accumulationMinDays: ACCUMULATION_MIN_DAYS,
        appearanceWindowTradingDays: APPEARANCE_WINDOW_TRADING_DAYS,
      },
    });
  } catch (err) {
    console.error("delivery: failed to compute delivery screen:", err?.message || err);
    return Response.json(
      { error: "Failed to compute delivery screen", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
