// Trading-journal maths: per-trade figures, the summary a trader should
// watch (expectancy, R, payoff, drawdown), breakdowns, plain-English
// insights, and the "AI review pack" export. Pure functions — used by the
// Journal tab and its exports alike.

export const EMOTIONS = ["Calm", "Confident", "FOMO", "Fear", "Greed", "Revenge", "Impatient", "Bored", "Hopeful", "Overconfident"];
export const MISTAKES = [
  "No stop-loss",
  "Moved stop-loss",
  "Exited too early",
  "Held loser too long",
  "Chased entry",
  "Position too big",
  "Averaged down",
  "Traded against trend",
  "Ignored setup rules",
  "Overtraded",
  "Traded on a tip/news",
];

const round = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const daysBetween = (a, b) => (a && b ? Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000) : null);

import { scoreChecklist, GRADE_ORDER, instrumentOf } from "@/lib/tradeChecklist";
import { legsOf, positionOf, legString } from "@/lib/tradeLegs";

/**
 * Adds computed figures to a trade. Works from its legs (adds and partial
 * exits, average-cost basis — lib/tradeLegs.js):
 *   Closed   the whole position is out; P&L is final
 *   Partial  some exited — that part is booked (realisedPnl), the rest is
 *            marked at `marks[symbol]` when there's a live price
 *   Open     nothing exited yet
 * Charges are booked in proportion to the quantity exited.
 */
export function enrich(t, marks = {}) {
  if (t.draft) return { ...t, status: "Draft" };
  const dir = t.side === "Short" ? -1 : 1;
  const legs = legsOf(t);
  const pos = positionOf(legs, t.side);
  const fees = t.fees ?? 0;
  const entered = pos.entered || t.quantity || 0;
  const avg = pos.entryAvg ?? t.entryPrice;
  const status = pos.status;
  const feeShare = (q) => (entered ? (fees * q) / entered : 0);
  const realisations = pos.realisations.map((r) => ({ date: r.date, qty: r.qty, pnl: round(r.gross - feeShare(r.qty)) }));
  const realisedPnl = pos.exited ? round(pos.realisedGross - feeShare(pos.exited)) : null;

  const mark = status === "Closed" ? null : marks[t.symbol] ?? null;
  const unrealised = mark != null && pos.openQty ? (mark - pos.openAvg) * pos.openQty * dir : null;
  let gross;
  if (status === "Closed") gross = pos.realisedGross;
  else if (unrealised != null) gross = pos.realisedGross + unrealised;
  else gross = null;
  const net = gross != null ? gross - fees : null;

  const riskPerUnit = t.stopLoss != null && avg ? Math.abs(avg - t.stopLoss) : null;
  const riskAmount = riskPerUnit ? riskPerUnit * entered : null;
  const rewardPerUnit = t.target != null && avg ? Math.abs(t.target - avg) : null;
  const q = scoreChecklist(t.checklist);
  return {
    ...t,
    legs,
    instrument: instrumentOf(t),
    quality: q ? { done: q.done, total: q.total, pct: q.pct, grade: q.grade.id } : null,
    status,
    invested: round(avg * entered),
    grossPnl: round(gross),
    netPnl: round(net),
    returnPct: net != null && avg ? round((net / (avg * entered)) * 100) : null,
    riskAmount: round(riskAmount),
    rMultiple: net != null && riskAmount ? round(net / riskAmount) : null,
    plannedRR: riskPerUnit && rewardPerUnit ? round(rewardPerUnit / riskPerUnit) : null,
    holdingDays: status === "Closed" ? daysBetween(pos.firstEntry ?? t.entryDate, pos.lastExit ?? t.exitDate ?? t.entryDate) : null,
    markPrice: mark,
    // Position detail
    openQty: pos.openQty,
    openAvg: pos.openAvg,
    exitedQty: pos.exited,
    exitAvg: pos.exitAvg,
    adds: pos.adds,
    exitsCount: pos.exitsCount,
    realisedPnl,
    realisations,
    // Money still in the trade at cost, and what the stop risks on it.
    exposure: pos.openQty ? round(pos.openQty * pos.openAvg) : 0,
    openRisk: pos.openQty && t.stopLoss != null ? round(Math.max(0, (pos.openAvg - t.stopLoss) * dir) * pos.openQty) : null,
  };
}

/** Booked P&L (after charges) in a calendar month "YYYY-MM", partial exits included, from every trade. */
export function realisedInMonth(enriched, ym) {
  let pnl = 0;
  let exits = 0;
  const trades = new Set();
  for (const t of enriched) {
    for (const r of t.realisations ?? []) {
      if (r.date?.slice(0, 7) !== ym) continue;
      pnl += r.pnl ?? 0;
      exits++;
      trades.add(t.id);
    }
  }
  return { pnl: round(pnl), exits, trades: trades.size };
}

