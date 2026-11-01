// Trading Suggestions — short-term swing setups for F&O stocks and
// BANKNIFTY, shown only when the stock's OWN past trades on that exact
// setup won at least 80% of the time.
//
// ── WHAT THIS IS, AND ISN'T ─────────────────────────────────────────────
// No published rule set is "proven" to win 80%+ of the time on every
// stock. The setups with the highest documented win rates are short-term
// mean-reversion rules in an established trend (Larry Connors & Cesar
// Alvarez, "Short Term Trading Strategies That Work", 2008). They win
// often because they take small, quick gains — and the price of that is
// that the occasional loser is bigger than the typical winner. A high win
// rate is not the same as profit, so every number below is also shown
// net of costs, with the average loss and the worst loss next to it.
//
// So instead of promising 80%, this module MEASURES it:
//   1. Every setup is backtested on ~5 years of daily data for each F&O
//      stock (10 years for BANKNIFTY).
//   2. A signal is only shown if, using ONLY trades that had already
//      closed before the signal date, that symbol+setup had won ≥ 80% of
//      at least 10 trades with a positive average return.
//   3. The headline "walk-forward" figures are what you would actually
//      have got by following exactly that rule through the history —
//      i.e. the selection is tested out of sample, not fitted after the
//      fact. If those numbers come in under 80%, the UI says so.
//
// ── THE SETUPS (daily bars; long and mirrored short) ────────────────────
//   RSI(2) pullback  — Connors. Long: close > 200 DMA, close < 5 DMA,
//                      RSI(2) < 10. Exit: close > 5 DMA.
//   Cumulative RSI(2) — Connors. Long: close > 200 DMA, RSI(2) of the
//                      last 2 days summed < 35. Exit: RSI(2) > 65.
//   Double 7s        — Connors. Long: close > 200 DMA, close is the
//                      lowest close of 7 sessions. Exit: close is the
//                      highest close of 7 sessions.
//   Shorts mirror each (below the 200 DMA; RSI(2) > 90 / sum > 165 /
//   highest close of 7) — shortable only through F&O, which is why the
//   universe is F&O stocks.
//
// ── EXECUTION ASSUMED BY THE BACKTEST ──────────────────────────────────
//   Entry      next session's OPEN after the signal close (the signal is
//              only known after the close). Skipped if it opens beyond
//              the stop.
//   Exits      evaluated on the CLOSE: the setup's exit rule, the stop,
//              or a 10-session time limit — whichever comes first.
//   Costs      0.10% round trip for stock futures, 0.05% for BANKNIFTY
//              (brokerage, STT, exchange charges, slippage).
//
// ── STOP-HUNT PROTECTION ───────────────────────────────────────────────
// Stops that sit exactly under the obvious swing low or on a round number
// are where resting stop-loss orders cluster, and a quick wick through
// them is a well-known way to collect that liquidity before price
// reverses. The stop here is built to avoid all three weak points:
//   - it's a CLOSING stop — an intraday wick through it doesn't count,
//     only a close beyond it does;
//   - it sits 0.75 × ATR(14) BEYOND the 5-session swing low/high, not at it;
//   - if that lands near a round number, it's pushed past the round
//     number by a further 0.25 × ATR.
// The UI also advises using a price alert rather than a resting stop
// order, so the level isn't sitting visibly in the order book.

import { istToday, istNowMinutes } from "@/lib/marketHours";

export const TS = {
  minPriorTrades: 10,
  minWinRate: 0.8,
  minProfitFactor: 1.2,
  maxHold: 10,
  stopAtrBuffer: 0.75,
  roundAvoidAtr: 0.25,
  swingLookback: 5,
  costPct: { stock: 0.1, index: 0.05 },
};

export const SETUPS = {
  rsi2: {
    label: "RSI(2) pullback",
    source: "Connors & Alvarez — RSI(2) with 200-DMA trend filter and 5-DMA exit",
  },
  cumrsi: {
    label: "Cumulative RSI(2)",
    source: "Connors & Alvarez — two-day cumulative RSI(2) with 200-DMA filter",
  },
  d7: {
    label: "Double 7s",
    source: "Connors & Alvarez — 7-session closing low/high with 200-DMA filter",
  },
};

// ---------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------

