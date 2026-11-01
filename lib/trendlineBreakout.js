// Trendline breakout screen — a falling-trendline breakout out of a base,
// judged on WEEKLY bars against the 30-week moving average.
//
// The shape it looks for:
//   1. A prior spike into a major peak.
//   2. A long downtrend capped by a falling trendline drawn from that peak
//      through later lower swing highs (at least 3 touches, peak included).
//   3. A base near horizontal support, ideally with a brief undercut of
//      that support (a shakeout) that is quickly reclaimed.
//   4. A weekly CLOSE that clears the trendline by 2%+, on volume, with
//      price at or above a 30-week MA that is rising — or still falling
//      but flattening. In the reference chart the MA was still flattening
//      at the breakout and the retest, and only turned up once the rally
//      began; requiring a rising MA would miss the best entry.
//   5. The retest after the breakout holding above the base low.
//
// Pure functions, no I/O. Input is the app's weekly bar shape from
// fetchWeeklyOHLCV in lib/screenerIndicators.js: { t, o, h, l, c, v },
// oldest first. The last bar may be the week still in progress.

export const TLB = {
  smaWeeks: 30, // same 30-week MA as the Stage 2 / Weinstein screens
  volAvgWeeks: 20, // breakout volume baseline
  lookbackWeeks: 104, // fits the 2y weekly fetch the other screens already cache
  minDowntrendWeeks: 20, // peak -> breakout
  minDrawdownPct: 25,
  maxDrawdownPct: 75,
  pivotStrength: 2, // bars either side of a swing high
  touchTolerancePct: 4, // a swing high within 4% under the line is a touch
  minTouches: 3,
  maxWeeksSinceBreakout: 10,
  minBreakoutClearancePct: 2, // close must clear the line by this much
  minBreakoutVolRatio: 1.5, // breakout week (or the week after) vs avg
  maxExtensionPct: 20, // above this, the row is tagged "extended"
  smaSlopeWeeks: 4,
  minSmaSlopePct: -4, // a falling MA passes only if no steeper than this AND decelerating
  smaTolerancePct: 3, // close may sit up to 3% under the MA (retest wicks)
};

export const TLB_STAGE_INFO = {
  "fresh-breakout": { name: "Fresh breakout", tone: "bullish" },
  retest: { name: "Retest", tone: "bullish" },
  "follow-through": { name: "Follow-through", tone: "neutral" },
  extended: { name: "Extended", tone: "neutral" },
};

const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

