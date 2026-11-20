// The list of requests the nightly job warms — every "latest session"
// view the tabs open with. Order matters a little: fast, most-used first,
// so a run that's cut short still covers what you open most.

import { SCREEN_ORDER, CONFLUENCE_SCREEN } from "@/lib/screens";
import { DELIVERY_BUCKETS } from "@/lib/deliveryBuckets";

export function precomputeJobs() {
  const jobs = [];
  const add = (id, path) => jobs.push({ id, path });

  // Market panel first: breadth, rotation and the scorecard share its history.
  add("breadth:top500", "/api/breadth?universe=top500");
  // Every stock's, sector's and theme's stage — the Delivery "Show stage" toggle.
  add("stage-map", "/api/stage-map");
  // FII / DII flows, NSDL sector report, FII/DII bulk & block deals.
  add("fii", "/api/fii");
  for (const s of ["surge", "picks", "highs", "stage2", "picks-screener"]) add(`home:${s}`, `/api/home?section=${s}`);
  for (const id of SCREEN_ORDER) add(`screener:${id}`, `/api/screeners?screen=${encodeURIComponent(id)}`);
  add(`screener:${CONFLUENCE_SCREEN}`, `/api/screeners?screen=${CONFLUENCE_SCREEN}`);
  // Daily views only — weekly / monthly variants are built the first time
  // they're opened and then served from the cache for the rest of the day.
  // (Fewer nightly jobs = less of Vercel's free "Active CPU" allowance.)
  add("sectors:daily", "/api/sector-delivery?period=daily");
  add("themes:daily", "/api/sector-delivery?period=daily&group=themes");
  // Same parameters the tab sends by default, so the cache key matches.
  add("delivery-top:weekly", "/api/delivery-top?period=weekly&minVolRatio=1.5&minTurnoverCr=10");

  for (const b of DELIVERY_BUCKETS) add(`delivery:daily:${b.id}`, `/api/delivery?period=daily&bucket=${b.id}`);
  add("trading:stocks", "/api/trading-suggestions?section=stocks&bar=80");
  add("trading:banknifty", "/api/trading-suggestions?section=banknifty&bar=80");

  add("rotation:sectors", "/api/rotation?group=sectors");

  // After the screeners above, so today's picks are logged before grading.
  add("scorecard", "/api/signal-scorecard?fresh=1&period=all");
  add("market-caps", "/api/cron/warm-market-caps");
  return jobs;
}
