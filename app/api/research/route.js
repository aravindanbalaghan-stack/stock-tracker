import { fetchGoogleNews } from "@/lib/googleNews";
import { nseApiFetch } from "@/lib/nseSession";
import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { INDEX_CONSTITUENTS } from "@/lib/indexConstituents";
import { fetchChartQuote } from "@/app/api/indices/route";

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const SIGNIFICANT_MOVE_PCT = 4; // flag a day if |change| >= this
const ACCUMULATION_DELIVERY_THRESHOLD = 55; // avg delivery % over the window

function indexDisplayName(indexSymbol) {
  const names = {
    "^NSEI": "Nifty 50", "^NSEBANK": "Nifty Bank", "^CNXIT": "Nifty IT",
    "^CNXAUTO": "Nifty Auto", "^CNXPHARMA": "Nifty Pharma", "^CNXFMCG": "Nifty FMCG",
    "^CNXMETAL": "Nifty Metal", "^CNXREALTY": "Nifty Realty", "^CNXENERGY": "Nifty Energy",
    "^CNXPSUBANK": "Nifty PSU Bank", "^CNXFIN": "Nifty Financial Services",
  };
  return names[indexSymbol] || indexSymbol;
}

function findSector(symbol) {
  for (const [indexSymbol, constituents] of Object.entries(INDEX_CONSTITUENTS)) {
    if (constituents.includes(symbol)) {
      return { indexSymbol, sectorName: indexDisplayName(indexSymbol), constituents };
    }
  }
  return null;
}

// --- 1. Company meta (name) via the chart endpoint we already trust ---
async function getCompanyMeta(symbol) {
  const chart = await fetchChartQuote(`${symbol}.NS`);
  return {
    name: chart?.meta?.longName || chart?.meta?.shortName || symbol,
    price: chart?.price ?? null,
  };
}

// --- 2. News: stock-specific + sector-wide ---
async function getNews(symbol, companyName, sector) {
  const [stockNews, sectorNews] = await Promise.all([
    fetchGoogleNews(`${companyName} share price NSE`, 8),
    sector ? fetchGoogleNews(`${sector.sectorName} sector stocks India`, 6) : Promise.resolve([]),
  ]);
  return { stockNews, sectorNews, sector: sector?.sectorName ?? null };
}

// --- 3. Upcoming events: NSE board meetings + corporate actions (best-effort) ---
async function getUpcomingEvents(symbol) {
  const [boardMeetings, corpActions] = await Promise.all([
    nseApiFetch(`/api/corporate-board-meetings?index=equities&symbol=${encodeURIComponent(symbol)}`),
    nseApiFetch(`/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(symbol)}`),
  ]);

  if (boardMeetings == null && corpActions == null) {
    return { available: false, events: [] };
  }

  const events = [];
  const today = new Date();

  if (Array.isArray(boardMeetings)) {
    for (const m of boardMeetings) {
      const date = m.bm_date;
      if (!date) continue;
      events.push({
        type: "Board meeting",
        date,
        detail: m.bm_purpose || m.bm_desc || "Board meeting",
      });
    }
  }
  if (Array.isArray(corpActions)) {
    for (const a of corpActions) {
      const date = a.exDate;
      if (!date) continue;
      events.push({
        type: "Corporate action",
        date,
        detail: a.subject || a.series || "Corporate action",
      });
    }
  }

  // Keep events from the recent past (for context) through the future,
  // sorted soonest-first.
  events.sort((a, b) => new Date(a.date) - new Date(b.date));

  return { available: true, events: events.slice(0, 15) };
}

