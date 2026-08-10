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
  const usable = seriesList.filter((s) => Array.isArray(s) && s.length >= MA_WEEKS + 6);
  if (usable.length === 0) return null;

  // Align on the shortest history so every week averages the same members.
  const len = Math.min(...usable.map((s) => s.length));
  if (len < MA_WEEKS + 6) return null;

  const trimmed = usable.map((s) => s.slice(-len));
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
  return { bars: out, memberCount: trimmed.length };
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
      let membersInStage2 = 0;
      let membersJudged = 0;
      for (const series of seriesList) {
        if (!series || series.length < MA_WEEKS + 6) continue;
        const v = classifyStage(series);
        if (!v) continue;
        membersJudged++;
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
        breadthPct: membersJudged ? Math.round((membersInStage2 / membersJudged) * 1000) / 10 : null,
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
