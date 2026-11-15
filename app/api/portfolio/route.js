import { getSessionUser } from "@/lib/auth";
import { getHoldings, getClosedTrades } from "@/lib/holdingsStore";
import { getSettings } from "@/lib/portfolioSettings";
import { loadPanel } from "@/lib/marketPanel";
import { computePortfolio } from "@/lib/portfolio";
import { classify } from "@/lib/portfolioContext";
import { panelMeta } from "@/lib/panelResponse";

// Portfolio analytics for the signed-in account (Holdings → Analytics).

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    const holdings = await getHoldings(user);
    if (holdings == null) return Response.json({ error: "Holdings need storage — add the Upstash database (README → Set up storage)." }, { status: 503 });
    if (!holdings.length) return Response.json({ empty: true });
    const [panel, closed, settings, ctx] = await Promise.all([
      loadPanel({ budgetMs: 20_000 }),
      getClosedTrades(user),
      getSettings(user),
      classify(holdings.map((h) => h.symbol)),
    ]);
    if (panel.dates.length < 30) return Response.json({ ...panelMeta(panel), empty: false, notReady: true });
    return Response.json({ ...panelMeta(panel), ...computePortfolio({ panel, holdings, closed, settings, ...ctx }) });
  } catch (err) {
    console.error("portfolio:", err);
    return Response.json({ error: "Couldn't compute portfolio analytics", detail: String(err?.message || err) }, { status: 500 });
  }
}
