import { serveCached } from "@/lib/precompute";
import { loadPanel } from "@/lib/marketPanel";
import { SCREENS, CONFLUENCE_SCREEN, CONFLUENCE_DEF, MAIN_SCREEN_IDS } from "@/lib/screens";
import { listSignalScreens, getSignalLogs, backfillSignalLogs } from "@/lib/signalLog";
import { gradeSignals, logToT, makeBench, HORIZONS } from "@/lib/scorecard";
import { panelMeta } from "@/lib/panelResponse";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PERIODS = { 30: 30, 90: 90, all: Infinity };
const RECENT_SIGNALS = 80;

function labelOf(id) {
  if (id === CONFLUENCE_SCREEN) return CONFLUENCE_DEF.label;
  return SCREENS[id]?.label ?? id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

async function compute(request) {
  const sp = new URL(request.url).searchParams;
  const fresh = sp.get("fresh") !== "0";
  const periodKey = sp.get("period") in PERIODS ? sp.get("period") : "all";
  try {
    const backfill = await backfillSignalLogs().catch((e) => ({ done: false, error: String(e?.message || e) }));
    const [panel, ids] = await Promise.all([loadPanel(), listSignalScreens()]);
    const logs = await getSignalLogs(ids);
    const bench = makeBench(panel);
    const T = panel.dates.length;
    const sinceT = Number.isFinite(PERIODS[periodKey]) ? Math.max(0, T - PERIODS[periodKey]) : 0;

    const screens = ids
      .map((id) => {
        const byT = logToT(panel, logs[id]);
        if (!byT.size) return null;
        const g = gradeSignals(panel, byT, { fresh, bench, sinceT });
        const loggedDates = Object.keys(logs[id] ?? {}).sort();
        // When nothing is graded yet, say when the first grade lands: the
        // oldest pick in the panel plus 5 sessions.
        const ts = [...byT.keys()].sort((a, b) => a - b);
        const firstGradeT = ts.length ? ts[0] + 5 : null;
        return {
          id,
          label: labelOf(id),
          main: MAIN_SCREEN_IDS.includes(id),
          sessions: byT.size,
          firstDate: loggedDates[0] ?? null,
          lastDate: loggedDates[loggedDates.length - 1] ?? null,
          totalSignals: g.signals.length,
          open: g.open,
          stats: g.stats,
          firstGradeDue: firstGradeT != null && firstGradeT >= T ? `${firstGradeT - T + 1} more session${firstGradeT - T + 1 === 1 ? "" : "s"}` : null,
          signals: g.signals.slice(0, RECENT_SIGNALS),
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.stats[10]?.avgExcess ?? -999) - (a.stats[10]?.avgExcess ?? -999));

    const meta = panelMeta(panel);
    if (!backfill?.done) {
      // Don't let the cache pin a scorecard built from a half-imported log.
      meta.incomplete = true;
      meta.note = [
        meta.note,
        backfill?.error
          ? `Couldn't import earlier picks yet (${backfill.error}). It retries on the next load.`
          : `Importing earlier screener picks: ${backfill?.scanned ?? 0} stocks read so far. It continues on each load and in the nightly job; scores fill in as it goes.`,
      ]
        .filter(Boolean)
        .join(" ");
    }
    return Response.json({
      ...meta,
      fresh,
      period: periodKey,
      horizons: HORIZONS,
      backfill,
      screens,
    });
  } catch (err) {
    console.error("signal-scorecard:", err);
    return Response.json({ error: "Couldn't build the scorecard", detail: String(err?.message || err) }, { status: 500 });
  }
}

export async function GET(request) {
  return serveCached(request, { name: "signal-scorecard", vary: ["fresh", "period"], cacheable: () => true }, compute);
}
