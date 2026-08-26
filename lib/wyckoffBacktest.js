// Backtests the two Wyckoff entry styles the Wyckoff screener tab shows —
// Aggressive (Spring/Shakeout) and Conservative (Last Point of Support) —
// over the trailing 6 months, and reduces the result to a single win
// probability per stance. The per-trade detail is intentionally NOT
// exposed by the API: the person asked for the probability, not a trade
// log, and a trade log invites re-deriving conclusions from a small,
// noisy sample instead of trusting the summary stat it was built for.
//
// METHODOLOGY (stated once, here, rather than scattered as magic numbers):
//   - Universe: the same wide universe (~500 stocks, NIFTY 500 or the
//     top-500-by-turnover fallback) the live Wyckoff/Stage-2 screens use,
//     capped for compute cost — see SAMPLE_CAP.
//   - Signal: every Aggressive/Conservative entry findWyckoffEntriesSince
//     locates across a stock's history in the last LOOKBACK_DAYS.
//   - Outcome: from the NEXT trading session's OPEN after the signal
//     (a realistic fill price — you can't transact at the signal bar's
//     own low/close), up to HORIZON_DAYS trading days forward. A WIN is a
//     forward bar whose HIGH reaches fill price * (1 + TARGET_PCT/100)
//     before any forward bar's LOW touches fill price * (1 - STOP_PCT/100).
//     A LOSS is the reverse ordering. A signal with fewer than
//     HORIZON_DAYS of bars remaining after it (too recent to have played
//     out) is excluded from the probability, not counted as a loss.
//   - Probability = wins / (wins + losses) per stance, independently.
// These are deliberately simple, symmetric R-multiple-style rules (target
// and stop expressed as plain % on the underlying) rather than anything
// tuned — the point is an honest read on the setup, not a curve-fit one.

import { findWyckoffEntriesSince } from "@/lib/stageAnalysis";
import { fetchDailyOHLCVBatch, symbolSeries } from "@/lib/screenerIndicators";
import { resolveWideUniverse } from "@/lib/nifty500";
import { getRecentBhavcopies } from "@/lib/nseBhavcopy";

const LOOKBACK_DAYS = 183; // ~6 months
const HORIZON_DAYS = 20; // ~1 trading month to let the trade play out
const TARGET_PCT = 5;
const STOP_PCT = 4;
// Backtesting is O(episodes) per stock but still means a full daily-history
// fetch per symbol, same as the live Wyckoff scan. Capped independently and
// kept smaller, since this runs as its own request rather than piggybacking
// on a screen the person is already waiting on.
const SAMPLE_CAP = 180;
const FETCH_CONCURRENCY = 10;

function evaluateOutcome(dailyBars, signal) {
  const startIdx = signal.idx + 1;
  if (startIdx <= 0 || startIdx >= dailyBars.length) return null;
  // Realistic fill: the NEXT session's open, not the signal day's own
  // price. This matters most for Aggressive — its "price" is the day's
  // own low by construction (that's what "undercut the range" means), so
  // testing the -stopPct condition against that price is nearly
  // unhittable and inflates the win rate. Using the next open removes
  // that lookahead-flavoured bias for both stances.
  const fillBar = dailyBars[startIdx];
  const entryPrice = fillBar.o ?? signal.price;
  if (entryPrice == null) return null;
  const window = dailyBars.slice(startIdx, startIdx + HORIZON_DAYS);
  if (window.length < HORIZON_DAYS) return null; // hasn't had time to play out yet

  const targetPrice = entryPrice * (1 + TARGET_PCT / 100);
  const stopPrice = entryPrice * (1 - STOP_PCT / 100);
  for (const bar of window) {
    const hitTarget = bar.h >= targetPrice;
    const hitStop = bar.l <= stopPrice;
    if (hitTarget && hitStop) {
      // Ambiguous same-bar touch — assume the worse fill (stop first),
      // which is the conservative assumption for a probability estimate.
      return "loss";
    }
    if (hitTarget) return "win";
    if (hitStop) return "loss";
  }
  // Neither level touched within the horizon — resolve by the final bar's
  // close relative to entry, same "up or down" sense as a win/loss.
  return window[window.length - 1].c >= entryPrice ? "win" : "loss";
}

let cache = null; // { computedAt, result }
const CACHE_MS = 12 * 60 * 60 * 1000; // 12h — this is a slow-moving statistic

export async function getWyckoffBacktest({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.computedAt < CACHE_MS) {
    return cache.result;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const sinceEpoch = nowSec - LOOKBACK_DAYS * 86400;

  // Reuse whatever wide-universe resolution the live screens use, so the
  // backtest is drawn from the same population the Wyckoff tab scans —
  // not a hand-picked or different list. A short bhavcopy window is enough
  // just to build the {symbol, series} shape resolveWideUniverse needs
  // (for the NSE-unreachable turnover fallback); it isn't the backtest
  // window itself.
  const recentDays = await getRecentBhavcopies(10, 25);
  const latestDay = recentDays[recentDays.length - 1];
  const bhavUniverse = latestDay
    ? [...latestDay.bySymbol.entries()]
        .filter(([, row]) => row.series === "EQ" && row.volume && row.close != null)
        .map(([symbol]) => ({ symbol, series: symbolSeries(symbol, recentDays) }))
    : [];
  const resolved = await resolveWideUniverse(bhavUniverse);
  const symbols = resolved.symbols.slice(0, SAMPLE_CAP);

  const history = await fetchDailyOHLCVBatch(symbols, { concurrency: FETCH_CONCURRENCY, range: "2y" });

  let aggWins = 0, aggLosses = 0, aggPending = 0;
  let consWins = 0, consLosses = 0, consPending = 0;
  let scanned = 0;

  for (const symbol of symbols) {
    const hist = history.get(symbol);
    if (!hist?.bars?.length) continue;
    scanned++;
    const signals = findWyckoffEntriesSince(hist.bars, sinceEpoch);
    for (const sig of signals) {
      const outcome = evaluateOutcome(hist.bars, sig);
      if (sig.stance === "Aggressive") {
        if (outcome === "win") aggWins++;
        else if (outcome === "loss") aggLosses++;
        else aggPending++;
      } else {
        if (outcome === "win") consWins++;
        else if (outcome === "loss") consLosses++;
        else consPending++;
      }
    }
  }

  const pct = (w, l) => (w + l > 0 ? Math.round((w / (w + l)) * 1000) / 10 : null);

  const result = {
    computedAt: new Date().toISOString(),
    lookbackDays: LOOKBACK_DAYS,
    horizonDays: HORIZON_DAYS,
    targetPct: TARGET_PCT,
    stopPct: STOP_PCT,
    universeSize: symbols.length,
    scanned,
    aggressive: { probability: pct(aggWins, aggLosses), sampleSize: aggWins + aggLosses, pending: aggPending },
    conservative: { probability: pct(consWins, consLosses), sampleSize: consWins + consLosses, pending: consPending },
  };

  cache = { computedAt: Date.now(), result };
  return result;
}
