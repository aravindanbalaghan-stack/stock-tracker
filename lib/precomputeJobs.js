// The list of requests the nightly job warms — every "latest session"
// view the tabs open with. Order matters a little: fast, most-used first,
// so a run that's cut short still covers what you open most.

import { SCREEN_ORDER, CONFLUENCE_SCREEN } from "@/lib/screens";
import { DELIVERY_BUCKETS } from "@/lib/deliveryBuckets";

export function precomputeJobs() {
  const jobs = [];
  const add = (id, path) => jobs.push({ id, path });

  for (const s of ["surge", "picks", "highs", "stage2", "picks-screener"]) add(`home:${s}`, `/api/home?section=${s}`);
  for (const id of SCREEN_ORDER) add(`screener:${id}`, `/api/screeners?screen=${encodeURIComponent(id)}`);
  add(`screener:${CONFLUENCE_SCREEN}`, `/api/screeners?screen=${CONFLUENCE_SCREEN}`);
  for (const period of ["daily", "weekly", "monthly"]) {
    add(`sectors:${period}`, `/api/sector-delivery?period=${period}`);
    add(`themes:${period}`, `/api/sector-delivery?period=${period}&group=themes`);
  }
  // Same parameters the tab sends by default, so the cache key matches.
  add("delivery-top:weekly", "/api/delivery-top?period=weekly&minVolRatio=1.5&minTurnoverCr=10");
  add("delivery-top:monthly", "/api/delivery-top?period=monthly&minVolRatio=1.5&minTurnoverCr=10");
  for (const period of ["daily", "weekly", "monthly"]) {
    for (const b of DELIVERY_BUCKETS) add(`delivery:${period}:${b.id}`, `/api/delivery?period=${period}&bucket=${b.id}`);
  }
  add("trading:stocks", "/api/trading-suggestions?section=stocks&bar=80");
  add("trading:banknifty", "/api/trading-suggestions?section=banknifty&bar=80");
  add("market-caps", "/api/cron/warm-market-caps");
  return jobs;
}
