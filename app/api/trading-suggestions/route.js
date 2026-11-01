import { fetchDailyOHLCVBatch, fetchIndexOHLCV } from "@/lib/screenerIndicators";
import { analyzeSymbol, buildSection } from "@/lib/tradingSuggestions";
import { getFnoUniverse, getBankNiftyLot } from "@/lib/fnoUniverse";

// GET /api/trading-suggestions?section=stocks|banknifty&date=YYYY-MM-DD
//
// The expensive part is the backtest over ~5 years × ~200 F&O stocks, and
// it only changes once a day, so the per-symbol analyses are cached in
// memory for a few hours and every date-filter request reuses them.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_MS = 4 * 60 * 60 * 1000;
const caches = { stocks: null, banknifty: null }; // { at, value }

async function loadStocks() {
  if (caches.stocks && Date.now() - caches.stocks.at < CACHE_MS) return caches.stocks.value;
  const universe = await getFnoUniverse();
  const hist = await fetchDailyOHLCVBatch(universe.stocks, { concurrency: 16, range: "5y" });
  const analyses = universe.stocks.map((s) => {
    const h = hist.get(s);
    return h?.bars ? analyzeSymbol(s, h.bars, { isIndex: false }) : null;
  });
  const value = { analyses, universe, missing: universe.stocks.filter((s) => !hist.get(s)?.bars).length };
  caches.stocks = { at: Date.now(), value };
  return value;
}

async function loadBankNifty() {
  if (caches.banknifty && Date.now() - caches.banknifty.at < CACHE_MS) return caches.banknifty.value;
  const [h, lot] = await Promise.all([fetchIndexOHLCV("^NSEBANK", "10y"), getBankNiftyLot()]);
  const analysis = h?.bars ? analyzeSymbol("BANKNIFTY", h.bars, { isIndex: true }) : null;
  const value = { analysis, lot };
  caches.banknifty = { at: Date.now(), value };
  return value;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const section = searchParams.get("section") === "banknifty" ? "banknifty" : "stocks";
  const dateParam = searchParams.get("date");
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
  const minWin = Number(searchParams.get("bar")) / 100 || undefined;

  try {
    if (section === "banknifty") {
      const { analysis, lot } = await loadBankNifty();
      if (!analysis) return Response.json({ error: "Couldn't load BANKNIFTY history from Yahoo" }, { status: 503 });
      const result = buildSection([analysis], { date, isIndex: true, lots: { BANKNIFTY: lot }, minWin });
      return Response.json({ section, ...result, lotSize: lot });
    }

    const { analyses, universe, missing } = await loadStocks();
    if (!analyses.some(Boolean)) {
      return Response.json({ error: "Couldn't load price history for the F&O stocks" }, { status: 503 });
    }
    const result = buildSection(analyses, { date, isIndex: false, lots: universe.lots, minWin });
    return Response.json({
      section,
      ...result,
      universeSource: universe.source,
      universeApproximate: !!universe.approximate,
      universeSize: universe.stocks.length,
      missingHistory: missing,
    });
  } catch (err) {
    return Response.json({ error: "Failed to build trading suggestions", detail: String(err?.message || err) }, { status: 502 });
  }
}
