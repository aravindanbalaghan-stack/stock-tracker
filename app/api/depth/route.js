import { getSessionCookies, nseApiFetchWithCookies } from "@/lib/nseSession";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const DEPTH_TIMEOUT_MS = 5000;
const PROFILE_BUCKETS = 24;
const VALUE_AREA_SHARE = 0.7; // Market-profile convention: the 70% volume band

/**
 * Live order book — the actual resting buy and sell quantities at each
 * price. This is REAL exchange data, but note what it is and isn't:
 *   * It's a snapshot of resting limit orders right now, so it's only
 *     meaningful while the market is open. After close it reflects the
 *     final state, not the day's activity.
 *   * NSE publishes 5 levels each side, not the full book.
 *   * NSE blocks datacentre IPs frequently, so this can be unavailable
 *     even when everything else in the app works.
 */
async function fetchOrderBook(symbol) {
  const cookies = await getSessionCookies();
  const data = await nseApiFetchWithCookies(
    `/api/quote-equity?symbol=${encodeURIComponent(symbol)}&section=trade_info`,
    cookies,
    DEPTH_TIMEOUT_MS
  );
  const book = data?.marketDeptOrderBook;
  if (!book) return null;

  const clean = (arr) =>
    (arr || [])
      .filter((r) => Number(r?.price) > 0 && Number(r?.quantity) > 0)
      .map((r) => ({ price: Number(r.price), quantity: Number(r.quantity) }));

  const bids = clean(book.bid);
  const asks = clean(book.ask);
  if (bids.length === 0 && asks.length === 0) return null;

  return {
    bids,
    asks,
    totalBuyQuantity: Number(book.totalBuyQuantity) || null,
    totalSellQuantity: Number(book.totalSellQuantity) || null,
  };
}

/** 5-minute intraday bars, used to build the volume-at-price profile. */
async function fetchIntraday(symbol, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=5m&range=${range}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.chart?.result?.[0];
    if (!r) return null;
    const q = r.indicators?.quote?.[0] || {};
    return (r.timestamp || [])
      .map((t, i) => ({ t, h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i] ?? 0 }))
      .filter((b) => b.h != null && b.l != null && b.c != null && b.v > 0);
  } catch {
    return null;
  }
}

/**
 * Volume-at-price profile.
 *
 * Each 5-minute bar's volume is spread evenly across the price buckets its
 * high-low range covers. That's the standard way to build a volume profile
 * when you don't have tick data — it's an approximation of the true
 * distribution, not a measurement of it, because the exact price of each
 * individual trade inside the bar isn't published.
 *
 * The buy/sell split is a WEAKER estimate again, and is labelled as such in
 * the UI. It uses each bar's close position within its own range: a bar
 * closing near its high is treated as buyer-dominated, near its low as
 * seller-dominated. Genuinely separating buyer- from seller-initiated
 * volume requires tick-by-tick trades tagged against the bid/ask at the
 * time, which no free NSE/Yahoo feed provides — it needs a paid tick
 * source such as a broker data API. Treat these two numbers as a lean, not
 * as counted buyers and sellers.
 */
function buildVolumeProfile(bars) {
  if (!bars || bars.length === 0) return null;

  const lo = Math.min(...bars.map((b) => b.l));
  const hi = Math.max(...bars.map((b) => b.h));
  if (!(hi > lo)) return null;

  const step = (hi - lo) / PROFILE_BUCKETS;
  const buckets = Array.from({ length: PROFILE_BUCKETS }, (_, i) => ({
    priceLow: lo + i * step,
    priceHigh: lo + (i + 1) * step,
    volume: 0,
    buyEstimate: 0,
    sellEstimate: 0,
  }));

  for (const bar of bars) {
    const range = bar.h - bar.l;
    // Close position within the bar's own range -> crude buy/sell lean.
    const closePos = range > 0 ? (bar.c - bar.l) / range : 0.5;
    const buyShare = closePos;

    const first = Math.max(0, Math.min(PROFILE_BUCKETS - 1, Math.floor((bar.l - lo) / step)));
    const last = Math.max(0, Math.min(PROFILE_BUCKETS - 1, Math.floor((bar.h - lo) / step)));
    const span = last - first + 1;
    const per = bar.v / span;

    for (let i = first; i <= last; i++) {
      buckets[i].volume += per;
      buckets[i].buyEstimate += per * buyShare;
      buckets[i].sellEstimate += per * (1 - buyShare);
    }
  }

  const totalVolume = buckets.reduce((a, b) => a + b.volume, 0);
  if (totalVolume <= 0) return null;

  // Point of control: the price bucket that traded the most.
  let pocIdx = 0;
  buckets.forEach((b, i) => {
    if (b.volume > buckets[pocIdx].volume) pocIdx = i;
  });

  // Value area: grow outward from the POC until 70% of volume is enclosed.
  let lowIdx = pocIdx;
  let highIdx = pocIdx;
  let covered = buckets[pocIdx].volume;
  while (covered / totalVolume < VALUE_AREA_SHARE && (lowIdx > 0 || highIdx < PROFILE_BUCKETS - 1)) {
    const below = lowIdx > 0 ? buckets[lowIdx - 1].volume : -1;
    const above = highIdx < PROFILE_BUCKETS - 1 ? buckets[highIdx + 1].volume : -1;
    if (above >= below) {
      highIdx++;
      covered += buckets[highIdx].volume;
    } else {
      lowIdx--;
      covered += buckets[lowIdx].volume;
    }
  }

  const rounded = buckets.map((b) => ({
    priceLow: Math.round(b.priceLow * 100) / 100,
    priceHigh: Math.round(b.priceHigh * 100) / 100,
    volume: Math.round(b.volume),
    buyEstimate: Math.round(b.buyEstimate),
    sellEstimate: Math.round(b.sellEstimate),
    sharePct: Math.round((b.volume / totalVolume) * 10000) / 100,
  }));

  return {
    buckets: rounded,
    totalVolume: Math.round(totalVolume),
    poc: {
      priceLow: rounded[pocIdx].priceLow,
      priceHigh: rounded[pocIdx].priceHigh,
      volume: rounded[pocIdx].volume,
    },
    valueArea: { low: rounded[lowIdx].priceLow, high: rounded[highIdx].priceHigh },
    barsUsed: bars.length,
    buyEstimateTotal: Math.round(buckets.reduce((a, b) => a + b.buyEstimate, 0)),
    sellEstimateTotal: Math.round(buckets.reduce((a, b) => a + b.sellEstimate, 0)),
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();
  const range = searchParams.get("range") === "5d" ? "5d" : "1mo";

  if (!symbol) {
    return Response.json({ error: "A symbol is required" }, { status: 400 });
  }

  try {
    const [orderBook, bars] = await Promise.all([
      fetchOrderBook(symbol).catch(() => null),
      fetchIntraday(symbol, range).catch(() => null),
    ]);

    const volumeProfile = buildVolumeProfile(bars);

    return Response.json({
      symbol,
      range,
      orderBook,
      orderBookAvailable: !!orderBook,
      volumeProfile,
      volumeProfileAvailable: !!volumeProfile,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to load depth for this stock", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