// Monday-keyed date label for a weekly bar, in IST.
function weekOf(bar) {
  return new Date(bar.t * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function smaSeries(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function pivotHighs(vals, k) {
  const idx = [];
  for (let i = k; i < vals.length - k; i++) {
    let ok = true;
    for (let j = 1; j <= k && ok; j++) {
      if (vals[i - j] >= vals[i]) ok = false;
      if (vals[i + j] > vals[i]) ok = false;
    }
    if (ok) idx.push(i);
  }
  return idx;
}

function argMax(arr, from, to) {
  let best = from;
  for (let i = from + 1; i <= to; i++) if (arr[i] > arr[best]) best = i;
  return best;
}

function argMin(arr, from, to) {
  let best = from;
  for (let i = from + 1; i <= to; i++) if (arr[i] < arr[best]) best = i;
  return best;
}

function avg(arr, from, to) {
  let s = 0;
  let c = 0;
  for (let i = Math.max(0, from); i <= to; i++) {
    s += arr[i];
    c++;
  }
  return c ? s / c : 0;
}

/**
 * Returns null when the shape isn't there, otherwise
 * { status: "match" | "extended", stage, score, ...levels }.
 * Pass { debug: true } to get { rejected: reason } instead of null.
 */
export function analyzeTrendlineBreakout(weeklyBars, opts = {}) {
  const cfg = { ...TLB, ...opts };
  const reject = (reason) => (opts.debug ? { rejected: reason } : null);

  const bars = (weeklyBars || []).filter((b) => b && b.c != null && b.h != null && b.l != null);
  const n = bars.length;
  const last = n - 1;
  if (n < cfg.smaWeeks + cfg.minDowntrendWeeks + 10) return reject("not enough weekly history");

  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);
  const closes = bars.map((b) => b.c);
  const vols = bars.map((b) => b.v ?? 0);
  const ma = smaSeries(closes, cfg.smaWeeks);

  // 1. Major peak, at least minDowntrendWeeks before the latest week.
  const peakSearchFrom = Math.max(0, n - cfg.lookbackWeeks);
  const peakSearchTo = last - cfg.minDowntrendWeeks;
  if (peakSearchTo <= peakSearchFrom) return reject("lookback too short");
  const peakIdx = argMax(highs, peakSearchFrom, peakSearchTo);
  const peakHigh = highs[peakIdx];

  // 2. Steepest falling line from the peak that stays on/above every later
  // swing high, and the FIRST weekly close that clears it. Scanning forward
  // matters: scanning back from today lets the breakout week's own high
  // re-fit the line and fake a later, low-volume "breakout".
  const k = cfg.pivotStrength;
  const ph = pivotHighs(highs, k).filter((i) => i > peakIdx);
  const grace = 1 + cfg.minBreakoutClearancePct / 100;

  let found = null;
  const bMin = Math.max(peakIdx + cfg.minDowntrendWeeks, last - cfg.maxWeeksSinceBreakout);
  for (let b = bMin; b <= last && !found; b++) {
    const pivots = ph.filter((i) => i + k < b); // swing highs confirmed before b
    if (pivots.length === 0) continue;

    let slope = -Infinity;
    for (const i of pivots) slope = Math.max(slope, (highs[i] - peakHigh) / (i - peakIdx));
    if (!(slope < 0)) continue;
    const line = (x) => peakHigh + slope * (x - peakIdx);

    // No close clearing the line before b. Same threshold as the breakout
    // itself, so a marginal poke neither counts nor invalidates the line.
    let clean = true;
    for (let i = peakIdx + 1; i < b; i++) {
      if (closes[i] > line(i) * grace) {
        clean = false;
        break;
      }
    }
    if (!clean) continue;

    const touches =
      1 + pivots.filter((i) => ((line(i) - highs[i]) / line(i)) * 100 <= cfg.touchTolerancePct).length;
    if (touches < cfg.minTouches) continue;

    if (closes[b] > line(b) * grace && closes[b - 1] <= line(b - 1) * grace) {
      found = { b, slope, touches, line };
    }
  }
  if (!found) return reject("no recent weekly close above a falling trendline");
  const { b, slope, touches, line } = found;

  // 3. Base low before the breakout, and not undercut since.
  const baseIdx = argMin(lows, peakIdx + 1, last);
  if (baseIdx >= b) return reject("new low after breakout (failed breakout)");
  const baseLow = lows[baseIdx];
  const drawdownPct = ((peakHigh - baseLow) / peakHigh) * 100;
  if (drawdownPct < cfg.minDrawdownPct || drawdownPct > cfg.maxDrawdownPct) {
    return reject(`decline ${round(drawdownPct)}% outside range`);
  }

  // 4. At/above a rising-or-flattening 30-week MA.
  const maNow = ma[last];
  const maPrev = ma[last - cfg.smaSlopeWeeks];
  if (maNow == null || maPrev == null) return reject("30-week MA not available");
  if (closes[last] < maNow * (1 - cfg.smaTolerancePct / 100)) return reject("close below 30-week MA");
  const smaSlopePct = ((maNow - maPrev) / maPrev) * 100;
  const maPrev2 = ma[last - 2 * cfg.smaSlopeWeeks];
  const prevSlopePct = maPrev2 == null ? -Infinity : ((maPrev - maPrev2) / maPrev2) * 100;
  const flattening = smaSlopePct >= cfg.minSmaSlopePct && smaSlopePct > prevSlopePct;
  if (smaSlopePct < 0 && !flattening) return reject(`30-week MA still falling (${round(smaSlopePct)}%)`);
  const smaRising = smaSlopePct > 0;

  // Volume over the breakout week and the week after (two-week thrust).
  const volBase = avg(vols, b - cfg.volAvgWeeks, b - 1);
  const thrustVol = Math.max(vols[b], b + 1 <= last ? vols[b + 1] : 0);
  const breakoutVolRatio = volBase > 0 ? thrustVol / volBase : 0;
  if (breakoutVolRatio < cfg.minBreakoutVolRatio) {
    return reject(`breakout volume ${round(breakoutVolRatio)}x below threshold`);
  }

  // 5. Shakeout: support = lowest low 3–12 weeks before the base low; the
  // base low undercuts it by 1–12% and a close is back above within 4 weeks.
  let shakeout = false;
  let supportLevel = null;
  const sFrom = Math.max(peakIdx + 1, baseIdx - 12);
  const sTo = baseIdx - 3;
  if (sTo >= sFrom) {
    const lvl = lows[argMin(lows, sFrom, sTo)];
    const undercutPct = ((lvl - baseLow) / lvl) * 100;
    if (undercutPct >= 1 && undercutPct <= 12) {
      for (let j = baseIdx + 1; j <= Math.min(last, baseIdx + 4); j++) {
        if (closes[j] > lvl) {
          shakeout = true;
          supportLevel = lvl;
          break;
        }
      }
    }
  }

  // Prior spike into the peak (vs the lowest low of the 26 weeks before it).
  let priorSpikePct = null;
  if (peakIdx >= 4) {
    const preLow = Math.min(...lows.slice(Math.max(0, peakIdx - 26), peakIdx));
    priorSpikePct = ((peakHigh - preLow) / preLow) * 100;
  }

  const lineAtB = line(b);
  const extensionPct = ((closes[last] - lineAtB) / lineAtB) * 100;
  const weeksSinceBreakout = last - b;

  let stage;
  if (weeksSinceBreakout <= 1) stage = "fresh-breakout";
  else if (closes[last] <= Math.max(line(last), maNow) * 1.05) stage = "retest";
  else stage = "follow-through";

  let score = 0;
  score += (Math.min(touches, 5) / 5) * 20;
  score += Math.min(breakoutVolRatio / 3, 1) * 20;
  if (shakeout) score += 15;
  if (priorSpikePct != null && priorSpikePct >= 40) score += 10;
  if (smaRising) score += 10;
  if (drawdownPct >= 30 && drawdownPct <= 60) score += 10;
  if (weeksSinceBreakout <= 4) score += 15;

  const status = extensionPct > cfg.maxExtensionPct ? "extended" : "match";

  return {
    status,
    stage,
    score: Math.round(score),
    close: closes[last],
    peakWeekOf: weekOf(bars[peakIdx]),
    peakHigh: round(peakHigh),
    baseLowWeekOf: weekOf(bars[baseIdx]),
    baseLow: round(baseLow),
    drawdownPct: round(drawdownPct, 1),
    downtrendWeeks: b - peakIdx,
    trendlineSlopePctPerWeek: round((slope / peakHigh) * 100, 3),
    trendlineTouches: touches,
    trendlineAtBreakout: round(lineAtB),
    trendlineNow: round(line(last)),
    breakoutWeekOf: weekOf(bars[b]),
    breakoutClose: round(closes[b]),
    weeksSinceBreakout,
    breakoutVolRatio: round(breakoutVolRatio),
    ma30: round(maNow),
    ma30SlopePct: round(smaSlopePct),
    ma30Rising: smaRising,
    extensionPct: round(extensionPct, 1),
    shakeout,
    supportLevel: round(supportLevel),
    priorSpikePct: round(priorSpikePct, 1),
    // Invalidation: a weekly close back under the base low.
    stopLevel: round(baseLow),
  };
}
