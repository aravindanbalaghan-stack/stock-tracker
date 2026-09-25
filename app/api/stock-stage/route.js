import { fetchWeeklyOHLCVBatch } from "@/lib/screenerIndicators";
import { classifyStage } from "@/lib/stageAnalysis";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

// Same classifyStage() call app/api/sector-stage/route.js already makes
// per constituent to compute sector breadth — exposed directly here so
// the Delivery tab's Stocks section can show a stage for each row without
// needing a whole sector composite built around it. Much cheaper than
// sector-stage's own computation: no composite alignment, no breadth
// aggregation, just one weekly-history fetch and one classification per
// requested symbol.
const CONCURRENCY = 12;
const MAX_SYMBOLS = 150; // bounds the Yahoo weekly-history fetch — the Delivery tab only ever
// requests this for the symbols currently visible in one bucket tab, which stays well under this.

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get("symbols");
  if (!symbolsParam) return Response.json({ error: "Missing ?symbols=SYM1,SYM2" }, { status: 400 });

  const requested = [...new Set(symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const symbols = requested.slice(0, MAX_SYMBOLS);
  if (symbols.length === 0) return Response.json({ results: {} });

  try {
    const weekly = await fetchWeeklyOHLCVBatch(symbols, { concurrency: CONCURRENCY });
    const results = {};
    for (const symbol of symbols) {
      const series = weekly.get(symbol);
      const verdict = series ? classifyStage(series) : null;
      if (!verdict) {
        results[symbol] = { available: false };
        continue;
      }
      results[symbol] = {
        available: true,
        stage: verdict.stage,
        stageLabel: `Stage ${verdict.stage}`,
        ma30SlopePct: Math.round(verdict.slopePct * 100) / 100,
        aboveMa: verdict.above,
      };
    }
    return Response.json({ results, truncated: requested.length > MAX_SYMBOLS, cap: MAX_SYMBOLS });
  } catch (err) {
    console.error("stock-stage: failed to classify stages:", err?.message || err);
    return Response.json(
      { error: "Failed to compute stock stages", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
