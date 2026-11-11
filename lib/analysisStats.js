// Scorecard for the Analysis tab — how good the analysis has been, from
// the grades the server attaches (lib/analysis.js): bias accuracy, idea
// hit rate, which setups and directions work, consistency. Plus the
// exports (rows for CSV / Excel, and the AI review pack).

const r1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export const INDEX_LABELS = { nifty: "NIFTY 50", bankNifty: "BANK NIFTY" };
const DONE = new Set(["Target hit", "Stop hit", "Time exit"]);

export function ideaWon(o) {
  if (!o) return null;
  if (o.status === "Target hit") return true;
  if (o.status === "Stop hit") return false;
  if (o.status === "Time exit") return o.returnPct > 0;
  return null;
}

function groupIdeas(ideas, keyOf) {
  const m = new Map();
  for (const i of ideas) {
    const k = keyOf(i) || "(none)";
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(i);
  }
  return [...m.entries()]
    .map(([k, xs]) => {
      const closed = xs.filter((i) => DONE.has(i.outcome?.status));
      const wins = closed.filter((i) => ideaWon(i.outcome));
      const rets = closed.map((i) => i.outcome.returnPct).filter((v) => v != null);
      return {
        key: k,
        ideas: xs.length,
        resolved: closed.length,
        winRate: closed.length ? r1((wins.length / closed.length) * 100) : null,
        avgReturnPct: r2(mean(rets)),
      };
    })
    .sort((a, b) => b.resolved - a.resolved || (b.winRate ?? 0) - (a.winRate ?? 0));
}

// ---------------------------------------------------------------------
// Stock studies
// ---------------------------------------------------------------------

function groupStudies(studies, keyOf) {
  const m = new Map();
  for (const st of studies) {
    for (const k of [].concat(keyOf(st) ?? [])) {
      if (k === null || k === undefined || k === "") continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(st);
    }
  }
  return [...m.entries()]
    .map(([key, xs]) => {
      const graded = xs.filter((x) => x.verdictGrade?.correct != null);
      const moves = xs.map((x) => x.verdictGrade?.move10).filter((v) => v != null);
      return {
        key,
        studies: xs.length,
        graded: graded.length,
        accuracy: graded.length ? r1((graded.filter((x) => x.verdictGrade.correct).length / graded.length) * 100) : null,
        avgMove10: r2(mean(moves)),
      };
    })
    .sort((a, b) => b.graded - a.graded || (b.accuracy ?? 0) - (a.accuracy ?? 0));
}

export function studyScorecard(entries) {
  const studies = entries.flatMap((e) => (e.studies ?? []).map((st) => ({ ...st, date: e.date })));
  const graded = studies.filter((x) => x.verdictGrade?.correct != null);
  const plans = studies.filter((x) => DONE.has(x.planOutcome?.status));
  return {
    total: studies.length,
    stocks: new Set(studies.map((x) => x.symbol)).size,
    graded: graded.length,
    accuracy: graded.length ? r1((graded.filter((x) => x.verdictGrade.correct).length / graded.length) * 100) : null,
    planWinRate: plans.length ? r1((plans.filter((x) => ideaWon(x.planOutcome)).length / plans.length) * 100) : null,
    plansResolved: plans.length,
    byVerdict: groupStudies(studies, (x) => x.verdict),
    byPattern: groupStudies(studies, (x) => (x.patterns?.length ? x.patterns : null)),
    byStage: groupStudies(studies, (x) => (x.stage ? `Stage ${x.stage}` : null)),
    byConviction: groupStudies(studies, (x) => `Conviction ${x.conviction}`).sort((a, b) => (a.key < b.key ? -1 : 1)),
    byAlignment: groupStudies(studies, (x) => {
      const t = Object.values(x.timeframes ?? {}).map((v) => v.trend).filter(Boolean);
      if (t.length < 2) return null;
      return t.every((v) => v === t[0]) ? "Timeframes aligned" : "Timeframes mixed";
    }),
  };
}

