import { getRecentBhavcopies } from "@/lib/nseBhavcopy";

// See app/api/midcap-volume/route.js — freshness is controlled per-file
// inside lib/nseBhavcopy.js, so this route always runs fresh.
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const LOOKBACK_DAYS = 31; // 1 "today" + 30 trailing days for the volume average
const ACCUMULATION_WINDOW = 20; // trading days
const ACCUMULATION_DELIVERY_THRESHOLD = 50; // %
const ACCUMULATION_MIN_DAYS = 10; // out of the 20-day window
const MARKET_CAP_LOOKUP_CAP = 60; // don't fetch market cap for more candidates than this in the ranked lists
const CONCURRENCY = 20;
const MARKET_CAP_TIMEOUT_MS = 2500; // Yahoo's quoteSummary endpoint can occasionally stall rather than
// fail fast — without a hard timeout, a handful of stalled requests can blow past Vercel's function
// time limit and take the *entire* route down (which is what caused every bucket, and search, to
// come up empty). Aborting slow ones keeps the route reliable even when Yahoo is flaky.

// NSE's daily file has no instrument-type flag, so ETFs/REITs/InvITs are
// told apart from ordinary stocks by naming convention. This catches the
// large majority (most ETFs end in "BEES" or contain "ETF") but isn't
// guaranteed exhaustive — add to KNOWN_NON_STOCK_SYMBOLS if something
// specific slips through.
const ETF_PATTERNS = [/BEES$/i, /ETF/i];
const KNOWN_NON_STOCK_SYMBOLS = new Set([
  // REITs
  "EMBASSY", "MINDSPACE", "BIRET", "NXST",
  // InvITs
  "IRBINVIT", "INDIGRID", "PGINVIT", "ANZEN", "CUBEINVIT", "POWERGRIDINVIT",
  // Common ETFs that don't match the naming patterns above
  "GOLDSHARE", "MON100", "MOM100", "MOM50", "MOGSEC", "MASPTOP50", "MAFANG",
  "LICNETFN50", "SETFNIF50", "SETFNN50", "UTINIFTETF", "HDFCNIFTY",
  "HDFCSML250", "HDFCNEXT50", "HDFCGROWTH", "HDFCSENSEX", "GOLDIETF",
  "SILVERIETF", "AXISGOLD", "ABSLGOLD",
]);

function classify(symbol) {
  const s = symbol.toUpperCase();
  if (KNOWN_NON_STOCK_SYMBOLS.has(s)) return "other";
  if (ETF_PATTERNS.some((p) => p.test(s))) return "other";
  return "stock";
}