function smaArr(c, n) {
  const out = new Array(c.length).fill(null);
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    s += c[i];
    if (i >= n) s -= c[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

// Wilder RSI; also returns the running average gain/loss, needed to turn
// "RSI(2) crosses 65" into a price level.
function rsiArr(c, n) {
  const rsi = new Array(c.length).fill(null);
  const ag = new Array(c.length).fill(null);
  const al = new Array(c.length).fill(null);
  if (c.length <= n) return { rsi, ag, al };
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  ag[n] = g / n;
  al[n] = l / n;
  for (let i = n; i < c.length; i++) {
    if (i > n) {
      const d = c[i] - c[i - 1];
      ag[i] = (ag[i - 1] * (n - 1) + Math.max(d, 0)) / n;
      al[i] = (al[i - 1] * (n - 1) + Math.max(-d, 0)) / n;
    }
    rsi[i] = al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]);
  }
  return { rsi, ag, al };
}

function atrArr(b, n) {
  const out = new Array(b.length).fill(null);
  let a = null;
  for (let i = 1; i < b.length; i++) {
    const tr = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
    if (i < n) continue;
    if (a == null) {
      let s = 0;
      for (let k = i - n + 1; k <= i; k++) {
        s += Math.max(b[k].h - b[k].l, Math.abs(b[k].h - b[k - 1].c), Math.abs(b[k].l - b[k - 1].c));
      }
      a = s / n;
    } else {
      a = (a * (n - 1) + tr) / n;
    }
    out[i] = a;
  }
  return out;
}

function roundUnit(price, isIndex) {
  if (isIndex) return 100;
  if (price < 100) return 5;
  if (price < 500) return 10;
  if (price < 2000) return 50;
  return 100;
}

// Pushes a stop past any round number it lands near — see header.
function deHuntStop(stop, side, atr, price, isIndex) {
  const unit = roundUnit(price, isIndex);
  const nearest = Math.round(stop / unit) * unit;
  if (Math.abs(stop - nearest) <= TS.roundAvoidAtr * atr) {
    return side === "long" ? Math.min(stop, nearest - TS.roundAvoidAtr * atr) : Math.max(stop, nearest + TS.roundAvoidAtr * atr);
  }
  return stop;
}

// IST has no DST, so a fixed +5:30 offset is exact — and far faster than
// toLocaleDateString across ~250k bars.
const istDate = (epochSeconds) => new Date((epochSeconds + 19800) * 1000).toISOString().slice(0, 10);

const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

// ---------------------------------------------------------------------
// Per-symbol backtest
// ---------------------------------------------------------------------