export function studyInsights(ss) {
  const out = [];
  if (ss.graded >= 5) {
    out.push({ tone: ss.accuracy >= 55 ? "good" : ss.accuracy < 45 ? "bad" : "info", text: `Stock-study verdicts right ${ss.accuracy}% of ${ss.graded} graded studies at their horizon.` });
  }
  const conv = ss.byConviction.filter((g) => g.graded >= 3);
  if (conv.length >= 2) {
    const lo = conv[0];
    const hi = conv[conv.length - 1];
    if (hi.accuracy != null && lo.accuracy != null && hi.accuracy <= lo.accuracy)
      out.push({ tone: "bad", text: `Your high-conviction studies (${hi.key}) aren't more accurate (${hi.accuracy}%) than low ones (${lo.key}, ${lo.accuracy}%) — conviction isn't calibrated yet.` });
  }
  const align = Object.fromEntries(ss.byAlignment.map((g) => [g.key, g]));
  if (align["Timeframes aligned"]?.graded >= 3 && align["Timeframes mixed"]?.graded >= 3) {
    out.push({
      tone: "info",
      text: `When your timeframes agree, verdicts are right ${align["Timeframes aligned"].accuracy}%; when they're mixed, ${align["Timeframes mixed"].accuracy}%.`,
    });
  }
  const pats = ss.byPattern.filter((g) => g.graded >= 3);
  if (pats.length >= 2) {
    const best = [...pats].sort((a, b) => b.accuracy - a.accuracy)[0];
    out.push({ tone: "good", text: `Most reliable pattern in your studies: ${best.key} (${best.accuracy}% of ${best.graded}).` });
  }
  return out;
}

export const STUDY_COLUMNS = [
  "date", "symbol", "verdict", "conviction", "horizonDays", "stage", "monthlyTrend", "weeklyTrend", "dailyTrend", "intradayTrend",
  "patterns", "candle", "supports", "resistances", "indicators", "volume", "relativeStrength", "planDirection", "planEntry",
  "planStop", "planTarget", "notes", "chartUrl", "priceAtStudy", "move5Pct", "move10Pct", "move20Pct", "verdictCorrect",
  "planOutcome", "planReturnPct", "autoRsiDaily", "autoRsiWeekly", "autoStage", "autoRs3mVsNifty", "autoDeliveryPct",
];

export function studyRows(entries) {
  return entries.flatMap((e) =>
    (e.studies ?? []).map((st) => ({
      date: e.date,
      symbol: st.symbol,
      verdict: st.verdict,
      conviction: st.conviction,
      horizonDays: st.horizonDays,
      stage: st.stage ?? "",
      monthlyTrend: st.timeframes?.Monthly?.trend ?? "",
      weeklyTrend: st.timeframes?.Weekly?.trend ?? "",
      dailyTrend: st.timeframes?.Daily?.trend ?? "",
      intradayTrend: st.timeframes?.Intraday?.trend ?? "",
      patterns: (st.patterns ?? []).join("; "),
      candle: st.candle,
      supports: (st.supports ?? []).join("; "),
      resistances: (st.resistances ?? []).join("; "),
      indicators: st.indicators,
      volume: st.volume,
      relativeStrength: st.relativeStrength,
      planDirection: st.plan?.direction ?? "",
      planEntry: st.plan?.entry ?? "",
      planStop: st.plan?.stop ?? "",
      planTarget: st.plan?.target ?? "",
      notes: st.notes,
      chartUrl: st.chartUrl,
      priceAtStudy: st.verdictGrade?.priceAtStudy ?? "",
      move5Pct: st.verdictGrade?.move5 ?? "",
      move10Pct: st.verdictGrade?.move10 ?? "",
      move20Pct: st.verdictGrade?.move20 ?? "",
      verdictCorrect: st.verdictGrade?.correct == null ? "" : st.verdictGrade.correct ? "Yes" : "No",
      planOutcome: st.planOutcome?.status ?? "",
      planReturnPct: st.planOutcome?.returnPct ?? "",
      autoRsiDaily: st.auto?.rsiDaily ?? "",
      autoRsiWeekly: st.auto?.rsiWeekly ?? "",
      autoStage: st.auto?.stage ?? "",
      autoRs3mVsNifty: st.auto?.rs3mVsNifty ?? "",
      autoDeliveryPct: st.auto?.deliveryPct ?? "",
    }))
  );
}

