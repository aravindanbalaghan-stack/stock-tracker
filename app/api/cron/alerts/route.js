import { getSessionUser } from "@/lib/auth";
import { evaluateAll } from "@/lib/alerts";
import { loadPanel } from "@/lib/marketPanel";
import { marketIsOpen } from "@/lib/marketHours";

// Checks every user's alerts.
//   ?mode=eod  — nightly (Vercel cron, after the precompute): everything,
//                against the session's close, incl. stage / screener /
//                breadth alerts.
//   ?mode=live — during market hours, from any scheduler that can send
//                "Authorization: Bearer <CRON_SECRET>" (e.g. cron-job.org
//                every 5 minutes). Does nothing while the market is shut.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function authorised(request) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  if (process.env.SESSION_SECRET && request.headers.get("x-panel-internal") === process.env.SESSION_SECRET) return true;
  return !!(await getSessionUser());
}

export async function GET(request) {
  if (!(await authorised(request))) return Response.json({ error: "Not allowed" }, { status: 401 });
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "live" ? "live" : "eod";
  if (mode === "live" && !(await Promise.resolve(marketIsOpen()).catch(() => false))) {
    return Response.json({ mode, skipped: "market closed" });
  }
  const panel = await loadPanel({ budgetMs: mode === "eod" ? 30_000 : 3000, fill: mode === "eod" }).catch(() => null);
  const results = await evaluateAll({ mode, panel, origin: url.origin });
  const fired = Object.values(results).reduce((a, r) => a + (r.fired ?? 0), 0);
  return Response.json({ mode, users: Object.keys(results).length, fired, results: Object.fromEntries(Object.entries(results).map(([u, r]) => [u, { fired: r.fired ?? 0, error: r.error }])) });
}