/** Daily bars → clean oldest-first array with dates; drops an unfinished today bar. */
export function cleanBars(raw) {
  const today = istToday();
  const beforeClose = istNowMinutes() < 15 * 60 + 40;
  const byDate = new Map();
  for (const b of raw ?? []) {
    if (b?.o == null || b.h == null || b.l == null || b.c == null) continue;
    const date = istDate(b.t);
    if (date > today) continue;
    if (date === today && beforeClose) continue;
    byDate.set(date, { date, o: b.o, h: b.h, l: b.l, c: b.c });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

function prepare(bars) {
  const c = bars.map((b) => b.c);
  const { rsi, ag, al } = rsiArr(c, 2);
  return { bars, c, sma5: smaArr(c, 5), sma200: smaArr(c, 200), rsi, ag, al, atr: atrArr(bars, 14) };
}

function minClose(c, from, to) {
  let m = Infinity;
  for (let k = from; k <= to; k++) m = Math.min(m, c[k]);
  return m;
}
function maxClose(c, from, to) {
  let m = -Infinity;
  for (let k = from; k <= to; k++) m = Math.max(m, c[k]);
  return m;
}

// Which side (if any) each setup signals on bar i.
function signalAt(p, setup, i) {
  const { c, sma5, sma200, rsi } = p;
  if (i < 200 || sma200[i] == null || rsi[i] == null || rsi[i - 1] == null) return null;
  const up = c[i] > sma200[i];
  if (setup === "rsi2") {
    if (up && c[i] < sma5[i] && rsi[i] < 10) return "long";
    if (!up && c[i] > sma5[i] && rsi[i] > 90) return "short";
  } else if (setup === "cumrsi") {
    const s = rsi[i] + rsi[i - 1];
    if (up && s < 35) return "long";
    if (!up && s > 165) return "short";
  } else if (setup === "d7") {
    if (up && c[i] <= minClose(c, i - 6, i)) return "long";
    if (!up && c[i] >= maxClose(c, i - 6, i)) return "short";
  }
  return null;
}

function exitRuleHit(p, setup, side, j) {
  const { c, sma5, rsi } = p;
  if (setup === "rsi2") return side === "long" ? c[j] > sma5[j] : c[j] < sma5[j];
  if (setup === "cumrsi") return side === "long" ? rsi[j] > 65 : rsi[j] < 35;
  if (setup === "d7") return side === "long" ? c[j] >= maxClose(c, j - 6, j) : c[j] <= minClose(c, j - 6, j);
  return false;
}

/**
 * The close on the NEXT session that would trigger the setup's exit rule,
 * given the bars up to and including j. This is the "exit price" shown.
 */
function exitTriggerPrice(p, setup, side, j) {
  const { c, ag, al } = p;
  if (setup === "rsi2") {
    // close > SMA5 tomorrow ⇔ close > (sum of the last 4 closes) / 4
    return (c[j] + c[j - 1] + c[j - 2] + c[j - 3]) / 4;
  }
  if (setup === "cumrsi") {
    // Wilder RSI(2): RSI > 65 ⇔ avgGain/avgLoss > 65/35 after tomorrow's move.
    if (side === "long") {
      const need = (65 / 35) * al[j] - ag[j];
      return c[j] + Math.max(0, need);
    }
    const need = ag[j] / (35 / 65) - al[j];
    return c[j] - Math.max(0, need);
  }
  if (setup === "d7") {
    // Tomorrow's close becomes the 7-session high/low if it beats the last 6.
    return side === "long" ? maxClose(c, j - 5, j) : minClose(c, j - 5, j);
  }
  return null;
}

function stopFor(p, side, i, isIndex) {
  const { bars, atr } = p;
  const a = atr[i];
  if (a == null) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = i - TS.swingLookback + 1; k <= i; k++) {
    lo = Math.min(lo, bars[k].l);
    hi = Math.max(hi, bars[k].h);
  }
  const raw = side === "long" ? lo - TS.stopAtrBuffer * a : hi + TS.stopAtrBuffer * a;
  return deHuntStop(raw, side, a, bars[i].c, isIndex);
}

/** All non-overlapping trades for one symbol + setup. */
function backtestSetup(p, setup, isIndex) {
  const { bars, c } = p;
  const cost = (isIndex ? TS.costPct.index : TS.costPct.stock) / 100;
  const trades = [];
  let i = 200;
  while (i < bars.length) {
    const side = signalAt(p, setup, i);
    if (!side) {
      i++;
      continue;
    }
    const stop = stopFor(p, side, i, isIndex);
    const sig = {
      setup,
      side,
      signalIdx: i,
      signalDate: bars[i].date,
      signalClose: c[i],
      stop,
      atr: p.atr[i],
      exitTrigger: exitTriggerPrice(p, setup, side, i),
      rsi2: p.rsi[i],
      sma200: p.sma200[i],
      sma5: p.sma5[i],
    };
    if (i + 1 >= bars.length) {
      trades.push({ ...sig, status: "pending" }); // signal on the latest bar
      break;
    }
    const entryIdx = i + 1;
    const entry = bars[entryIdx].o;
    if (stop == null || (side === "long" ? entry <= stop : entry >= stop)) {
      i++; // opened through the stop — no trade
      continue;
    }
    let exitIdx = -1;
    let exitReason = null;
    for (let j = entryIdx; j < bars.length; j++) {
      const stopHit = side === "long" ? c[j] < stop : c[j] > stop;
      if (stopHit) {
        exitIdx = j;
        exitReason = "Stop (closing basis)";
        break;
      }
      if (exitRuleHit(p, setup, side, j)) {
        exitIdx = j;
        exitReason = "Exit rule";
        break;
      }
      if (j - entryIdx + 1 >= TS.maxHold) {
        exitIdx = j;
        exitReason = "Time limit";
        break;
      }
    }
    if (exitIdx === -1) {
      const last = bars.length - 1;
      const mark = c[last];
      const openRet = (side === "long" ? mark / entry - 1 : entry / mark - 1) * 100;
      trades.push({
        ...sig,
        status: "open",
        entryIdx,
        entryDate: bars[entryIdx].date,
        entry,
        heldSessions: last - entryIdx + 1,
        markDate: bars[last].date,
        mark,
        openRetPct: openRet,
        currentExitTrigger: exitTriggerPrice(p, setup, side, last),
        timeExitAfter: TS.maxHold - (last - entryIdx + 1),
      });
      break;
    }
    const exit = c[exitIdx];
    const gross = side === "long" ? exit / entry - 1 : entry / exit - 1;
    trades.push({
      ...sig,
      status: "closed",
      entryIdx,
      entryDate: bars[entryIdx].date,
      entry,
      exitIdx,
      exitDate: bars[exitIdx].date,
      exit,
      exitReason,
      heldSessions: exitIdx - entryIdx + 1,
      retPct: (gross - cost) * 100,
    });
    i = exitIdx + 1;
  }
  return trades;
}

function stats(trades) {
  const rs = trades.map((t) => t.retPct);
  if (!rs.length) return null;
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r <= 0);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const grossWin = sum(wins);
  const grossLoss = -sum(losses);
  return {
    trades: rs.length,
    winRate: wins.length / rs.length,
    avgRetPct: sum(rs) / rs.length,
    avgWinPct: wins.length ? grossWin / wins.length : null,
    avgLossPct: losses.length ? -grossLoss / losses.length : null,
    worstPct: Math.min(...rs),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
  };
}