export function scorecard(entries, checklistItems = []) {
  const bias = {};
  for (const id of Object.keys(INDEX_LABELS)) {
    const graded = entries.map((e) => e.biasGrade?.[id]).filter((g) => g && g.correct1 != null);
    const g5 = entries.map((e) => e.biasGrade?.[id]).filter((g) => g && g.correct5 != null);
    const byBias = {};
    for (const b of ["Bullish", "Bearish", "Neutral"]) {
      const xs = graded.filter((g) => g.bias === b);
      byBias[b] = xs.length ? { calls: xs.length, accuracy: r1((xs.filter((g) => g.correct1).length / xs.length) * 100) } : null;
    }
    bias[id] = {
      calls: graded.length,
      accuracyNextDay: graded.length ? r1((graded.filter((g) => g.correct1).length / graded.length) * 100) : null,
      accuracy5Day: g5.length ? r1((g5.filter((g) => g.correct5).length / g5.length) * 100) : null,
      byBias,
    };
  }

  const ideas = entries.flatMap((e) => e.ideas.map((i) => ({ ...i, date: e.date })));
  const triggered = ideas.filter((i) => i.outcome && !["Waiting", "Not triggered"].includes(i.outcome.status));
  const expiredUntriggered = ideas.filter((i) => i.outcome?.status === "Not triggered");
  const resolved = ideas.filter((i) => DONE.has(i.outcome?.status));
  const wins = resolved.filter((i) => ideaWon(i.outcome));
  const rs = resolved.map((i) => i.outcome.r).filter((v) => v != null);
  const rets = resolved.map((i) => i.outcome.returnPct).filter((v) => v != null);
  const withStop = ideas.filter((i) => i.stop != null);

  const checklistRates = checklistItems.map((item) => {
    const xs = entries.filter((e) => e.checklist && item in e.checklist);
    return { item, rate: entries.length ? r1((entries.filter((e) => e.checklist?.[item]).length / entries.length) * 100) : null, tracked: xs.length };
  });

  // Consistency: entries in the last 30 calendar days, and the current streak of
  // consecutive weekday entries.
  const dates = new Set(entries.map((e) => e.date));
  const today = new Date();
  let last30 = 0;
  for (let d = 0; d < 30; d++) {
    const x = new Date(today);
    x.setDate(x.getDate() - d);
    if (dates.has(x.toISOString().slice(0, 10))) last30++;
  }
  let streak = 0;
  for (let d = 0; d < 400; d++) {
    const x = new Date(today);
    x.setDate(x.getDate() - d);
    const wd = x.getDay();
    if (wd === 0 || wd === 6) continue;
    if (dates.has(x.toISOString().slice(0, 10))) streak++;
    else if (d > 0) break;
  }

  return {
    days: entries.length,
    last30Days: last30,
    streak,
    avgRating: r1(mean(entries.map((e) => e.rating).filter((v) => v != null))),
    bias,
    ideas: {
      total: ideas.length,
      triggered: triggered.length,
      triggerRate: ideas.length ? r1(((triggered.length) / Math.max(1, triggered.length + expiredUntriggered.length)) * 100) : null,
      resolved: resolved.length,
      winRate: resolved.length ? r1((wins.length / resolved.length) * 100) : null,
      avgReturnPct: r2(mean(rets)),
      avgR: r2(mean(rs)),
      withStopPct: ideas.length ? r1((withStop.length / ideas.length) * 100) : null,
      open: ideas.filter((i) => i.outcome?.status === "Open").length,
      waiting: ideas.filter((i) => i.outcome?.status === "Waiting").length,
    },
    bySetup: groupIdeas(ideas, (i) => i.setup),
    byDirection: groupIdeas(ideas, (i) => i.direction),
    byTimeframe: groupIdeas(ideas, (i) => i.timeframe),
    checklistRates,
    studies: studyScorecard(entries),
  };
}

