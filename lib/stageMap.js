// Weinstein stage for every stock, sector and theme — in one pass over the
// stored daily market panel (lib/marketPanel.js), so the Delivery tab's
// "Show stage" toggle reads one precomputed answer instead of fetching two
// years of weekly history per symbol from Yahoo on every click.
//
// Same rule everywhere (lib/stageAnalysis.js classifyStage): weekly closes
// against the 30-week MA and its 4-week slope.

import { toWeeklyBars } from "@/lib/screenerIndicators";
import { classifyStage, ma30Series, MA_WEEKS } from "@/lib/stageAnalysis";
import { dailyBarsOf } from "@/lib/breadth";
import { weekEnds, basketIndex } from "@/lib/rotation";

const ENTERING_MAX_WEEKS = 6;
const MIN_WEEKS = MA_WEEKS + 5;
const MIN_MEMBERS = 2;
const r2 = (x) => Math.round(x * 100) / 100;

/** Consecutive weekly closes above the 30-week MA, counting back from the latest. */
function weeksAbove(bars, ma) {
  let n = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (ma[i] == null || !(bars[i].c > ma[i])) break;
    n++;
  }
  return n;
}

function labelFor(stage, weeksIn) {
  if (stage === 2 && weeksIn > 0 && weeksIn <= ENTERING_MAX_WEEKS) return "Entering Stage 2";
  return `Stage ${stage}`;
}

/** { SYMBOL: {stage, stageLabel, ma30SlopePct, aboveMa, weeksInStage2} } */
export function stockStages(panel) {
  const out = {};
  for (let i = 0; i < panel.symbols.length; i++) {
    const weekly = toWeeklyBars(dailyBarsOf(panel, i));
    if (weekly.length < MIN_WEEKS) continue;
    const v = classifyStage(weekly);
    if (!v) continue;
    const weeksIn = v.stage === 2 ? weeksAbove(weekly, ma30Series(weekly)) : null;
    out[panel.symbols[i]] = {
      stage: v.stage,
      stageLabel: labelFor(v.stage, weeksIn),
      ma30SlopePct: r2(v.slopePct),
      aboveMa: v.above,
      weeksInStage2: weeksIn,
    };
  }
  return out;
}

/**
 * Equal-weight composite stage for each group (sector or theme), plus the
 * breadth behind it: how many members are individually in Stage 2.
 */
export function groupStages(panel, groups, stocks) {
  const weeks = weekEnds(panel.dates);
  return groups.map(({ key, name, symbols }) => {
    const rows = symbols.map((s) => panel.idx.get(s)).filter((i) => i != null);
    const base = { key, name, constituentCount: symbols.length, reportingCount: rows.length };
    if (rows.length < MIN_MEMBERS || weeks.length < MIN_WEEKS) return { ...base, available: false, reason: "insufficient-data" };
    const idx = basketIndex(panel, rows, weeks);
    const bars = idx.map((c, k) => ({ key: weeks[k].week, c, h: c, l: c }));
    const v = classifyStage(bars);
    if (!v) return { ...base, available: false, reason: "insufficient-history" };
    const weeksIn = v.stage === 2 ? weeksAbove(bars, ma30Series(bars)) : null;

    const memberStages = { 1: 0, 2: 0, 3: 0, 4: 0 };
    let judged = 0;
    for (const s of symbols) {
      const st = stocks[s];
      if (!st) continue;
      judged++;
      memberStages[st.stage]++;
    }
    return {
      ...base,
      available: true,
      stage: v.stage,
      stageLabel: labelFor(v.stage, weeksIn),
      weeksInStage2: weeksIn,
      ma30SlopePct: r2(v.slopePct),
      aboveMa: v.above,
      membersInStage2: memberStages[2],
      membersJudged: judged,
      memberStages,
      breadthPct: judged ? Math.round((memberStages[2] / judged) * 1000) / 10 : null,
      alignedWeeks: bars.length,
      excludedShortHistory: symbols.length - judged,
    };
  });
}
