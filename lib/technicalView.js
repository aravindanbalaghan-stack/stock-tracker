// Technical View — one stock through the five front-row screens
// (Trendline breakout, Personal learning, IPO base, Pocket pivot, Shakeout),
// using exactly the same analysers the Screeners tab runs, on the latest
// completed session.
//
// Each screen comes back as a card:
//   { id, label, status: "match" | "watch" | "no" | "na", headline,
//     checks: [{ label, pass, value }], metrics: [{ label, value }], note }
// "watch" = the screen's own early/secondary state (an undercut not yet
// reclaimed, a trendline breakout tagged Extended, Personal learning
// passing without a bullish pattern). For a stock that doesn't match, the
// checks show which rule it fails, so the card explains itself.

import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import {
  fetchDailyOHLCV,
  fetchWeeklyOHLCV,
  fetchIndexOHLCV,
  symbolSeries,
  toWeeklyBars,
  sma,
} from "@/lib/screenerIndicators";
import { analyzeTrendlineBreakout, TLB, TLB_STAGE_INFO } from "@/lib/trendlineBreakout";
import { analyzePersonalLearning, PL } from "@/lib/personalLearning";
import { analyzeIpoBase, IPO_STATUS } from "@/lib/ipoBase";
import { getIssuePrices } from "@/lib/ipoIssuePrices";
import { pocketPivotStage1, pocketPivotStage2, PP } from "@/lib/pocketPivot";
import { analyzeShakeout } from "@/lib/shakeout";