export function insights(s) {
  const out = [];
  if (!s.days) return out;
  for (const [id, b] of Object.entries(s.bias)) {
    if (b.calls >= 5) {
      out.push({
        tone: b.accuracyNextDay >= 55 ? "good" : b.accuracyNextDay < 45 ? "bad" : "info",
        text: `${INDEX_LABELS[id]} bias right ${b.accuracyNextDay}% of ${b.calls} calls next session${b.accuracy5Day != null ? ` (${b.accuracy5Day}% over 5 sessions)` : ""}.`,
      });
      const worst = Object.entries(b.byBias).filter(([, v]) => v && v.calls >= 3).sort((a, c) => a[1].accuracy - c[1].accuracy)[0];
      if (worst && worst[1].accuracy < 45) out.push({ tone: "bad", text: `Your ${worst[0].toLowerCase()} ${INDEX_LABELS[id]} calls are right only ${worst[1].accuracy}% of the time.` });
    }
  }
  if (s.ideas.resolved >= 5) {
    out.push({
      tone: s.ideas.winRate >= 50 ? "good" : "bad",
      text: `Ideas: ${s.ideas.winRate}% reached target before stop (${s.ideas.resolved} resolved), average ${s.ideas.avgReturnPct >= 0 ? "+" : ""}${s.ideas.avgReturnPct}% per idea${s.ideas.avgR != null ? `, ${s.ideas.avgR}R` : ""}.`,
    });
  }
  if (s.ideas.triggerRate != null && s.ideas.total >= 8 && s.ideas.triggerRate < 40)
    out.push({ tone: "info", text: `Only ${s.ideas.triggerRate}% of your ideas trigger — trigger levels may be too far from price.` });
  if (s.ideas.withStopPct != null && s.ideas.total >= 5 && s.ideas.withStopPct < 80)
    out.push({ tone: "bad", text: `${r1(100 - s.ideas.withStopPct)}% of ideas have no stop — they can't be graded on risk.` });
  const setups = s.bySetup.filter((g) => g.resolved >= 3 && g.key !== "(none)");
  if (setups.length >= 2) {
    const best = [...setups].sort((a, b) => b.winRate - a.winRate)[0];
    const worst = [...setups].sort((a, b) => a.winRate - b.winRate)[0];
    out.push({ tone: "good", text: `Strongest setup in your analysis: "${best.key}" — ${best.winRate}% of ${best.resolved} resolved.` });
    if (worst.key !== best.key && worst.winRate < 45) out.push({ tone: "bad", text: `Weakest: "${worst.key}" — ${worst.winRate}% of ${worst.resolved}.` });
  }
  out.push(...studyInsights(s.studies));
  if (s.last30Days < 10) out.push({ tone: "info", text: `${s.last30Days} entries in the last 30 days — daily consistency is what makes this scorecard reliable.` });
  return out;
}

// ---------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------

export const DAY_COLUMNS = [
  "date", "niftyBias", "niftyNextDayMovePct", "niftyBiasCorrect", "bankNiftyBias", "bankNiftyNextDayMovePct", "bankNiftyBiasCorrect",
  "confidence", "niftySupport", "niftyResistance", "bankNiftySupport", "bankNiftyResistance", "context", "sectorsInFocus",
  "themesInFocus", "events", "ideasCount", "studiesCount", "checklistDone", "review", "worked", "missed", "lessons", "mood", "rating",
  "snapNiftyChangePct", "snapAdvances", "snapDeclines",
];
export const IDEA_COLUMNS = [
  "date", "symbol", "direction", "setup", "timeframe", "entry", "stop", "target", "horizonDays", "thesis",
  "outcome", "fill", "exit", "exitDate", "returnPct", "r", "sessions",
];

