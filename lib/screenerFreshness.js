import { SCREEN_ORDER } from "@/lib/screens";
import { getCurrentMembers } from "@/lib/screenerMembership";

// Previously the Screener-membership column on the Delivery tab only
// showed real data if someone had already opened the Screeners tab
// TODAY — app/api/screeners/route.js only writes today's membership
// snapshot when a screen is actually computed there (see
// recordScreenSnapshot in lib/screenerMembership.js). Open Delivery
// first, before Screeners, and every row's membership column read
// whatever was left over from a previous day (or nothing at all on a
// fresh deployment).
//
// This makes Delivery self-sufficient: it checks which of the 9 screens'
// snapshots are NOT from today, and for those, calls this app's own
// /api/screeners route directly (a normal server-to-server fetch) to
// compute and record them — the same computation the Screeners tab
// itself would trigger, just kicked off from Delivery instead.
//
// Bounded by budgetMs so a slow screen (Stage 2 is the heaviest — it
// scans a ~500-stock universe against weekly Yahoo history) can't hang
// Delivery's own response indefinitely: whatever hasn't finished by the
// budget is left for the NEXT request rather than blocking this one.
// Screens run in PARALLEL, not sequentially, so the wall-clock cost is
// roughly "however long the single slowest stale screen takes", not the
// sum of all of them.

const DEFAULT_BUDGET_MS = 25000;

export async function ensureScreenerFreshness(origin, asOfDate, { budgetMs = DEFAULT_BUDGET_MS } = {}) {
  const current = await Promise.all(SCREEN_ORDER.map((id) => getCurrentMembers(id)));
  const staleIds = SCREEN_ORDER.filter((id, i) => current[i]?.asOf !== asOfDate);

  if (staleIds.length === 0) {
    return { checked: SCREEN_ORDER, stale: [], refreshed: [], stillStale: [], timedOut: false };
  }

  const refreshOne = (id) =>
    fetch(`${origin}/api/screeners?screen=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((res) => (res.ok ? id : null))
      .catch(() => null);

  const refreshPromise = Promise.allSettled(staleIds.map(refreshOne));
  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve("timeout"), budgetMs));

  const raced = await Promise.race([refreshPromise, timeoutPromise]);

  if (raced === "timeout") {
    // The in-flight fetches aren't cancelled — they'll still finish and
    // record themselves in the background, benefiting the next request
    // that calls this. This one just can't wait any longer for them.
    return { checked: SCREEN_ORDER, stale: staleIds, refreshed: [], stillStale: staleIds, timedOut: true };
  }

  const refreshed = raced.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
  return {
    checked: SCREEN_ORDER,
    stale: staleIds,
    refreshed,
    stillStale: staleIds.filter((id) => !refreshed.includes(id)),
    timedOut: false,
  };
}
