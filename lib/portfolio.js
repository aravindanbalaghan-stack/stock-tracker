// Portfolio analytics — what you own, how concentrated it is, how risky it
// is, how it has actually performed, and whether it breaks your own
// money-management rules.
//
// Prices are end-of-day, split-adjusted closes from the market panel
// (lib/marketPanel.js), so everything here is "as of the last close";
// the Positions view keeps showing live prices.
//
// Performance is reconstructed from each holding's history (buys and sells
// with dates) and shown as a time-weighted return, which strips out the
// effect of adding or withdrawing money: on each day,
//   r = (value today − money added today) / value yesterday − 1
// and the daily r's are compounded. The benchmark is the equal-weight
// basket of the 500 most traded stocks over the same days.

import { universeRows, rollingSma } from "@/lib/marketPanel";
import { stageByWeek } from "@/lib/breadth";
import { capBucket, DEFAULT_SETTINGS, sizePosition, CAP_BUCKETS } from "@/lib/sizing";

export { capBucket, DEFAULT_SETTINGS, sizePosition, CAP_BUCKETS };

const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const RISK_WINDOW = 120; // sessions of daily returns behind beta / volatility / drawdown

function atrPct(panel, i, n = 14) {
  const T = panel.dates.length;
  let atr = null, prev = null, count = 0;
  for (let t = Math.max(0, T - 60); t < T; t++) {
    const c = panel.c[i][t], h = panel.h[i][t], l = panel.l[i][t];
    if (!Number.isFinite(c)) continue;
    const tr = prev == null ? h - l : Math.max(h - l, Math.abs(h - prev), Math.abs(l - prev));
    count++;
    atr = atr == null ? tr : count <= n ? atr + (tr - atr) / count : (atr * (n - 1) + tr) / n;
    prev = c;
  }
  const last = panel.c[i][T - 1];
  return atr != null && last ? (atr / last) * 100 : null;
}

/** Technical context for one symbol: levels a stop is usually placed at. */
export function symbolContext(panel, symbol) {
  const i = panel.idx.get(symbol);
  if (i == null) return null;
  const T = panel.dates.length;
  const c = panel.c[i];
  const close = c[T - 1];
  if (!Number.isFinite(close)) return null;
  const sma20 = rollingSma(c, 20)[T - 1];
  const sma50 = rollingSma(c, 50)[T - 1];
  const { weekly, stages } = stageByWeek(panel, i);
  const wkCloses = weekly.map((w) => w.c);
  const ma30w = wkCloses.length >= 30 ? wkCloses.slice(-30).reduce((a, b) => a + b, 0) / 30 : null;
  let low10 = Infinity;
  for (let t = Math.max(0, T - 10); t < T; t++) if (Number.isFinite(panel.l[i][t])) low10 = Math.min(low10, panel.l[i][t]);
  const atr = atrPct(panel, i);
  const stage = [...stages.values()].pop() ?? null;
  return {
    symbol,
    asOf: panel.dates[T - 1],
    close: r2(close),
    changePct: Number.isFinite(c[T - 2]) ? r2((close / c[T - 2] - 1) * 100) : null,
    sma20: r2(sma20),
    sma50: r2(sma50),
    ma30w: r2(ma30w),
    low10: Number.isFinite(low10) ? r2(low10) : null,
    atrPct: r2(atr),
    atr: atr != null ? r2((atr / 100) * close) : null,
    stage,
  };
}

/** Typical stop levels below the price, nearest first, each with its reasoning. */
export function suggestedStops(ctx) {
  if (!ctx) return [];
  const out = [];
  const add = (id, label, price, why) => {
    if (price != null && Number.isFinite(price) && price < ctx.close && price > 0) {
      out.push({ id, label, price: r2(price), pct: r2((price / ctx.close - 1) * 100), why });
    }
  };
  if (ctx.atr) add("atr2", "2 × ATR", ctx.close - 2 * ctx.atr, "Twice the average daily range below the price — outside normal noise");
  add("low10", "10-day low", ctx.low10 ? ctx.low10 * 0.995 : null, "Just under the lowest low of the last 10 sessions");
  add("sma20", "20-day average", ctx.sma20 ? ctx.sma20 * 0.99 : null, "Just under the 20-day average — for fast-moving swing trades");
  add("sma50", "50-day average", ctx.sma50 ? ctx.sma50 * 0.99 : null, "Just under the 50-day average — the classic line for growth stocks");
  add("ma30w", "30-week average", ctx.ma30w ? ctx.ma30w * 0.98 : null, "Below the 30-week average — Weinstein's Stage 2 exit");
  return out.sort((a, b) => b.price - a.price);
}

