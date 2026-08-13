import { getResolvedSectorList } from "@/lib/sectorOverrides";
import { fetchWeeklyOHLCVBatch } from "@/lib/screenerIndicators";
import { classifyStage, ma30Series, MA_WEEKS } from "@/lib/stageAnalysis";

export const dynamic = "force-dynamic";
// Weekly bars for ~470 unique constituents. Weekly is ~1/5 the payload of
// daily and is exactly what a 30-week MA needs, which is what makes a
// whole-market sector scan affordable at all.
export const maxDuration = 60;

const CONCURRENCY = 12;
// A composite is only meaningful if enough of its constituents reported.
const MIN_CONSTITUENT_COVERAGE = 0.5;
// "Entering" rather than "in" Stage 2, in weeks since the composite
// reclaimed its 30-week MA. Six weeks is roughly the window where the move
// is still early.
const ENTERING_MAX_WEEKS = 6;
// A member needs at least this much history to be worth including at all.
const MIN_MEMBER_WEEKS = MA_WEEKS + 6;
// The composite window: enough weeks for a meaningful 30-week MA slope,
// capped so it doesn't drift longer than the data most members share.
const MIN_COMPOSITE_WEEKS = MA_WEEKS + 20;
const MAX_COMPOSITE_WEEKS = 104;

/**
 * Equal-weighted composite from a set of weekly series.
 *
 * Each constituent is rebased to 100 at the first week where EVERY
 * included series has data, then averaged. Rebasing matters: without it a
 * ₹5,000 stock would dominate a ₹50 one purely by price level, and the
 * "sector" would just track its most expensive member. Equal weighting is
 * also a deliberate choice over market-cap weighting — this is meant to
 * answer "are the stocks in this sector broadly advancing", which a
 * cap-weighted index can hide when one giant carries it.
 */
function buildComposite(seriesList) {
  const usable = seriesList.filter((s) => Array.isArray(s) && s.length >= MIN_MEMBER_WEEKS);
  if (usable.length === 0) return null;

  // Align on a TARGET window rather than the shortest series.
  //
  // Aligning on the shortest was wrong: a single recently-listed member
  // truncated the entire composite to its own history. A sector of mature
  // stocks plus one nine-month-old listing collapsed from ~104 weeks to
  // ~37, leaving barely a handful of usable 30-week MA points — so the
  // sector's stage rested on almost no data while member breadth was
  // still being judged over full histories. The two then disagreed, which
  // is exactly the discrepancy this fixes.
  //
  // Instead: take the longest window the majority can cover, and drop the
  // members that can't reach back that far. They're reported as
  // `excludedShortHistory` rather than silently distorting the result.
  const lengths = usable.map((s) => s.length).sort((a, b) => b - a);
  // Median length — robust to a few very short or very long series.
  const median = lengths[Math.floor(lengths.length / 2)];
  const targetLen = Math.max(MIN_COMPOSITE_WEEKS, Math.min(median, MAX_COMPOSITE_WEEKS));

  const included = usable.filter((s) => s.length >= targetLen);
  const excludedShortHistory = usable.length - included.length;
  if (included.length === 0) return null;

  const len = targetLen;
  const trimmed = included.map((s) => s.slice(-len));
  const bases = trimmed.map((s) => s[0].c).filter((c) => c > 0);
  if (bases.length !== trimmed.length) return null;

  const out = [];
  for (let i = 0; i < len; i++) {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < trimmed.length; k++) {
      const c = trimmed[k][i]?.c;
      if (c > 0) {
        sum += (c / bases[k]) * 100;
        n++;
      }
    }
    if (n === 0) return null;
    out.push({ key: trimmed[0][i].t, c: sum / n });
  }
  return { bars: out, memberCount: trimmed.length, alignedWeeks: len, excludedShortHistory, includedSeries: trimmed };
}

/** Weeks since the composite last crossed above its 30-week MA. */
function weeksSinceReclaim(bars, ma) {
  let since = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (ma[i] == null) break;
    if (bars[i].c > ma[i]) since++;
    else break;
  }
  return since;
}