/** Capital in open and partly-closed trades, at cost. */
export function openExposure(enriched) {
  const live = enriched.filter((t) => t.status === "Open" || t.status === "Partial");
  return { amount: round(live.reduce((a, t) => a + (t.exposure ?? 0), 0)), risk: round(live.reduce((a, t) => a + (t.openRisk ?? 0), 0)), trades: live.length };
}

function groupStats(trades, keyOf) {
  const groups = new Map();
  for (const t of trades) {
    for (const k of [].concat(keyOf(t) ?? [])) {
      if (k === null || k === undefined || k === "") continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
  }
  return [...groups.entries()]
    .map(([key, ts]) => {
      const wins = ts.filter((t) => t.netPnl > 0);
      const rs = ts.map((t) => t.rMultiple).filter((r) => r != null);
      return {
        key,
        trades: ts.length,
        winRate: round((wins.length / ts.length) * 100, 1),
        netPnl: round(ts.reduce((a, t) => a + t.netPnl, 0)),
        avgPnl: round(mean(ts.map((t) => t.netPnl))),
        avgR: round(mean(rs)),
      };
    })
    .sort((a, b) => b.netPnl - a.netPnl);
}

/**
 * Each checklist point (by its text): win rate when you ticked it vs when
 * you took the trade without it — which points actually earn their place.
 */
function checklistPoints(closed) {
  const m = new Map();
  for (const t of closed) {
    for (const p of t.checklist ?? []) {
      const g = m.get(p.text) ?? { key: p.text, ticked: [], missed: [] };
      (p.done ? g.ticked : g.missed).push(t);
      m.set(p.text, g);
    }
  }
  const win = (ts) => (ts.length ? round((ts.filter((t) => t.netPnl > 0).length / ts.length) * 100, 0) : null);
  const avg = (ts) => (ts.length ? round(mean(ts.map((t) => t.netPnl))) : null);
  return [...m.values()]
    .map((g) => ({
      key: g.key,
      ticked: g.ticked.length,
      missed: g.missed.length,
      winTicked: win(g.ticked),
      winMissed: win(g.missed),
      avgTicked: avg(g.ticked),
      avgMissed: avg(g.missed),
      edge: g.ticked.length && g.missed.length ? round(win(g.ticked) - win(g.missed), 0) : null,
    }))
    .sort((a, b) => (b.edge ?? -999) - (a.edge ?? -999) || b.ticked + b.missed - (a.ticked + a.missed));
}

/** Summary over CLOSED trades. */
export function computeStats(enriched) {
  const closed = enriched.filter((t) => t.status === "Closed" && t.netPnl != null).sort((a, b) => ((a.exitDate ?? a.entryDate) < (b.exitDate ?? b.entryDate) ? -1 : 1));
  const open = enriched.filter((t) => t.status === "Open" || t.status === "Partial");
  if (!closed.length) return { closed: 0, open: open.length };

  const wins = closed.filter((t) => t.netPnl > 0);
  const losses = closed.filter((t) => t.netPnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.netPnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.netPnl, 0);
  const avgWin = mean(wins.map((t) => t.netPnl));
  const avgLoss = mean(losses.map((t) => t.netPnl));
  const rs = closed.map((t) => t.rMultiple).filter((r) => r != null);

  // Equity curve and max drawdown, in exit order.
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  const curve = closed.map((t) => {
    equity += t.netPnl;
    peak = Math.max(peak, equity);
    maxDD = Math.min(maxDD, equity - peak);
    return { date: t.exitDate ?? t.entryDate, equity: round(equity), symbol: t.symbol };
  });

  // Streaks.
  let curStreak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  for (const t of closed) {
    const w = t.netPnl > 0;
    curStreak = w ? (curStreak > 0 ? curStreak + 1 : 1) : curStreak < 0 ? curStreak - 1 : -1;
    maxWinStreak = Math.max(maxWinStreak, curStreak);
    maxLossStreak = Math.min(maxLossStreak, curStreak);
  }

  const monthly = groupStats(closed, (t) => (t.exitDate ?? t.entryDate).slice(0, 7)).sort((a, b) => (a.key < b.key ? -1 : 1));
  const weekday = groupStats(closed, (t) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${t.entryDate}T00:00:00Z`).getUTCDay()]);

  return {
    closed: closed.length,
    open: open.length,
    netPnl: round(grossWin - grossLoss),
    fees: round(closed.reduce((a, t) => a + (t.fees ?? 0), 0)),
    winRate: round((wins.length / closed.length) * 100, 1),
    avgWin: round(avgWin),
    avgLoss: round(avgLoss),
    payoffRatio: avgWin != null && avgLoss ? round(avgWin / Math.abs(avgLoss)) : null,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    expectancy: round((grossWin - grossLoss) / closed.length),
    avgR: round(mean(rs)),
    rCoverage: round((rs.length / closed.length) * 100, 0),
    best: round(Math.max(...closed.map((t) => t.netPnl))),
    worst: round(Math.min(...closed.map((t) => t.netPnl))),
    maxDrawdown: round(maxDD),
    maxWinStreak,
    maxLossStreak: -maxLossStreak,
    currentStreak: curStreak,
    avgHoldWinners: round(mean(wins.map((t) => t.holdingDays).filter((d) => d != null)), 1),
    avgHoldLosers: round(mean(losses.map((t) => t.holdingDays).filter((d) => d != null)), 1),
    withStopPct: round((closed.filter((t) => t.stopLoss != null).length / closed.length) * 100, 0),
    curve,
    monthly,
    weekday,
    bySetup: groupStats(closed, (t) => t.setup || "(no setup)"),
    byMistake: groupStats(closed, (t) => (t.mistakes?.length ? t.mistakes : null)),
    byEmotion: groupStats(closed, (t) => t.emotions),
    bySide: groupStats(closed, (t) => t.side),
    bySegment: groupStats(closed, (t) => t.segment),
    byPlan: groupStats(closed, (t) => (t.followedPlan === true ? "Followed plan" : t.followedPlan === false ? "Broke plan" : null)),
    cleanVsMistake: groupStats(closed, (t) => (t.mistakes?.length ? "With a mistake" : "Clean trade")),
    byQuality: groupStats(closed, (t) => (t.quality ? `Grade ${t.quality.grade}` : null)).sort(
      (a, b) => GRADE_ORDER[a.key.slice(6)] - GRADE_ORDER[b.key.slice(6)]
    ),
    byPoint: checklistPoints(closed),
    scored: closed.filter((t) => t.quality).length,
    avgQualityPct: round(mean(closed.filter((t) => t.quality).map((t) => t.quality.pct)), 0),
  };
}

const inr = (n) => `₹${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;

/** Plain-English observations, most important first. */
export function insights(s) {
  if (!s?.closed) return [];
  const out = [];
  if (s.closed < 20) out.push({ tone: "info", text: `Only ${s.closed} closed trades so far — patterns below get reliable after 30–50.` });

  if (s.expectancy != null)
    out.push(
      s.expectancy > 0
        ? { tone: "good", text: `Positive expectancy: on average each trade made ${inr(s.expectancy)} after fees.` }
        : { tone: "bad", text: `Negative expectancy: each trade loses ${inr(s.expectancy)} on average. Fix the size of losses before adding trades.` }
    );

  if (s.payoffRatio != null && s.winRate != null) {
    const breakEvenWin = (1 / (1 + s.payoffRatio)) * 100;
    out.push({
      tone: s.winRate >= breakEvenWin ? "good" : "bad",
      text: `With an average win ${s.payoffRatio}× the average loss, you need a ${breakEvenWin.toFixed(0)}% win rate to break even — you're at ${s.winRate}%.`,
    });
  }

  if (s.avgHoldLosers != null && s.avgHoldWinners != null && s.avgHoldLosers > s.avgHoldWinners * 1.3)
    out.push({ tone: "bad", text: `Losers are held ${s.avgHoldLosers} days vs ${s.avgHoldWinners} for winners — cutting losses sooner is the quickest win.` });

  if (s.withStopPct != null && s.withStopPct < 90)
    out.push({ tone: "bad", text: `${100 - s.withStopPct}% of trades had no stop-loss recorded. Without one there's no R-multiple and no defined risk.` });

  const worstMistake = s.byMistake?.slice().sort((a, b) => a.netPnl - b.netPnl)[0];
  if (worstMistake && worstMistake.netPnl < 0)
    out.push({ tone: "bad", text: `Biggest leak: "${worstMistake.key}" — ${worstMistake.trades} trades, ${inr(worstMistake.netPnl)} lost.` });

  const plan = Object.fromEntries((s.byPlan ?? []).map((g) => [g.key, g]));
  if (plan["Followed plan"] && plan["Broke plan"])
    out.push({
      tone: plan["Followed plan"].avgPnl > plan["Broke plan"].avgPnl ? "good" : "info",
      text: `Following your plan averages ${inr(plan["Followed plan"].avgPnl)}${plan["Followed plan"].avgPnl < 0 ? " loss" : ""} per trade vs ${inr(plan["Broke plan"].avgPnl)}${plan["Broke plan"].avgPnl < 0 ? " loss" : ""} when you break it.`,
    });

  const setups = (s.bySetup ?? []).filter((g) => g.trades >= 3);
  if (setups.length >= 2) {
    const best = setups[0];
    const worst = setups[setups.length - 1];
    out.push({ tone: "good", text: `Best setup: "${best.key}" (${best.trades} trades, ${best.winRate}% wins, ${inr(best.netPnl)} net).` });
    if (worst.netPnl < 0) out.push({ tone: "bad", text: `Weakest setup: "${worst.key}" lost ${inr(worst.netPnl)} over ${worst.trades} trades — consider dropping or fixing it.` });
  }

  const emo = (s.byEmotion ?? []).filter((g) => g.trades >= 3).sort((a, b) => a.avgPnl - b.avgPnl)[0];
  if (emo && emo.avgPnl < 0) out.push({ tone: "bad", text: `Trades tagged "${emo.key}" average a ${inr(emo.avgPnl)} loss.` });

  const qual = Object.fromEntries((s.byQuality ?? []).map((g) => [g.key, g]));
  const merge = (keys) => {
    const gs = keys.map((k) => qual[k]).filter(Boolean);
    const n = gs.reduce((a, g) => a + g.trades, 0);
    return n ? { n, avgPnl: gs.reduce((a, g) => a + g.avgPnl * g.trades, 0) / n, win: gs.reduce((a, g) => a + g.winRate * g.trades, 0) / n } : null;
  };
  const high = merge(["Grade A+", "Grade A"]);
  const low = merge(["Grade C", "Grade D"]);
  if (high && low && high.n >= 2 && low.n >= 2)
    out.push({
      tone: high.avgPnl > low.avgPnl ? "good" : "info",
      text: `${high.avgPnl > low.avgPnl ? "Your checklist is paying off" : "Your checklist isn't separating winners from losers yet"}: A-grade trades win ${Math.round(high.win)}% and average ${high.avgPnl < 0 ? "−" : ""}${inr(high.avgPnl)}; C/D-grade trades win ${Math.round(low.win)}% and average ${low.avgPnl < 0 ? "−" : ""}${inr(low.avgPnl)}.`,
    });
  const key = (s.byPoint ?? []).filter((p) => p.ticked >= 3 && p.missed >= 3 && p.edge >= 15)[0];
  if (key) out.push({ tone: "good", text: `"${key.key}" matters most: ${key.winTicked}% wins when ticked vs ${key.winMissed}% when skipped.` });

  if (s.maxLossStreak >= 4) out.push({ tone: "info", text: `Longest losing streak: ${s.maxLossStreak}. A daily/weekly loss limit protects you during these.` });
  return out;
}

// ---------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------

export const EXPORT_COLUMNS = [
  "id", "status", "entryDate", "exitDate", "symbol", "segment", "side", "quantity", "entryPrice", "exitPrice", "stopLoss",
  "target", "fees", "invested", "grossPnl", "netPnl", "returnPct", "riskAmount", "rMultiple", "plannedRR", "holdingDays",
  "setup", "timeframe", "confidence", "followedPlan", "emotions", "mistakes", "entryReason", "exitReason", "lessons", "screenshotUrl",
  "quickNotes", "draft", "checklistGrade", "checklistScore", "checklistDone", "checklistMissed",
  "instrument", "legs", "openQty", "realisedPnl",
];

export function exportRows(enriched) {
  return enriched.map((t) => ({
    ...t,
    emotions: (t.emotions ?? []).join("; "),
    mistakes: (t.mistakes ?? []).join("; "),
    followedPlan: t.followedPlan === true ? "Yes" : t.followedPlan === false ? "No" : "",
    quickNotes: (t.quickNotes ?? []).map((n) => `[${String(n.at).slice(0, 16).replace("T", " ")}] ${n.text}`).join(" | "),
    draft: t.draft ? "Yes" : "",
    legs: legString(t.legs ?? []),
    checklistGrade: t.quality?.grade ?? "",
    checklistScore: t.quality ? `${t.quality.done}/${t.quality.total} (${t.quality.pct}%)` : "",
    checklistDone: (t.checklist ?? []).filter((p) => p.done).map((p) => p.text).join("; "),
    checklistMissed: (t.checklist ?? []).filter((p) => !p.done).map((p) => p.text).join("; "),
  }));
}

function mdTable(rows, cols) {
  if (!rows?.length) return "_none_\n";
  return [
    `| ${cols.map((c) => c[1]).join(" | ")} |`,
    `| ${cols.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${cols.map((c) => String(r[c[0]] ?? "").replace(/\|/g, "/").replace(/\n/g, " ")).join(" | ")} |`),
  ].join("\n") + "\n";
}

/** Markdown file to paste/upload into an AI assistant for a review. */
export function aiReviewPack(enriched, stats, { from, to } = {}) {
  const groupCols = [["key", "Group"], ["trades", "Trades"], ["winRate", "Win %"], ["netPnl", "Net ₹"], ["avgPnl", "Avg ₹"], ["avgR", "Avg R"]];
  const tradeCols = [
    ["entryDate", "Entry"], ["exitDate", "Exit"], ["symbol", "Symbol"], ["segment", "Segment"], ["side", "Side"], ["quantity", "Qty"],
    ["entryPrice", "Entry ₹"], ["exitPrice", "Exit ₹"], ["stopLoss", "Stop"], ["target", "Target"], ["netPnl", "Net ₹"],
    ["rMultiple", "R"], ["holdingDays", "Days"], ["setup", "Setup"], ["followedPlan", "Plan?"], ["emotions", "Emotions"],
    ["mistakes", "Mistakes"], ["entryReason", "Why entered"], ["exitReason", "Why exited"], ["lessons", "Lesson"],
    ["quickNotes", "Notes written at the time"],
  ];
  const s = stats ?? {};
  return `# My trading journal — review request

You are an experienced trading coach reviewing an Indian-market (NSE) trader's journal. Using the data below:

1. Identify my 3 biggest weaknesses, with evidence (specific numbers and trades).
2. Identify what I do well and should do more of.
3. Check risk management: stop-loss use, position sizing, losers vs winners, R-multiples, drawdown.
4. Look for behavioural patterns — emotions, broken plans, time of week, overtrading after losses.
5. Give me 5 specific, measurable rules to follow for the next 30 trades.
Be direct. If the sample is too small to conclude something, say so.

Period: ${from ?? "all"} to ${to ?? "today"} · exported ${new Date().toISOString().slice(0, 10)}

## Summary (closed trades)
| Metric | Value |
| --- | --- |
| Closed trades | ${s.closed ?? 0} (open: ${s.open ?? 0}) |
| Net P&L | ₹${s.netPnl ?? 0} (fees ₹${s.fees ?? 0}) |
| Win rate | ${s.winRate ?? "—"}% |
| Average win / loss | ₹${s.avgWin ?? "—"} / ₹${s.avgLoss ?? "—"} (payoff ${s.payoffRatio ?? "—"}) |
| Profit factor | ${s.profitFactor ?? "—"} |
| Expectancy per trade | ₹${s.expectancy ?? "—"} |
| Average R | ${s.avgR ?? "—"} (R known for ${s.rCoverage ?? 0}% of trades) |
| Best / worst trade | ₹${s.best ?? "—"} / ₹${s.worst ?? "—"} |
| Max drawdown | ₹${s.maxDrawdown ?? "—"} |
| Longest win / loss streak | ${s.maxWinStreak ?? "—"} / ${s.maxLossStreak ?? "—"} |
| Avg days held — winners / losers | ${s.avgHoldWinners ?? "—"} / ${s.avgHoldLosers ?? "—"} |
| Trades with a stop-loss | ${s.withStopPct ?? "—"}% |

## Automatic observations
${insights(s).map((i) => `- ${i.text}`).join("\n") || "_none_"}

## By setup
${mdTable(s.bySetup, groupCols)}
## By mistake
${mdTable(s.byMistake, groupCols)}
## Plan adherence
${mdTable(s.byPlan, groupCols)}
## By checklist quality (share of checklist points ticked: A+ ≥90%, A ≥75%, B ≥60%, C ≥40%, D below)
${mdTable(s.byQuality, groupCols)}
## Checklist points — win rate when ticked vs skipped
${mdTable(s.byPoint, [["key", "Point"], ["ticked", "Ticked"], ["winTicked", "Win % ticked"], ["missed", "Skipped"], ["winMissed", "Win % skipped"], ["edge", "Edge (pts)"]])}
## By emotion
${mdTable(s.byEmotion, groupCols)}
## By side
${mdTable(s.bySide, groupCols)}
## By segment
${mdTable(s.bySegment, groupCols)}
## By weekday
${mdTable(s.weekday, groupCols)}
## Monthly
${mdTable(s.monthly, groupCols)}
## All trades
${mdTable(exportRows(enriched.filter((t) => !t.draft)), tradeCols)}`;
}
