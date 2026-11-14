// Market breadth: how many stocks are actually taking part in a move.
//
// An index can rise on a handful of heavyweights while most stocks fall;
// breadth shows that. All figures come from the daily market panel
// (lib/marketPanel.js) for a chosen universe:
//
//   % above 20 / 50 / 200-day average   participation, short → long term
//   advancers vs decliners              and the cumulative A/D line
//   McClellan oscillator                19 vs 39-day EMA of net advances
//   new 52-week highs vs lows           leadership vs damage
//   Weinstein stage mix (weekly)        how much of the market is in Stage 2
//
// The verdict at the top is a rule of thumb on these numbers, stated
// with its reasons — not a forecast.

import { rollingSma, universeRows } from "@/lib/marketPanel";
import { toWeeklyBars } from "@/lib/screenerIndicators";
import { weeklyStageSeries } from "@/lib/stageAnalysis";

const HISTORY = 120; // sessions shown on the daily charts
const LOOKBACK_52W = 250;
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);

function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = null;
  for (const v of values) {
    if (v == null) { out.push(prev); continue; }
    prev = prev == null ? v : v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** Daily bars ({t,h,l,c,v}) for one panel row — the shape toWeeklyBars takes. */
export function dailyBarsOf(panel, i) {
  const bars = [];
  for (let t = 0; t < panel.dates.length; t++) {
    const c = panel.c[i][t];
    if (!Number.isFinite(c)) continue;
    bars.push({
      t: Date.parse(`${panel.dates[t]}T10:00:00Z`) / 1000,
      h: Number.isFinite(panel.h[i][t]) ? panel.h[i][t] : c,
      l: Number.isFinite(panel.l[i][t]) ? panel.l[i][t] : c,
      c,
      v: Number.isFinite(panel.v[i][t]) ? panel.v[i][t] : 0,
    });
  }
  return bars;
}

/** Weekly stage per stock, keyed by ISO-week Monday. Shared with rotation/screener. */
export function stageByWeek(panel, i) {
  const weekly = toWeeklyBars(dailyBarsOf(panel, i));
  const { stages } = weeklyStageSeries(weekly);
  const m = new Map();
  weekly.forEach((w, k) => stages[k] != null && m.set(w.key, stages[k]));
  return { weekly, stages: m };
}

export function computeBreadth(panel, { universe = "top500", sectors = [] } = {}) {
  const T = panel.dates.length;
  const rows = universeRows(panel, universe);
  const n = rows.length;
  const start = Math.max(1, T - HISTORY);

  const sma = rows.map(({ i }) => ({
    s20: rollingSma(panel.c[i], 20),
    s50: rollingSma(panel.c[i], 50),
    s200: rollingSma(panel.c[i], 200),
  }));

  const daily = [];
  const netAll = [];
  for (let t = 1; t < T; t++) {
    let adv = 0, dec = 0, unch = 0;
    const above = { 20: [0, 0], 50: [0, 0], 200: [0, 0] };
    let hi = 0, lo = 0, hlBase = 0;
    rows.forEach(({ i }, k) => {
      const c = panel.c[i][t];
      if (!Number.isFinite(c)) return;
      const pc = panel.c[i][t - 1];
      if (Number.isFinite(pc)) {
        if (c > pc) adv++;
        else if (c < pc) dec++;
        else unch++;
      }
      for (const [p, arr] of [[20, sma[k].s20], [50, sma[k].s50], [200, sma[k].s200]]) {
        const m = arr[t];
        if (Number.isFinite(m)) { above[p][1]++; if (c > m) above[p][0]++; }
      }
      if (t >= start && t >= LOOKBACK_52W) {
        let mx = -Infinity, mn = Infinity, seen = 0;
        for (let u = t - LOOKBACK_52W; u < t; u++) {
          const h = panel.h[i][u], l = panel.l[i][u];
          if (Number.isFinite(h)) { if (h > mx) mx = h; seen++; }
          if (Number.isFinite(l) && l < mn) mn = l;
        }
        if (seen >= 200) {
          hlBase++;
          if (panel.h[i][t] >= mx) hi++;
          if (panel.l[i][t] <= mn) lo++;
        }
      }
    });
    netAll.push(adv - dec);
    if (t < start) continue;
    const pct = (p) => (above[p][1] >= n * 0.3 ? r1((above[p][0] / above[p][1]) * 100) : null);
    daily.push({
      date: panel.dates[t],
      advancers: adv,
      decliners: dec,
      unchanged: unch,
      above20: pct(20),
      above50: pct(50),
      above200: pct(200),
      newHighs: hlBase >= n * 0.3 ? hi : null,
      newLows: hlBase >= n * 0.3 ? lo : null,
    });
  }

  // A/D line + McClellan over the whole history, then trimmed to the window.
  const e19 = ema(netAll, 19), e39 = ema(netAll, 39);
  let cum = 0;
  const adLine = netAll.map((x) => (cum += x));
  const offset = netAll.length - daily.length;
  daily.forEach((d, k) => {
    d.adLine = adLine[offset + k];
    d.mcclellan = netAll.length >= 39 ? r1(e19[offset + k] - e39[offset + k]) : null;
  });

  // Weekly Weinstein stage mix.
  const weekCounts = new Map();
  const latestStage = new Map();
  rows.forEach(({ symbol, i }) => {
    const { stages } = stageByWeek(panel, i);
    let last = null;
    for (const [wk, st] of stages) {
      const c = weekCounts.get(wk) ?? [0, 0, 0, 0, 0];
      c[st]++;
      c[0]++;
      weekCounts.set(wk, c);
      last = st;
    }
    if (last != null) latestStage.set(symbol, last);
  });
  const stageWeeks = [...weekCounts.entries()]
    .filter(([, c]) => c[0] >= n * 0.5)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([week, c]) => ({
      week,
      stage1: r1((c[1] / c[0]) * 100),
      stage2: r1((c[2] / c[0]) * 100),
      stage3: r1((c[3] / c[0]) * 100),
      stage4: r1((c[4] / c[0]) * 100),
    }));

  // Sector breadth: same participation measures inside each sector.
  const T1 = T - 1;
  const rowByIdx = new Map(rows.map((r, k) => [r.i, k]));
  const sectorRows = sectors
    .map((sec) => {
      let a50 = 0, b50 = 0, a200 = 0, b200 = 0, s2 = 0, sAll = 0;
      for (const sym of sec.symbols ?? []) {
        const i = panel.idx.get(sym);
        if (i == null) continue;
        const c = panel.c[i][T1];
        if (!Number.isFinite(c)) continue;
        const k = rowByIdx.get(i);
        const s50 = k != null ? sma[k].s50[T1] : rollingSma(panel.c[i], 50)[T1];
        const s200 = k != null ? sma[k].s200[T1] : rollingSma(panel.c[i], 200)[T1];
        if (Number.isFinite(s50)) { b50++; if (c > s50) a50++; }
        if (Number.isFinite(s200)) { b200++; if (c > s200) a200++; }
        if (!latestStage.has(sym)) {
          const st0 = [...stageByWeek(panel, i).stages.values()].pop();
          latestStage.set(sym, st0 ?? null);
        }
        const st = latestStage.get(sym);
        if (st != null) { sAll++; if (st === 2) s2++; }
      }
      if (b50 < 3) return null;
      return {
        key: sec.key,
        name: sec.name ?? sec.label ?? sec.key,
        stocks: b50,
        above50: r1((a50 / b50) * 100),
        above200: b200 >= 3 ? r1((a200 / b200) * 100) : null,
        stage2: sAll >= 3 ? r1((s2 / sAll) * 100) : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.above50 - a.above50);

  // Today's new highs / lows, most traded first.
  const newHighList = [], newLowList = [];
  if (T1 >= LOOKBACK_52W) {
    for (const { symbol, i, turnoverCr } of rows) {
      let mx = -Infinity, mn = Infinity;
      for (let u = T1 - LOOKBACK_52W; u < T1; u++) {
        if (Number.isFinite(panel.h[i][u]) && panel.h[i][u] > mx) mx = panel.h[i][u];
        if (Number.isFinite(panel.l[i][u]) && panel.l[i][u] < mn) mn = panel.l[i][u];
      }
      const c = panel.c[i][T1], pc = panel.c[i][T1 - 1];
      const chg = Number.isFinite(pc) && pc > 0 ? r1((c / pc - 1) * 100) : null;
      if (panel.h[i][T1] >= mx) newHighList.push({ symbol, close: c, changePct: chg, turnoverCr: r1(turnoverCr) });
      if (panel.l[i][T1] <= mn) newLowList.push({ symbol, close: c, changePct: chg, turnoverCr: r1(turnoverCr) });
    }
  }

  const latest = daily[daily.length - 1] ?? null;
  const tenAgo = daily[daily.length - 11] ?? null;
  const latestStageMix = stageWeeks[stageWeeks.length - 1] ?? null;
  return {
    universe,
    universeSize: n,
    asOf: panel.latest,
    daily,
    stageWeeks,
    latestStageMix,
    sectors: sectorRows,
    newHighList: newHighList.slice(0, 40),
    newLowList: newLowList.slice(0, 40),
    verdict: verdictOf(latest, tenAgo, latestStageMix),
  };
}

/** Rule-of-thumb read of the latest numbers, with the reasons spelled out. */
export function verdictOf(latest, tenAgo, stageMix) {
  if (!latest || latest.above50 == null) return null;
  const reasons = [];
  let score = 0;
  const a200 = latest.above200, a50 = latest.above50;
  if (a200 != null) {
    if (a200 >= 60) { score += 2; reasons.push(`${a200}% of stocks are above their 200-day average (healthy is 60%+)`); }
    else if (a200 < 40) { score -= 2; reasons.push(`Only ${a200}% are above their 200-day average (under 40% is a weak market)`); }
    else reasons.push(`${a200}% are above their 200-day average — middling`);
  }
  if (a50 >= 60) { score += 1; reasons.push(`${a50}% are above their 50-day average`); }
  else if (a50 < 40) { score -= 1; reasons.push(`Only ${a50}% are above their 50-day average`); }
  if (tenAgo?.above50 != null) {
    const d = Math.round((a50 - tenAgo.above50) * 10) / 10;
    if (d >= 8) { score += 1; reasons.push(`Participation is improving: +${d} points in two weeks`); }
    else if (d <= -8) { score -= 1; reasons.push(`Participation is fading: ${d} points in two weeks`); }
  }
  if (latest.newHighs != null && latest.newLows != null) {
    if (latest.newHighs > latest.newLows * 2 && latest.newHighs >= 5) { score += 1; reasons.push(`${latest.newHighs} new 52-week highs vs ${latest.newLows} lows`); }
    else if (latest.newLows > latest.newHighs * 2 && latest.newLows >= 5) { score -= 1; reasons.push(`${latest.newLows} new 52-week lows vs ${latest.newHighs} highs`); }
  }
  if (stageMix?.stage2 != null) {
    if (stageMix.stage2 >= 40) { score += 1; reasons.push(`${stageMix.stage2}% of stocks are in Stage 2`); }
    else if (stageMix.stage4 >= 40) { score -= 1; reasons.push(`${stageMix.stage4}% of stocks are in Stage 4`); }
  }
  const tone = score >= 3 ? "risk-on" : score <= -2 ? "risk-off" : "mixed";
  const headline =
    tone === "risk-on"
      ? "Broad participation — a market that rewards buying breakouts"
      : tone === "risk-off"
      ? "Weak breadth — most stocks are falling; be selective and size down"
      : "Mixed breadth — pick spots carefully";
  return { tone, score, headline, reasons };
}