// --- 4. Significant recent price moves, cross-checked against news dates ---
async function getSignificantMoves(symbol, news) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS?interval=1d&range=3mo`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return { available: false, moves: [] };
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { available: false, moves: [] };

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const bars = timestamps.map((t, i) => ({ t, c: closes[i] })).filter((b) => b.c != null);

    const allNews = [...(news?.stockNews || [])];

    const moves = [];
    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1].c;
      const curr = bars[i].c;
      const changePercent = ((curr - prev) / prev) * 100;
      if (Math.abs(changePercent) < SIGNIFICANT_MOVE_PCT) continue;

      const moveDate = new Date(bars[i].t * 1000);
      const matchedNews = allNews.find((n) => {
        const newsDate = new Date(n.pubDate);
        if (isNaN(newsDate)) return false;
        const diffDays = Math.abs((newsDate - moveDate) / (1000 * 60 * 60 * 24));
        return diffDays <= 2;
      });

      moves.push({
        date: moveDate.toISOString().slice(0, 10),
        changePercent,
        matchedNews: matchedNews ? matchedNews.title : null,
      });
    }

    // Most recent first, cap it so the UI stays readable.
    return { available: true, moves: moves.reverse().slice(0, 8) };
  } catch {
    return { available: false, moves: [] };
  }
}

// --- 5. Accumulation heuristic: delivery %, volume, price trend from bhavcopy ---
function computeAccumulationSignal(days, symbol) {
  const series = days
    .map((d) => d.bySymbol.get(symbol))
    .filter((r) => r && r.deliveryPct != null && r.volume);

  if (series.length < 5) return { available: false };

  const avgDelivery = series.reduce((a, r) => a + r.deliveryPct, 0) / series.length;
  const avgVolume = series.reduce((a, r) => a + r.volume, 0) / series.length;
  const recentVolume = series[series.length - 1].volume;
  const priceStart = series[0].close;
  const priceEnd = series[series.length - 1].close;
  const priceTrendPct = priceStart ? ((priceEnd - priceStart) / priceStart) * 100 : null;

  let verdict = "No strong signal";
  if (avgDelivery >= ACCUMULATION_DELIVERY_THRESHOLD && priceTrendPct != null) {
    if (priceTrendPct > 1) verdict = "Signs of accumulation";
    else if (priceTrendPct < -1) verdict = "Signs of distribution";
  }

  return {
    available: true,
    avgDeliveryPct: avgDelivery,
    avgVolume,
    recentVsAvgVolume: avgVolume ? recentVolume / avgVolume : null,
    priceTrendPct,
    verdict,
    windowDays: series.length,
  };
}

async function getAccumulation(symbol, sector) {
  const days = await getRecentBhavcopies(15);
  const stockSignal = computeAccumulationSignal(days, symbol);

  let sectorSignal = null;
  if (sector) {
    const perStock = sector.constituents
      .map((s) => computeAccumulationSignal(days, s))
      .filter((s) => s.available);
    if (perStock.length > 0) {
      sectorSignal = {
        available: true,
        avgDeliveryPct: perStock.reduce((a, s) => a + s.avgDeliveryPct, 0) / perStock.length,
        avgPriceTrendPct: perStock.reduce((a, s) => a + (s.priceTrendPct || 0), 0) / perStock.length,
        stocksConsidered: perStock.length,
        sectorName: sector.sectorName,
      };
    }
  }

  return { stock: stockSignal, sector: sectorSignal };
}

// --- 6. FII/DII: market-wide daily activity + this stock's shareholding pattern (best-effort) ---
async function getFiiDii(symbol) {
  const [marketWide, shareholding] = await Promise.all([
    nseApiFetch(`/api/fiidiiTradeReact`),
    nseApiFetch(`/api/corporate-share-holdings-master?index=equities&symbol=${encodeURIComponent(symbol)}`),
  ]);

  return {
    marketWide: Array.isArray(marketWide) ? marketWide.slice(0, 5) : null,
    shareholding: shareholding ?? null,
    available: marketWide != null || shareholding != null,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbolRaw = searchParams.get("symbol");
  if (!symbolRaw) {
    return Response.json({ error: "Missing ?symbol=" }, { status: 400 });
  }
  const symbol = symbolRaw.trim().toUpperCase();

  try {
    const { name, price } = await getCompanyMeta(symbol);
    const sector = findSector(symbol);

    const [news, events, accumulation, fiiDii] = await Promise.all([
      getNews(symbol, name, sector),
      getUpcomingEvents(symbol),
      getAccumulation(symbol, sector),
      getFiiDii(symbol),
    ]);
    const moves = await getSignificantMoves(symbol, news);

    return Response.json({
      symbol,
      name,
      price,
      sector: sector?.sectorName ?? null,
      news,
      events,
      moves,
      accumulation,
      fiiDii,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to build research view", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