const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const pct = (a, b) => ((a - b) / b) * 100;
const rs = (n) => (n == null ? "—" : `₹${r2(n).toLocaleString("en-IN")}`);
const sp = (n, d = 1) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`);

// ---------------------------------------------------------------------

function trendlineCard(weekly) {
  const base = { id: "trendline-breakout", label: "Trendline breakout" };
  const hit = analyzeTrendlineBreakout(weekly, { debug: true });
  if (!hit || hit.rejected) {
    return {
      ...base,
      status: "no",
      headline: "No falling-trendline breakout",
      checks: [{ label: "Recent weekly close above a long falling trendline", pass: false, value: hit?.rejected ?? "not enough data" }],
      metrics: [],
    };
  }
  const stageKey = hit.status === "extended" ? "extended" : hit.stage;
  const info = TLB_STAGE_INFO[stageKey];
  return {
    ...base,
    status: hit.status === "extended" ? "watch" : "match",
    headline: `${info.name} · score ${hit.score}/100`,
    checks: [
      { label: `Falling trendline, ${hit.trendlineTouches} touches`, pass: true, value: `${hit.downtrendWeeks} weeks of downtrend` },
      { label: "Breakout week", pass: true, value: `wk of ${hit.breakoutWeekOf} · ${hit.breakoutVolRatio}× volume` },
      { label: "30-week MA rising", pass: !!hit.ma30Rising, value: `${hit.ma30SlopePct}% over 4 weeks` },
      { label: "Shakeout below support, reclaimed", pass: !!hit.shakeout, value: hit.shakeout ? `under ${rs(hit.supportLevel)}` : "none" },
      {
        label: `Within ${TLB.maxExtensionPct}% of the breakout level`,
        pass: hit.status !== "extended",
        value: hit.extensionPct != null ? `${sp(hit.extensionPct)} above` : "—",
      },
    ],
    metrics: [
      { label: "Trendline now", value: rs(hit.trendlineNow) },
      { label: "30-week MA", value: rs(hit.ma30) },
      { label: "Stop (base low)", value: rs(hit.baseLow) },
      { label: "Prior peak", value: rs(hit.peakHigh) },
    ],
  };
}

function personalCard(weekly, benchByKey, asOfEpoch) {
  const base = { id: "personal-learning", label: "Personal learning" };
  const a = analyzePersonalLearning(weekly, benchByKey, { asOfEpoch });
  if (!a) return { ...base, status: "na", headline: "Not enough weekly history", checks: [], metrics: [] };
  const checks = [
    { label: `Weekly RSI above ${PL.rsiMin}`, pass: a.cond.rsi, value: a.rsiWeekly == null ? "—" : a.rsiWeekly.toFixed(1) },
    { label: "Close above the 30-week MA", pass: a.cond.aboveMa, value: `${sp(a.pctAboveWma)} vs ${rs(a.wma30)}` },
    {
      label: `RS vs ${PL.benchmark.label} above 0`,
      pass: a.cond.rs,
      value:
        a.rsWeekly == null
          ? "—"
          : `${a.rsWeekly > 0 ? "+" : ""}${a.rsWeekly}${a.rsCrossedWeeksAgo != null ? ` · crossed ${a.rsCrossedWeeksAgo === 0 ? "this week" : `${a.rsCrossedWeeksAgo}w ago`}` : ""}`,
    },
    {
      label: "Bullish weekly candlestick pattern",
      pass: a.cond.pattern,
      value: a.patternCount ? a.patterns.map((p) => p.name).join(", ") : "none this week or last",
    },
  ];
  const status = a.passes ? (a.patternCount ? "match" : "watch") : "no";
  return {
    ...base,
    status,
    headline: a.passes
      ? a.patternCount
        ? `Passes, with ${a.patterns.map((p) => p.name).join(", ")}`
        : "Passes all three conditions — no bullish pattern yet"
      : `Fails ${checks.slice(0, 3).filter((c) => !c.pass).length} of 3 conditions`,
    checks,
    metrics: [],
    note: a.weekInProgress ? "This week's candle is still forming." : null,
  };
}

async function ipoCard(hist, today, todayDate) {
  const base = { id: "ipo-base", label: "IPO base" };
  const first = hist?.firstTradeDate;
  if (!first) return { ...base, status: "na", headline: "Listing date unavailable", checks: [], metrics: [] };
  const listed = new Date(first * 1000).toISOString().slice(0, 10);
  const cutoff = new Date(`${todayDate}T00:00:00Z`);
  cutoff.setMonth(cutoff.getMonth() - 15);
  if (listed < cutoff.toISOString().slice(0, 10)) {
    return {
      ...base,
      status: "na",
      headline: `Listed ${listed} — only recent listings qualify`,
      checks: [{ label: "Listed within the last 15 months", pass: false, value: listed }],
      metrics: [],
    };
  }
  const { prices } = await getIssuePrices();
  const symbol = hist.symbol;
  const a = analyzeIpoBase({ bars: hist.bars, today, todayDate, firstTradeDate: first, issue: prices.get(symbol) ?? null });
  if (!a) return { ...base, status: "na", headline: "Couldn't read the listing-day bar", checks: [], metrics: [] };
  const active = a.ipoStatusRank <= IPO_STATUS.NEAR_IPO.rank;
  return {
    ...base,
    status: a.ipoStatusRank === IPO_STATUS.BELOW.rank ? "no" : active ? "match" : "watch",
    headline: a.ipoStatus,
    checks: [
      { label: "Listed within the last 15 months", pass: true, value: a.listingDate },
      {
        label: "Above the IPO price",
        pass: a.aboveIssuePrice === true,
        value: a.issuePrice == null ? "IPO price unavailable" : `${rs(a.issuePrice)} · ${sp(a.vsIssuePct)}${a.crossedIssueOn ? ` · crossed ${a.crossedIssueOn}` : ""}`,
      },
      {
        label: "Above the listing-day high",
        pass: a.aboveListingDayHigh,
        value: `${rs(a.listingDayHigh)} · ${sp(a.vsListingHighPct)}${a.crossedListingHighOn ? ` · crossed ${a.crossedListingHighOn}` : ""}`,
      },
    ],
    metrics: [
      { label: "Listing open", value: rs(a.listingOpen) },
      { label: "High since listing", value: rs(a.highSinceListing) },
      { label: "Base depth", value: a.baseDepthPct != null ? `${a.baseDepthPct}%` : "—" },
    ],
    note: a.ipoWarnings?.length ? a.ipoWarnings.join(" ") : null,
  };
}

function pocketPivotCard(series, closes, volumes) {
  const base = { id: "pocket-pivot", label: "Pocket pivot" };
  const last = series.length - 1;
  const today = series[last];
  const prevClose = today.prevClose ?? series[last - 1]?.close;

  let maxDownVol = 0;
  let downDays = 0;
  for (let i = Math.max(1, last - PP.lookbackDownDays); i < last; i++) {
    const pc = series[i].prevClose ?? series[i - 1]?.close;
    if (pc != null && series[i].close < pc) {
      downDays++;
      maxDownVol = Math.max(maxDownVol, series[i].volume ?? 0);
    }
  }
  const sma10 = series.length >= 10 ? sma(series.slice(-10).map((d) => d.close), 10) : null;
  const sma50 = closes?.length >= 50 ? sma(closes, 50) : null;
  const sma200 = closes?.length >= 200 ? sma(closes, 200) : null;
  const dist10 = sma10 ? pct(today.close, sma10) : null;

  const checks = [
    { label: "Up day (close above prior close)", pass: prevClose != null && today.close > prevClose, value: sp(prevClose ? pct(today.close, prevClose) : null, 2) },
    {
      label: "Volume beats every down day of the last 10",
      pass: downDays > 0 && today.volume > maxDownVol,
      value: downDays === 0 ? "no down days to beat" : `${(today.volume / maxDownVol).toFixed(2)}× the biggest`,
    },
    { label: `Within ${PP.maxExtensionAbove10dmaPct}% of the 10-day SMA`, pass: dist10 != null && dist10 <= PP.maxExtensionAbove10dmaPct, value: sp(dist10) },
    { label: "Above the 50 DMA", pass: sma50 != null && today.close > sma50, value: sma50 ? `${sp(pct(today.close, sma50))} vs ${rs(sma50)}` : "—" },
    { label: "Above the 200 DMA", pass: sma200 != null && today.close > sma200, value: sma200 ? `${sp(pct(today.close, sma200))} vs ${rs(sma200)}` : "—" },
  ];

  const s1 = pocketPivotStage1(series);
  const s2 = s1 && closes ? pocketPivotStage2({ series, closes, volumes, stage1: s1 }) : null;
  if (!s2) {
    return {
      ...base,
      status: "no",
      headline: `Not a pocket pivot today — fails ${checks.filter((c) => !c.pass).length} of ${checks.length}`,
      checks,
      metrics: [],
    };
  }
  return {
    ...base,
    status: s2.ppGrade === "A" ? "match" : "watch",
    headline: `Grade ${s2.ppGrade} · ${s2.ppType}`,
    checks,
    metrics: [
      { label: "Vol ÷ down-vol", value: `${s2.volVsDownVol}×` },
      { label: "Close in day's range", value: `${s2.closeInRangePct}%` },
      { label: "Stop (pivot low)", value: rs(s2.stopLevel) },
      { label: "Risk", value: `${s2.riskPct}%` },
    ],
    note: s2.ppWarnings.length ? `Warnings: ${s2.ppWarnings.join("; ")}.` : "No context warnings.",
  };
}

function shakeoutCard(hist, series, todayDate, closes) {
  const base = { id: "shakeout", label: "Shakeout" };
  const sk = hist?.bars?.length ? analyzeShakeout({ bars: hist.bars, series, todayDate }) : null;
  const close = series[series.length - 1].close;
  const sma200 = closes?.length >= 200 ? sma(closes, 200) : null;
  const sma200Prior = closes?.length >= 220 ? sma(closes.slice(0, -20), 200) : null;
  const uptrend = sma200 != null && close > sma200 && sma200Prior != null && sma200 >= sma200Prior * 0.995;

  if (!sk) {
    return {
      ...base,
      status: "no",
      headline: uptrend ? "In an uptrend, but no recent shakeout" : "Not in an uptrend — screen doesn't apply",
      checks: [
        {
          label: "Close above a rising 200 DMA",
          pass: uptrend,
          value: sma200 ? `${sp(pct(close, sma200))} vs ${rs(sma200)}${sma200Prior != null && sma200 < sma200Prior * 0.995 ? " · 200 DMA falling" : ""}` : "—",
        },
        { label: "Undercut of the base low or 50 DMA in the last 15 sessions, then reclaimed", pass: false, value: "none found" },
      ],
      metrics: [],
    };
  }
  return {
    ...base,
    status: sk.skGrade === "Watch" ? "watch" : sk.skGrade === "C" ? "watch" : "match",
    headline: sk.skGrade === "Watch" ? "Undercut — watch for reclaim" : `Grade ${sk.skGrade} · reclaimed ${sk.skReclaimDate}`,
    checks: sk.skChecks.map((c) => ({ label: c.label, pass: c.pass, value: c.detail })),
    metrics: [
      { label: `Level (${sk.skLevelType})`, value: rs(sk.skLevel) },
      { label: "Shakeout low / stop", value: rs(sk.skStop) },
      { label: "Pivot (base high)", value: rs(sk.skPivot) },
      { label: "To pivot", value: sk.skToPivotPct > 0 ? `${sk.skToPivotPct}%` : "above" },
    ],
    note: sk.reason,
  };
}

// ---------------------------------------------------------------------

export async function getTechnicalView(symbol) {
  const days = await getRecentBhavcopies(31, 50);
  if (!days.length) return { error: "Couldn't load NSE data" };
  const latest = days[days.length - 1];
  const series = symbolSeries(symbol, days);
  if (!series.length || series[series.length - 1].date !== latest.date) {
    return { error: `${symbol} didn't trade in the latest NSE session (${latest.date})` };
  }
  const today = series[series.length - 1];
  const asOfCutoff = Math.floor(new Date(`${latest.date}T23:59:59+05:30`).getTime() / 1000);

  const [dailyRaw, weeklyRaw, bench] = await Promise.all([
    fetchDailyOHLCV(symbol, "2y"),
    fetchWeeklyOHLCV(symbol, "2y"),
    fetchIndexOHLCV(PL.benchmark.symbol).catch(() => null),
  ]);
  const hist = dailyRaw?.bars ? { ...dailyRaw, symbol, bars: dailyRaw.bars.filter((b) => b.t <= asOfCutoff) } : null;
  const weekly = weeklyRaw ? weeklyRaw.filter((b) => b.t <= asOfCutoff) : null;
  const closes = hist?.bars?.map((b) => b.c) ?? null;
  const volumes = hist?.bars?.map((b) => b.v ?? 0) ?? null;
  const benchByKey = bench?.bars ? new Map(toWeeklyBars(bench.bars.filter((b) => b.t <= asOfCutoff)).map((w) => [w.key, w.c])) : null;

  const safe = async (fn, id, label) => {
    try {
      return await fn();
    } catch (err) {
      return { id, label, status: "na", headline: "Couldn't evaluate", checks: [], metrics: [], note: String(err?.message || err) };
    }
  };

  const cards = await Promise.all([
    safe(() => (weekly ? trendlineCard(weekly) : null), "trendline-breakout", "Trendline breakout"),
    safe(
      () => (weekly && benchByKey ? personalCard(weekly, benchByKey, asOfCutoff) : { id: "personal-learning", label: "Personal learning", status: "na", headline: "Weekly or NIFTY 500 data unavailable", checks: [], metrics: [] }),
      "personal-learning",
      "Personal learning"
    ),
    safe(() => ipoCard(hist, today, latest.date), "ipo-base", "IPO base"),
    safe(() => pocketPivotCard(series, closes, volumes), "pocket-pivot", "Pocket pivot"),
    safe(() => shakeoutCard(hist, series, latest.date, closes), "shakeout", "Shakeout"),
  ]);

  const final = cards.map(
    (c, i) =>
      c ?? {
        id: ["trendline-breakout"][i] ?? "unknown",
        label: "Trendline breakout",
        status: "na",
        headline: "Weekly data unavailable",
        checks: [],
        metrics: [],
      }
  );

  return {
    symbol,
    asOf: latest.date,
    close: today.close,
    matches: final.filter((c) => c.status === "match").length,
    watching: final.filter((c) => c.status === "watch").length,
    cards: final,
  };
}
