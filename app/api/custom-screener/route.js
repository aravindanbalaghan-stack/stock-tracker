import { getSessionUser } from "@/lib/auth";
import { loadPanel } from "@/lib/marketPanel";
import { runCustomScreen } from "@/lib/customScreener";
import { panelMeta } from "@/lib/panelResponse";

// Runs a custom screen: POST { definition, asOf? } → today's matches plus a
// graded backtest of the same rules (lib/customScreener.js).

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request) {
  if (!(await getSessionUser())) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const panel = await loadPanel({ budgetMs: 20_000 });
    if (panel.dates.length < 60) {
      return Response.json({ ...panelMeta(panel), rows: [], backtest: null, error: "Not enough price history yet — try again in a minute while it loads." }, { status: 503 });
    }
    let asOfT = null;
    if (typeof body.asOf === "string" && body.asOf) {
      const t = panel.dates.indexOf(body.asOf);
      asOfT = t >= 0 ? t : panel.dates.findLastIndex((d) => d <= body.asOf);
    }
    const result = await runCustomScreen(panel, body.definition, { asOfT });
    return Response.json({ ...panelMeta(panel), ...result });
  } catch (err) {
    const msg = String(err?.message || err);
    const userError = /condition|Add at least|Missing screen|Up to 12/i.test(msg);
    if (!userError) console.error("custom-screener:", err);
    return Response.json({ error: userError ? msg : "Couldn't run this screen", detail: userError ? undefined : msg }, { status: userError ? 400 : 500 });
  }
}