export async function GET() {
  try {
    const SECTOR_LIST = await getResolvedSectorList();
    const allSymbols = [...new Set(SECTOR_LIST.flatMap((s) => s.symbols))];
    const weekly = await fetchWeeklyOHLCVBatch(allSymbols, { concurrency: CONCURRENCY });

    const sectors = SECTOR_LIST.map(({ key, name, symbols }) => {
      const seriesList = symbols.map((s) => weekly.get(s)).filter(Boolean);
      const coverage = symbols.length ? seriesList.length / symbols.length : 0;

      if (coverage < MIN_CONSTITUENT_COVERAGE) {
        return {
          key,
          name,
          available: false,
          reason: "insufficient-data",
          constituentCount: symbols.length,
          reportingCount: seriesList.length,
        };
      }

      const composite = buildComposite(seriesList);
      if (!composite) {
        return {
          key,
          name,
          available: false,
          reason: "insufficient-history",
          constituentCount: symbols.length,
          reportingCount: seriesList.length,
        };
      }

      const verdict = classifyStage(composite.bars);
      if (!verdict) {
        return { key, name, available: false, reason: "insufficient-history", constituentCount: symbols.length, reportingCount: seriesList.length };
      }

      const ma = ma30Series(composite.bars);
      const weeksIn = verdict.stage === 2 ? weeksSinceReclaim(composite.bars, ma) : 0;

      // Breadth: how many individual constituents are themselves above a
      // rising 30-week MA. A sector composite can read Stage 2 on the back
      // of a few strong names, so this says how broad the move actually is.
      // Judged over EXACTLY the members that built the composite, and over
      // the same aligned window. Previously breadth ran across every member
      // with any usable history while the composite ran over a shorter
      // shared one — so the headline stage and the breadth behind it were
      // describing different things, and could contradict each other.
      let membersInStage2 = 0;
      let membersJudged = 0;
      const memberStages = { 1: 0, 2: 0, 3: 0, 4: 0 };
      for (const series of composite.includedSeries) {
        const v = classifyStage(series);
        if (!v) continue;
        membersJudged++;
        memberStages[v.stage] = (memberStages[v.stage] ?? 0) + 1;
        if (v.stage === 2) membersInStage2++;
      }

      return {
        key,
        name,
        available: true,
        stage: verdict.stage,
        stageLabel:
          verdict.stage === 2
            ? weeksIn > 0 && weeksIn <= ENTERING_MAX_WEEKS
              ? "Entering Stage 2"
              : "Stage 2"
            : `Stage ${verdict.stage}`,
        weeksInStage2: verdict.stage === 2 ? weeksIn : null,
        ma30SlopePct: Math.round(verdict.slopePct * 100) / 100,
        aboveMa: verdict.above,
        constituentCount: symbols.length,
        reportingCount: seriesList.length,
        membersInStage2,
        membersJudged,
        memberStages,
        breadthPct: membersJudged ? Math.round((membersInStage2 / membersJudged) * 1000) / 10 : null,
        // Surfaced so the denominator behind the percentage is visible —
        // "44% breadth" over 9 members means something different from the
        // sector's full 20-stock list.
        alignedWeeks: composite.alignedWeeks,
        excludedShortHistory: composite.excludedShortHistory,
      };
    });

    // Stage 2 first, then by how broad the advance is.
    const order = { 2: 0, 1: 1, 3: 2, 4: 3 };
    sectors.sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      const s = (order[a.stage] ?? 9) - (order[b.stage] ?? 9);
      if (s !== 0) return s;
      return (b.breadthPct ?? 0) - (a.breadthPct ?? 0);
    });

    return Response.json({
      sectors,
      enteringCount: sectors.filter((s) => s.stageLabel === "Entering Stage 2").length,
      stage2Count: sectors.filter((s) => s.stage === 2).length,
      enteringMaxWeeks: ENTERING_MAX_WEEKS,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to compute sector stages", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