export function dayRows(entries) {
  return entries.map((e) => ({
    date: e.date,
    niftyBias: e.bias?.nifty ?? "",
    niftyNextDayMovePct: e.biasGrade?.nifty?.move1 ?? "",
    niftyBiasCorrect: e.biasGrade?.nifty?.correct1 == null ? "" : e.biasGrade.nifty.correct1 ? "Yes" : "No",
    bankNiftyBias: e.bias?.bankNifty ?? "",
    bankNiftyNextDayMovePct: e.biasGrade?.bankNifty?.move1 ?? "",
    bankNiftyBiasCorrect: e.biasGrade?.bankNifty?.correct1 == null ? "" : e.biasGrade.bankNifty.correct1 ? "Yes" : "No",
    confidence: e.confidence,
    niftySupport: e.levels?.nifty?.support ?? "",
    niftyResistance: e.levels?.nifty?.resistance ?? "",
    bankNiftySupport: e.levels?.bankNifty?.support ?? "",
    bankNiftyResistance: e.levels?.bankNifty?.resistance ?? "",
    context: e.context,
    sectorsInFocus: (e.sectorsInFocus ?? []).join("; "),
    themesInFocus: (e.themesInFocus ?? []).join("; "),
    events: e.events,
    ideasCount: e.ideas.length,
    studiesCount: (e.studies ?? []).length,
    checklistDone: `${Object.values(e.checklist ?? {}).filter(Boolean).length}/${Object.keys(e.checklist ?? {}).length}`,
    review: e.review,
    worked: e.worked,
    missed: e.missed,
    lessons: e.lessons,
    mood: (e.mood ?? []).join("; "),
    rating: e.rating ?? "",
    snapNiftyChangePct: e.snapshot?.indexes?.find((x) => x.id === "nifty")?.change ?? "",
    snapAdvances: e.snapshot?.breadth?.advances ?? "",
    snapDeclines: e.snapshot?.breadth?.declines ?? "",
  }));
}

export function ideaRows(entries) {
  return entries.flatMap((e) =>
    e.ideas.map((i) => ({
      date: e.date,
      ...i,
      outcome: i.outcome?.status ?? "",
      fill: i.outcome?.fill ?? "",
      exit: i.outcome?.exit ?? "",
      exitDate: i.outcome?.exitDate ?? "",
      returnPct: i.outcome?.returnPct ?? "",
      r: i.outcome?.r ?? "",
      sessions: i.outcome?.sessions ?? "",
    }))
  );
}

function mdTable(rows, cols) {
  if (!rows?.length) return "_none_\n";
  return (
    [
      `| ${cols.map((c) => c[1]).join(" | ")} |`,
      `| ${cols.map(() => "---").join(" | ")} |`,
      ...rows.map((r) => `| ${cols.map((c) => String(r[c[0]] ?? "").replace(/\|/g, "/").replace(/\n/g, " ")).join(" | ")} |`),
    ].join("\n") + "\n"
  );
}