function qualifies(s) {
  return (
    s != null &&
    s.trades >= TS.minPriorTrades &&
    s.winRate >= TS.minWinRate &&
    s.avgRetPct > 0 &&
    (s.profitFactor ?? 0) >= TS.minProfitFactor
  );
}

/**
 * Backtests every setup for one symbol and attaches, to every signal, the
 * record that was KNOWABLE at the signal date (trades closed before it)
 * and whether that record qualified it.
 */
export function analyzeSymbol(symbol, rawBars, { isIndex = false } = {}) {
  const bars = cleanBars(rawBars);
  if (bars.length < 260) return null;
  const p = prepare(bars);
  const out = [];
  for (const setup of Object.keys(SETUPS)) {
    const trades = backtestSetup(p, setup, isIndex);
    const closed = trades.filter((t) => t.status === "closed");
    for (const t of trades) {
      const prior = closed.filter((x) => x.exitDate < t.signalDate);
      const s = stats(prior);
      out.push({ symbol, ...t, prior: s, qualified: qualifies(s) });
    }
  }
  return { symbol, lastDate: bars[bars.length - 1].date, firstDate: bars[0].date, trades: out };
}

// ---------------------------------------------------------------------
// Aggregation for the UI
// ---------------------------------------------------------------------

function reasonFor(t, isIndex) {
  const setup = SETUPS[t.setup].label;
  const trend =
    t.side === "long"
      ? `above its 200 DMA (₹${r2(t.sma200)}), so the trend is up`
      : `below its 200 DMA (₹${r2(t.sma200)}), so the trend is down`;
  const trigger =
    t.setup === "rsi2"
      ? `RSI(2) at ${t.rsi2.toFixed(1)} — a sharp ${t.side === "long" ? "pullback" : "bounce"} against that trend`
      : t.setup === "cumrsi"
      ? `two-day RSI(2) ${t.side === "long" ? "washed out" : "overheated"} (latest ${t.rsi2.toFixed(1)})`
      : `closed at its ${t.side === "long" ? "lowest" : "highest"} close of 7 sessions`;
  const p = t.prior;
  const record = p
    ? `On ${isIndex ? "BANKNIFTY" : "this stock"}, this setup won ${Math.round(p.winRate * 100)}% of ${p.trades} earlier trades (avg ${p.avgRetPct >= 0 ? "+" : ""}${p.avgRetPct.toFixed(2)}% after costs, worst ${p.worstPct.toFixed(2)}%).`
    : "";
  return `${setup}: ${trend}, with ${trigger}. ${record} Stop is a close beyond ₹${r2(t.stop)} — set past the 5-session ${
    t.side === "long" ? "low" : "high"
  } and away from round numbers so a stop-hunting wick doesn't take you out.`;
}

