import { getSessionUser } from "@/lib/auth";
import { loadPanel } from "@/lib/marketPanel";
import { symbolContext, suggestedStops } from "@/lib/portfolio";
import { getHoldings } from "@/lib/holdingsStore";
import { getSettings } from "@/lib/portfolioSettings";
import { classify } from "@/lib/portfolioContext";
import { computeBreadth } from "@/lib/breadth";

// Context for the position sizer: the stock's levels and suggested stops,
// your current exposure to its sector, and the market's breadth verdict.
// The share count itself is computed in the browser so it updates as you type.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Suggested risk multiplier per breadth verdict: full size in a healthy
// market, less when most stocks are falling.
const BREADTH_MULT = { "risk-on": 1, mixed: 0.75, "risk-off": 0.5 };
let breadthMemo = null; // the verdict only changes once a session

export async function GET(request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const symbol = (new URL(request.url).searchParams.get("symbol") || "").trim().toUpperCase();
  try {
    const [panel, holdings, settings] = await Promise.all([loadPanel({ budgetMs: 15_000 }), getHoldings(user).catch(() => []), getSettings(user)]);
    const held = holdings ?? [];
    const ctx = symbol ? symbolContext(panel, symbol) : null;
    const { sectorOf } = await classify([...new Set([symbol, ...held.map((h) => h.symbol)].filter(Boolean))]);

    // Current exposure at last close.
    const T = panel.dates.length;
    const priceOf = (s) => {
      const i = panel.idx.get(s);
      return i == null ? null : panel.c[i][T - 1];
    };
    const value = held.reduce((a, h) => a + (priceOf(h.symbol) ?? h.avgPrice ?? 0) * h.quantity, 0);
    const sector = symbol ? sectorOf.get(symbol) ?? null : null;
    const sectorValue = sector ? held.filter((h) => sectorOf.get(h.symbol) === sector).reduce((a, h) => a + (priceOf(h.symbol) ?? h.avgPrice ?? 0) * h.quantity, 0) : 0;
    const openRisk = held.reduce((a, h) => {
      const p = priceOf(h.symbol);
      return h.stopLoss && p ? a + Math.max(0, p - h.stopLoss) * h.quantity : a;
    }, 0);
    const already = held.find((h) => h.symbol === symbol) ?? null;

    let breadth = null;
    if (panel.dates.length >= 60) {
      if (breadthMemo?.latest !== panel.latest) {
        const b = computeBreadth(panel, { universe: "top500" });
        breadthMemo = { latest: panel.latest, verdict: b.verdict };
      }
      const v = breadthMemo.verdict;
      if (v) breadth = { tone: v.tone, headline: v.headline, multiplier: BREADTH_MULT[v.tone] ?? 1 };
    }
    return Response.json({
      asOf: panel.latest,
      settings,
      context: ctx,
      stops: suggestedStops(ctx),
      sector,
      exposure: { portfolioValue: Math.round(value), sectorValue: Math.round(sectorValue), openRisk: Math.round(openRisk), alreadyHeld: already ? { quantity: already.quantity, avgPrice: already.avgPrice } : null },
      breadth,
      notFound: symbol && !ctx ? `No NSE end-of-day data for ${symbol} in the price history yet.` : null,
    });
  } catch (err) {
    console.error("position-size:", err);
    return Response.json({ error: "Couldn't load sizing context", detail: String(err?.message || err) }, { status: 500 });
  }
}