// ── holdings over time ───────────────────────────────────────────────────

/**
 * Quantity held at the end of each session, rebuilt from the holding's
 * history. The opening lot is what's left after undoing every later buy and
 * sell, dated buyDate (or when it was added).
 */
function quantityPath(h, dates) {
  const dated = (x) => x.date ?? (x.at ?? "").slice(0, 10);
  const hist = h.history ?? [];
  // An "edit" overwrites the quantity (a correction), so only trades after
  // the latest edit are replayed; everything before is folded into the
  // opening lot.
  let lastEditDate = "";
  for (const x of hist) if (x.type === "edit" && dated(x) > lastEditDate) lastEditDate = dated(x);
  const trades = hist
    .filter((x) => (x.type === "buy" || x.type === "sell") && x.quantity > 0 && dated(x) && dated(x) > lastEditDate)
    .map((x) => ({ date: dated(x), qty: x.type === "buy" ? x.quantity : -x.quantity, price: x.price }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const opening = Math.max(0, h.quantity - trades.reduce((s, t) => s + t.qty, 0));
  const openDate = h.buyDate || (h.addedAt ?? "").slice(0, 10) || dates[0];

  const qty = new Float64Array(dates.length).fill(0);
  const flows = new Map(); // session index → [{ qty, price }]
  const addFlow = (t, f) => flows.set(t, [...(flows.get(t) ?? []), f]);
  let q = 0, k = 0, opened = false;
  dates.forEach((d, t) => {
    if (!opened && d >= openDate) {
      opened = true;
      if (opening > 0) {
        q += opening;
        addFlow(t, { qty: opening, price: h.avgPrice });
      }
    }
    while (k < trades.length && trades[k].date <= d) {
      q += trades[k].qty;
      addFlow(t, { qty: trades[k].qty, price: trades[k].price });
      k++;
    }
    qty[t] = Math.max(0, q);
  });
  return { qty, flows };
}

function performance(panel, holdings) {
  const T = panel.dates.length;
  const value = new Float64Array(T).fill(0);
  const flow = new Float64Array(T).fill(0);
  let any = false;
  for (const h of holdings) {
    const i = panel.idx.get(h.symbol);
    if (i == null) continue;
    const { qty, flows } = quantityPath(h, panel.dates);
    let last = NaN;
    for (let t = 0; t < T; t++) {
      if (Number.isFinite(panel.c[i][t])) last = panel.c[i][t];
      if (qty[t] > 0 && Number.isFinite(last)) {
        value[t] += qty[t] * last;
        any = true;
      }
      for (const f of flows.get(t) ?? []) {
        // Use the price you traded at — unless it's far from that day's
        // close, which means a split/bonus since (closes are adjusted, your
        // trade price isn't) or a typo; then the close is the better guess.
        const ok = Number.isFinite(f.price) && f.price > 0 && Number.isFinite(last) && Math.abs(f.price / last - 1) <= 0.3;
        const px = ok ? f.price : last;
        if (Number.isFinite(px)) flow[t] += f.qty * px;
      }
    }
  }
  if (!any) return null;
  const start = value.findIndex((v) => v > 0);
  const bench = universeRows(panel, "top500").map((r) => r.i);
  const series = [];
  let cum = 1, bcum = 1;
  for (let t = start; t < T; t++) {
    if (t > start && value[t - 1] > 0) {
      const r = (value[t] - flow[t]) / value[t - 1] - 1;
      if (Number.isFinite(r) && Math.abs(r) < 0.5) cum *= 1 + r;
      let s = 0, n = 0;
      for (const j of bench) {
        const a = panel.c[j][t - 1], b = panel.c[j][t];
        if (Number.isFinite(a) && Number.isFinite(b) && a > 0) {
          const x = b / a - 1;
          if (Math.abs(x) < 0.5) { s += x; n++; }
        }
      }
      if (n) bcum *= 1 + s / n;
    }
    series.push({ date: panel.dates[t], portfolio: r2((cum - 1) * 100), market: r2((bcum - 1) * 100), value: Math.round(value[t]) });
  }
  const at = (back) => {
    const k = series.length - 1 - back;
    if (k < 0) return null;
    const a = series[k], b = series[series.length - 1];
    return {
      portfolio: r2(((1 + b.portfolio / 100) / (1 + a.portfolio / 100) - 1) * 100),
      market: r2(((1 + b.market / 100) / (1 + a.market / 100) - 1) * 100),
    };
  };
  return {
    from: series[0].date,
    series,
    periods: { "1M": at(21), "3M": at(63), "6M": at(126), All: at(series.length - 1) },
    note:
      panel.dates[0] > (holdings.map((h) => h.buyDate || (h.addedAt ?? "").slice(0, 10)).sort()[0] ?? "9999")
        ? `Performance starts ${series[0].date}, the earliest date in the price history; earlier holding periods aren't included.`
        : null,
  };
}

function riskStats(panel, holdings, weights) {
  const T = panel.dates.length;
  const from = Math.max(1, T - RISK_WINDOW);
  const bench = universeRows(panel, "top500").map((r) => r.i);
  const port = [], mkt = [];
  const perStock = holdings.map(() => []);
  for (let t = from; t < T; t++) {
    let pr = 0, wsum = 0;
    holdings.forEach((h, k) => {
      const i = panel.idx.get(h.symbol);
      if (i == null) return;
      const a = panel.c[i][t - 1], b = panel.c[i][t];
      if (Number.isFinite(a) && Number.isFinite(b) && a > 0) {
        const x = b / a - 1;
        pr += weights[k] * x;
        wsum += weights[k];
        perStock[k].push(x);
      } else perStock[k].push(null);
    });
    let s = 0, n = 0;
    for (const j of bench) {
      const a = panel.c[j][t - 1], b = panel.c[j][t];
      if (Number.isFinite(a) && Number.isFinite(b) && a > 0) {
        const x = b / a - 1;
        if (Math.abs(x) < 0.5) { s += x; n++; }
      }
    }
    if (wsum > 0 && n) {
      port.push(pr / wsum);
      mkt.push(s / n);
    }
  }
  if (port.length < 20) return null;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const mp = mean(port), mm = mean(mkt);
  let cov = 0, varm = 0, varp = 0;
  for (let k = 0; k < port.length; k++) {
    cov += (port[k] - mp) * (mkt[k] - mm);
    varm += (mkt[k] - mm) ** 2;
    varp += (port[k] - mp) ** 2;
  }
  const beta = varm > 0 ? cov / varm : null;
  const vol = Math.sqrt(varp / (port.length - 1)) * Math.sqrt(250) * 100;
  const mvol = Math.sqrt(varm / (mkt.length - 1)) * Math.sqrt(250) * 100;
  let peak = 1, eq = 1, mdd = 0;
  for (const r of port) {
    eq *= 1 + r;
    peak = Math.max(peak, eq);
    mdd = Math.min(mdd, eq / peak - 1);
  }
  const sorted = [...port].sort((a, b) => a - b);
  const var95 = sorted[Math.floor(sorted.length * 0.05)];
  // Average pairwise correlation between holdings — how much they move together.
  const corr = (a, b) => {
    const xs = [], ys = [];
    a.forEach((x, k) => {
      if (x != null && b[k] != null) { xs.push(x); ys.push(b[k]); }
    });
    if (xs.length < 20) return null;
    const ma = mean(xs), mb = mean(ys);
    let c = 0, va = 0, vb = 0;
    for (let k = 0; k < xs.length; k++) {
      c += (xs[k] - ma) * (ys[k] - mb);
      va += (xs[k] - ma) ** 2;
      vb += (ys[k] - mb) ** 2;
    }
    return va > 0 && vb > 0 ? c / Math.sqrt(va * vb) : null;
  };
  const pairs = [];
  for (let a = 0; a < perStock.length; a++) for (let b = a + 1; b < perStock.length; b++) {
    const c = corr(perStock[a], perStock[b]);
    if (c != null) pairs.push(c);
  }
  return {
    sessions: port.length,
    beta: r2(beta),
    volatilityPct: r2(vol),
    marketVolatilityPct: r2(mvol),
    maxDrawdownPct: r2(mdd * 100),
    var95Pct: r2(var95 * 100),
    worstDayPct: r2(sorted[0] * 100),
    avgCorrelation: pairs.length ? r2(mean(pairs)) : null,
  };
}

/**
 * holdings: from lib/holdingsStore. closed: realised trades log.
 * sectorOf: Map(symbol → sector name). themesOf: Map(symbol → [names]).
 * caps: Map(symbol → ₹ Cr). settings: DEFAULT_SETTINGS shape.
 */
export function computePortfolio({ panel, holdings, closed = [], sectorOf, themesOf, caps, settings }) {
  const T = panel.dates.length;
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const rows = holdings.map((h) => {
    const ctx = symbolContext(panel, h.symbol);
    const price = ctx?.close ?? null;
    const value = price != null ? price * h.quantity : null;
    const cost = h.avgPrice != null ? h.avgPrice * h.quantity : null;
    const stop = Number.isFinite(h.stopLoss) && h.stopLoss > 0 ? h.stopLoss : null;
    const realised = (h.history ?? [])
      .filter((x) => x.type === "sell" && x.price != null && x.quantity > 0 && h.avgPrice != null)
      .reduce((a, x) => a + (x.price - h.avgPrice) * x.quantity, 0);
    return {
      symbol: h.symbol,
      quantity: h.quantity,
      avgPrice: h.avgPrice,
      price,
      priceDate: ctx?.asOf ?? null,
      changePct: ctx?.changePct ?? null,
      value: r2(value),
      cost: r2(cost),
      pnl: value != null && cost != null ? r2(value - cost) : null,
      pnlPct: value != null && cost ? r2((value / cost - 1) * 100) : null,
      dayPnl: value != null && ctx?.changePct != null ? r2(value - value / (1 + ctx.changePct / 100)) : null,
      realised: r2(realised),
      sector: sectorOf.get(h.symbol) ?? "Unclassified",
      themes: themesOf.get(h.symbol) ?? [],
      marketCapCr: caps.get(h.symbol) ?? null,
      cap: capBucket(caps.get(h.symbol)).label,
      stage: ctx?.stage ?? null,
      sma50: ctx?.sma50 ?? null,
      ma30w: ctx?.ma30w ?? null,
      vsSma50Pct: ctx?.sma50 && price ? r2((price / ctx.sma50 - 1) * 100) : null,
      vsMa30wPct: ctx?.ma30w && price ? r2((price / ctx.ma30w - 1) * 100) : null,
      atrPct: ctx?.atrPct ?? null,
      stopLoss: stop,
      target: Number.isFinite(h.target) && h.target > 0 ? h.target : null,
      openRisk: stop != null && price != null ? r2(Math.max(0, price - stop) * h.quantity) : null,
      belowStop: stop != null && price != null && price <= stop,
      buyDate: h.buyDate ?? null,
      daysHeld: h.buyDate ? Math.round((Date.parse(panel.dates[T - 1]) - Date.parse(h.buyDate)) / 86400000) : null,
      suggestedStops: suggestedStops(ctx),
      noPrice: price == null,
    };
  });

  const total = rows.reduce((a, r) => a + (r.value ?? 0), 0);
  const invested = rows.reduce((a, r) => a + (r.cost ?? 0), 0);
  const capital = s.capital > 0 ? s.capital : total;
  rows.forEach((r) => {
    r.weightPct = total > 0 && r.value != null ? r2((r.value / total) * 100) : null;
    r.openRiskPct = r.openRisk != null && capital > 0 ? r2((r.openRisk / capital) * 100) : null;
  });

  const group = (keyOf) => {
    const m = new Map();
    for (const r of rows) {
      if (r.value == null) continue;
      for (const k of [].concat(keyOf(r))) {
        const g = m.get(k) ?? { name: k, value: 0, pnl: 0, count: 0 };
        g.value += r.value;
        g.pnl += r.pnl ?? 0;
        g.count++;
        m.set(k, g);
      }
    }
    return [...m.values()]
      .map((g) => ({ ...g, value: r2(g.value), pnl: r2(g.pnl), weightPct: total > 0 ? r2((g.value / total) * 100) : null }))
      .sort((a, b) => b.value - a.value);
  };
  const bySector = group((r) => r.sector);
  const byTheme = group((r) => (r.themes.length ? r.themes : ["No theme"]));
  const byCap = group((r) => r.cap);
  const byStage = group((r) => (r.stage ? `Stage ${r.stage}` : "Unknown"));

  const weights = rows.map((r) => (r.value ?? 0) / (total || 1));
  const hhi = weights.reduce((a, w) => a + w * w, 0);
  const sortedW = [...weights].sort((a, b) => b - a);
  const concentration = {
    holdings: rows.length,
    effectiveHoldings: hhi > 0 ? r2(1 / hhi) : null,
    top1Pct: r2((sortedW[0] ?? 0) * 100),
    top3Pct: r2(sortedW.slice(0, 3).reduce((a, b) => a + b, 0) * 100),
  };

  const totalOpenRisk = rows.reduce((a, r) => a + (r.openRisk ?? 0), 0);
  const realisedOpen = rows.reduce((a, r) => a + (r.realised ?? 0), 0);
  const realisedClosed = closed.reduce((a, c) => a + (c.pnl ?? 0), 0);
  const summary = {
    asOf: panel.latest,
    value: r2(total),
    invested: r2(invested),
    pnl: r2(total - invested),
    pnlPct: invested > 0 ? r2((total / invested - 1) * 100) : null,
    dayPnl: r2(rows.reduce((a, r) => a + (r.dayPnl ?? 0), 0)),
    realised: r2(realisedOpen + realisedClosed),
    capital: r2(capital),
    capitalIsValue: !(s.capital > 0),
    cash: s.capital > 0 ? r2(s.capital - total) : null,
    openRisk: r2(totalOpenRisk),
    openRiskPct: capital > 0 ? r2((totalOpenRisk / capital) * 100) : null,
    withoutStop: rows.filter((r) => r.stopLoss == null).length,
  };

  // Rule checks, worst first.
  const flags = [];
  for (const r of rows) {
    if (r.belowStop) flags.push({ level: "high", symbol: r.symbol, text: `${r.symbol} closed at ₹${r.price}, at or below your stop of ₹${r.stopLoss}` });
    if (r.stage === 4) flags.push({ level: "high", symbol: r.symbol, text: `${r.symbol} is in Stage 4 (below a falling 30-week average) — Weinstein's rule is not to hold Stage 4 stocks` });
    if (r.weightPct != null && r.weightPct > s.maxPositionPct) flags.push({ level: "medium", symbol: r.symbol, text: `${r.symbol} is ${r.weightPct}% of the portfolio — above your ${s.maxPositionPct}% position limit` });
    if (r.stage === 3) flags.push({ level: "low", symbol: r.symbol, text: `${r.symbol} is in Stage 3 (topping) — consider tightening the stop` });
  }
  for (const g of bySector) {
    if (g.weightPct > s.maxSectorPct && g.name !== "Unclassified") flags.push({ level: "medium", text: `${g.name} is ${g.weightPct}% of the portfolio — above your ${s.maxSectorPct}% sector limit` });
  }
  if (summary.openRiskPct != null && summary.openRiskPct > s.maxOpenRiskPct) {
    flags.push({ level: "medium", text: `Total open risk to your stops is ${summary.openRiskPct}% of capital — above your ${s.maxOpenRiskPct}% limit` });
  }
  if (summary.withoutStop > 0) {
    flags.push({ level: "low", text: `${summary.withoutStop} holding${summary.withoutStop === 1 ? " has" : "s have"} no stop-loss set, so open risk can't be measured for ${summary.withoutStop === 1 ? "it" : "them"}` });
  }
  const order = { high: 0, medium: 1, low: 2 };
  flags.sort((a, b) => order[a.level] - order[b.level]);

  return {
    asOf: panel.latest,
    settings: s,
    summary,
    rows: rows.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    allocation: { bySector, byTheme, byCap, byStage },
    concentration,
    risk: riskStats(panel, holdings, weights),
    performance: performance(panel, holdings),
    closed: closed.slice(-50).reverse(),
    flags,
  };
}