function toRow(t, isIndex, lot) {
  const p = t.prior ?? {};
  const avgWin = p.avgWinPct;
  const refEntry = t.entry ?? t.signalClose;
  const target = avgWin != null ? (t.side === "long" ? refEntry * (1 + avgWin / 100) : refEntry * (1 - avgWin / 100)) : null;
  return {
    symbol: t.symbol,
    side: t.side,
    setup: t.setup,
    setupLabel: SETUPS[t.setup].label,
    signalDate: t.signalDate,
    signalClose: r2(t.signalClose),
    entryDate: t.entryDate ?? null,
    entry: r2(t.entry ?? null),
    stop: r2(t.stop),
    stopPct: r2(t.stop != null ? (Math.abs(refEntry - t.stop) / refEntry) * 100 : null),
    exitTrigger: r2(t.status === "open" ? t.currentExitTrigger : t.exitTrigger),
    typicalTarget: r2(target),
    maxHold: TS.maxHold,
    lotSize: lot ?? null,
    priorTrades: p.trades ?? 0,
    priorWinRate: p.winRate != null ? Math.round(p.winRate * 1000) / 10 : null,
    priorAvgRetPct: r2(p.avgRetPct),
    priorAvgWinPct: r2(p.avgWinPct),
    priorAvgLossPct: r2(p.avgLossPct),
    priorWorstPct: r2(p.worstPct),
    status: t.status,
    exitDate: t.exitDate ?? null,
    exit: r2(t.exit ?? null),
    exitReason: t.exitReason ?? null,
    heldSessions: t.heldSessions ?? null,
    retPct: r2(t.retPct ?? null),
    markDate: t.markDate ?? null,
    mark: r2(t.mark ?? null),
    openRetPct: r2(t.openRetPct ?? null),
    sessionsLeft: t.timeExitAfter ?? null,
    reason: reasonFor(t, isIndex),
  };
}

function summarise(trades) {
  const s = stats(trades.filter((t) => t.status === "closed"));
  if (!s) return null;
  return {
    trades: s.trades,
    winRatePct: Math.round(s.winRate * 1000) / 10,
    avgRetPct: r2(s.avgRetPct),
    avgWinPct: r2(s.avgWinPct),
    avgLossPct: r2(s.avgLossPct),
    worstPct: r2(s.worstPct),
    profitFactor: s.profitFactor === Infinity ? null : r2(s.profitFactor),
  };
}

/**
 * Builds the response for one section from per-symbol analyses.
 * `date` — the session to show suggestions for (defaults to the latest).
 */
export function buildSection(analyses, { date, isIndex = false, lots = {}, historyDays = 260 }) {
  const all = analyses.filter(Boolean).flatMap((a) => a.trades);
  const latestDate = analyses.filter(Boolean).reduce((m, a) => (a.lastDate > m ? a.lastDate : m), "");
  const target = date && date <= latestDate ? date : latestDate;

  const qualified = all.filter((t) => t.qualified);
  const bySetup = {};
  for (const k of Object.keys(SETUPS)) {
    bySetup[k] = {
      label: SETUPS[k].label,
      source: SETUPS[k].source,
      walkForward: summarise(qualified.filter((t) => t.setup === k)),
      unfiltered: summarise(all.filter((t) => t.setup === k)),
    };
  }

  // Sessions in the browsable window that had at least one qualified signal.
  const allDates = [...new Set(all.map((t) => t.signalDate))].sort();
  const windowStart = allDates[Math.max(0, allDates.length - historyDays)] ?? latestDate;
  const signalDates = [...new Set(qualified.filter((t) => t.signalDate >= windowStart).map((t) => t.signalDate))]
    .sort()
    .reverse();

  const rowsFor = (list) =>
    list
      .map((t) => toRow(t, isIndex, lots[t.symbol]))
      .sort((a, b) => (b.priorWinRate ?? 0) - (a.priorWinRate ?? 0) || (b.priorAvgRetPct ?? 0) - (a.priorAvgRetPct ?? 0));

  return {
    date: target,
    latestDate,
    windowStart,
    signalDates,
    dataFrom: analyses.filter(Boolean).reduce((m, a) => (!m || a.firstDate < m ? a.firstDate : m), null),
    symbolsTested: analyses.filter(Boolean).length,
    walkForward: summarise(qualified),
    unfiltered: summarise(all),
    bySetup,
    suggestions: rowsFor(qualified.filter((t) => t.signalDate === target)),
    // Qualified trades still running as of the latest session — exits to manage.
    openTrades: target === latestDate ? rowsFor(qualified.filter((t) => t.status === "open")) : [],
    rules: {
      minPriorTrades: TS.minPriorTrades,
      minWinRatePct: TS.minWinRate * 100,
      minProfitFactor: TS.minProfitFactor,
      maxHold: TS.maxHold,
      costPct: isIndex ? TS.costPct.index : TS.costPct.stock,
    },
  };
}