async function fetchMarketCapCr(symbol) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}.NS?modules=price`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MARKET_CAP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: controller.signal,
      next: { revalidate: 86400 }, // market cap barely moves day to day — cache generously
    });
    if (!res.ok) return null;
    const data = await res.json();
    const marketCap = data?.quoteSummary?.result?.[0]?.price?.marketCap?.raw;
    if (typeof marketCap !== "number") return null;
    return marketCap / 1e7; // rupees -> crore
  } catch {
    return null; // covers network errors AND the abort-on-timeout case
  } finally {
    clearTimeout(timeoutId);
  }
}

function bucketFor(marketCapCr) {
  if (marketCapCr < 1500) return "below1500";
  if (marketCapCr <= 10000) return "mid1500to10000";
  return "above10000";
}

// Core per-symbol computation, shared by both the ranked screens and the
// single-symbol search lookup below.
function computeMetrics(symbol, days) {
  const latest = days[days.length - 1];
  const history = days.slice(0, -1);
  const accumulationWindow = days.slice(-ACCUMULATION_WINDOW);

  const today = latest.bySymbol.get(symbol);
  if (!today || today.series !== "EQ" || !today.volume || today.deliveryPct == null) return null;

  const pastVolumes = history
    .map((d) => d.bySymbol.get(symbol)?.volume)
    .filter((v) => typeof v === "number" && v > 0);
  const avgVolume = pastVolumes.length > 0 ? pastVolumes.reduce((a, b) => a + b, 0) / pastVolumes.length : null;

  const changePercent =
    today.prevClose && today.close ? ((today.close - today.prevClose) / today.prevClose) * 100 : null;

  const windowRows = accumulationWindow.map((d) => d.bySymbol.get(symbol)?.deliveryPct ?? null);
  const daysAboveThreshold = windowRows.filter((v) => v != null && v > ACCUMULATION_DELIVERY_THRESHOLD).length;

  const oldestInWindow = accumulationWindow[0]?.bySymbol.get(symbol)?.close ?? null;
  const priceHeldOrRose = oldestInWindow != null ? today.close >= oldestInWindow : null;
  const volumeAboveAvg = avgVolume != null && avgVolume > 0 ? today.volume > avgVolume : false;

  const inAccumulation =
    daysAboveThreshold >= ACCUMULATION_MIN_DAYS && priceHeldOrRose === true && volumeAboveAvg;

  return {
    symbol,
    category: classify(symbol),
    close: today.close,
    changePercent,
    deliveryPct: today.deliveryPct,
    volumeRatio: avgVolume && avgVolume > 0 ? today.volume / avgVolume : null,
    daysOfAccumulation: daysAboveThreshold,
    accumulationWindowDays: windowRows.filter((v) => v != null).length,
    inAccumulation,
    _volumeAboveAvg: volumeAboveAvg,
  };
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
    // stocks that clear the volume filter, since the point of search is
    // to look up whatever you ask for.
    if (searchSymbol) {
      const symbol = searchSymbol.trim().toUpperCase();
      const metrics = computeMetrics(symbol, days);
      if (!metrics) {
        return Response.json({ error: `No delivery data found for ${symbol}` }, { status: 404 });
      }
      const marketCapCr = await fetchMarketCapCr(symbol);
      const { category, _volumeAboveAvg, ...rest } = metrics;
      return Response.json({
        asOf: latest.date,
        result: {
          ...rest,
          category,
          marketCapCr: marketCapCr != null ? Math.round(marketCapCr) : null,
          bucket: category === "stock" && marketCapCr != null ? bucketFor(marketCapCr) : null,
        },
      });
    }

    // Ranked screens (top movers by delivery %, filtered to volume above
    // the 30-day average).
    const candidates = [];
    for (const symbol of latest.bySymbol.keys()) {
      const metrics = computeMetrics(symbol, days);
      if (metrics && metrics._volumeAboveAvg) candidates.push(metrics);
    }

    const other = candidates
      .filter((c) => c.category === "other")
      .sort((a, b) => (b.deliveryPct ?? 0) - (a.deliveryPct ?? 0))
      .slice(0, 20)
      .map(({ category, _volumeAboveAvg, ...rest }) => rest);

    const stockCandidates = candidates
      .filter((c) => c.category === "stock")
      .sort((a, b) => (b.deliveryPct ?? 0) - (a.deliveryPct ?? 0))
      .slice(0, MARKET_CAP_LOOKUP_CAP);

    const marketCaps = [];
    for (let i = 0; i < stockCandidates.length; i += CONCURRENCY) {
      const batch = stockCandidates.slice(i, i + CONCURRENCY);
      const caps = await Promise.all(batch.map((c) => fetchMarketCapCr(c.symbol)));
      marketCaps.push(...caps);
    }

    const buckets = { below1500: [], mid1500to10000: [], above10000: [], unclassified: [] };

    stockCandidates.forEach((c, i) => {
      const capCr = marketCaps[i];
      const { category, _volumeAboveAvg, ...rest } = c;
      if (capCr == null) {
        buckets.unclassified.push({ ...rest, marketCapCr: null });
        return;
      }
      const bucket = bucketFor(capCr);
      buckets[bucket].push({ ...rest, marketCapCr: Math.round(capCr) });
    });

    for (const key of Object.keys(buckets)) {
      buckets[key] = buckets[key].slice(0, 30);
    }

    return Response.json({
      asOf: latest.date,
      stocks: buckets,
      other,
      tradingDaysUsed: days.length,
      criteria: {
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