export function aiReviewPack(entries, s) {
  const days = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
  const groupCols = [["key", "Group"], ["ideas", "Ideas"], ["resolved", "Resolved"], ["winRate", "Win %"], ["avgReturnPct", "Avg %"]];
  const studyCols = [["key", "Group"], ["studies", "Studies"], ["graded", "Graded"], ["accuracy", "Right %"], ["avgMove10", "Avg 10-session move %"]];
  const studyBlocks = days
    .flatMap((e) =>
      (e.studies ?? []).map(
        (st) => `### ${st.symbol} — ${e.date} — ${st.verdict || "no verdict"} (conviction ${st.conviction}/5, horizon ${st.horizonDays} sessions)
- Timeframes: ${Object.entries(st.timeframes ?? {}).map(([k, v]) => `${k} ${v.trend || "—"}${v.note ? ` (${v.note})` : ""}`).join("; ") || "—"} · Stage ${st.stage ?? "—"}
- Patterns: ${(st.patterns ?? []).join(", ") || "—"} · Candle: ${st.candle || "—"}
- Support ${(st.supports ?? []).join(", ") || "—"} · Resistance ${(st.resistances ?? []).join(", ") || "—"}
- Indicators: ${st.indicators || "—"} · Volume/delivery: ${st.volume || "—"} · RS: ${st.relativeStrength || "—"}
- Panel readings then: ${st.auto ? `RSI ${st.auto.rsiDaily}/${st.auto.rsiWeekly}w, stage ${st.auto.stage}, RS3m ${st.auto.rs3mVsNifty}, deliv ${st.auto.deliveryPct}%, from 52w high ${st.auto.fromHigh52Pct}%` : "—"}
- Plan: ${st.plan?.entry || st.plan?.stop || st.plan?.target ? `${st.plan.direction} ${st.plan.entry ?? "mkt"} SL ${st.plan.stop ?? "—"} T ${st.plan.target ?? "—"} → ${st.planOutcome?.status ?? "?"}${st.planOutcome?.returnPct != null ? ` ${st.planOutcome.returnPct}%` : ""}` : "—"}
- Result: ${st.verdictGrade ? `from ₹${st.verdictGrade.priceAtStudy}: 5 sessions ${st.verdictGrade.move5 ?? "—"}%, 10 ${st.verdictGrade.move10 ?? "—"}%, 20 ${st.verdictGrade.move20 ?? "—"}% → ${st.verdictGrade.correct == null ? "not graded yet" : st.verdictGrade.correct ? "verdict right" : "verdict wrong"}` : "—"}
- Notes: ${st.notes || "—"}`
      )
    )
    .join("\n\n");
  const perDay = days
    .map(
      (e) => `### ${e.date}
- Bias: NIFTY **${e.bias?.nifty || "—"}**${e.biasGrade?.nifty?.move1 != null ? ` (next day ${e.biasGrade.nifty.move1}% → ${e.biasGrade.nifty.correct1 ? "right" : "wrong"})` : ""} · BANK NIFTY **${e.bias?.bankNifty || "—"}**${e.biasGrade?.bankNifty?.move1 != null ? ` (next day ${e.biasGrade.bankNifty.move1}% → ${e.biasGrade.bankNifty.correct1 ? "right" : "wrong"})` : ""} · confidence ${e.confidence}/5
- Levels: NIFTY S ${e.levels?.nifty?.support ?? "—"} / R ${e.levels?.nifty?.resistance ?? "—"}; BANK NIFTY S ${e.levels?.bankNifty?.support ?? "—"} / R ${e.levels?.bankNifty?.resistance ?? "—"}
- Market that day: ${e.snapshot?.indexes?.map((x) => `${x.label} ${x.change ?? "—"}%`).join(", ") ?? "—"}; breadth ${e.snapshot?.breadth ? `${e.snapshot.breadth.advances} up / ${e.snapshot.breadth.declines} down` : "—"}
- Focus: sectors ${(e.sectorsInFocus ?? []).join(", ") || "—"}; themes ${(e.themesInFocus ?? []).join(", ") || "—"}
- Context: ${e.context || "—"}
- Ideas: ${e.ideas.map((i) => `${i.direction} ${i.symbol}${i.entry ? ` above/below ${i.entry}` : ""}${i.stop ? ` SL ${i.stop}` : ""}${i.target ? ` T ${i.target}` : ""} [${i.setup || "no setup"}] → ${i.outcome?.status ?? "?"}${i.outcome?.returnPct != null ? ` ${i.outcome.returnPct}%` : ""}`).join("; ") || "none"}
- Review: ${e.review || "—"} · Worked: ${e.worked || "—"} · Missed: ${e.missed || "—"} · Lesson: ${e.lessons || "—"} · Self-rating ${e.rating ?? "—"}/5`
    )
    .join("\n\n");

  return `# My daily market analysis — review request

You are an experienced market analyst and trading coach reviewing an Indian-market (NSE) trader's DAILY ANALYSIS journal — their market bias, levels and trade ideas, written before and after each session, and graded automatically against what prices did next. Using the data below:

1. How accurate is my market bias (NIFTY / BANK NIFTY)? Am I systematically too bullish or bearish? In what conditions am I wrong?
2. Evaluate my trade ideas: which setups, directions and timeframes work, trigger placement, stop and target placement.
3. Do my support / resistance levels and sector/theme focus line up with what actually moved?
4. Review my stock studies (technical analysis of individual stocks): which timeframes, patterns, stages and indicators lead me to right vs wrong verdicts, and is my conviction calibrated?
5. What patterns show in my reviews and lessons — what do I keep missing?
6. Give me a concrete, step-by-step daily analysis routine and 5 rules to improve over the next 20 sessions.
Be specific and use the numbers. Call out where the sample is too small.

Exported ${new Date().toISOString().slice(0, 10)} · ${s.days} days of analysis

## Scorecard
| Metric | Value |
| --- | --- |
| Days analysed | ${s.days} (${s.last30Days} in the last 30 days, current streak ${s.streak}) |
| NIFTY bias accuracy | ${s.bias.nifty.accuracyNextDay ?? "—"}% next session (${s.bias.nifty.calls} calls), ${s.bias.nifty.accuracy5Day ?? "—"}% over 5 sessions |
| BANK NIFTY bias accuracy | ${s.bias.bankNifty.accuracyNextDay ?? "—"}% next session (${s.bias.bankNifty.calls} calls), ${s.bias.bankNifty.accuracy5Day ?? "—"}% over 5 sessions |
| Ideas | ${s.ideas.total} total, ${s.ideas.triggered} triggered (${s.ideas.triggerRate ?? "—"}%), ${s.ideas.resolved} resolved |
| Idea win rate (target before stop) | ${s.ideas.winRate ?? "—"}% |
| Average idea return / R | ${s.ideas.avgReturnPct ?? "—"}% / ${s.ideas.avgR ?? "—"}R |
| Ideas with a stop | ${s.ideas.withStopPct ?? "—"}% |
| Average self-rating | ${s.avgRating ?? "—"}/5 |
| Stock studies | ${s.studies.total} on ${s.studies.stocks} stocks; verdict right ${s.studies.accuracy ?? "—"}% of ${s.studies.graded} graded; plans won ${s.studies.planWinRate ?? "—"}% of ${s.studies.plansResolved} |

## Automatic observations
${insights(s).map((i) => `- ${i.text}`).join("\n") || "_none_"}

## Ideas by setup
${mdTable(s.bySetup, groupCols)}
## Ideas by direction
${mdTable(s.byDirection, groupCols)}
## Ideas by timeframe
${mdTable(s.byTimeframe, groupCols)}
## Stock studies by verdict
${mdTable(s.studies.byVerdict, studyCols)}
## Stock studies by pattern
${mdTable(s.studies.byPattern, studyCols)}
## Stock studies by stage
${mdTable(s.studies.byStage, studyCols)}
## Stock studies by conviction
${mdTable(s.studies.byConviction, studyCols)}
## Timeframe alignment
${mdTable(s.studies.byAlignment, studyCols)}
## Day by day
${perDay || "_none_"}

## All stock studies
${studyBlocks || "_none_"}
`;
}
