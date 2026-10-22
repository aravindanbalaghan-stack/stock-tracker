// Bullish candlestick patterns, detected on OHLC bars (used on weekly bars
// by the Personal learning screen).
//
// Two families, treated differently on purpose:
//
//  - REVERSAL patterns (hammer, engulfing, morning star…) only mean
//    anything after a decline. The same shape at the top of a run is a
//    different, often bearish, signal — a "hammer" after a rally is a
//    hanging man. So each reversal pattern also requires a pullback into
//    it: the close before the pattern below the close three bars earlier.
//    In a stock already above its 30-week MA, that's a pullback inside an
//    uptrend ending with a bullish candle — the setup this screen is after.
//
//  - CONTINUATION / STRENGTH patterns (three white soldiers, rising three
//    methods, marubozu) need no prior decline.
//
// Rules follow the standard textbook definitions (Nison; Bulkowski),
// with two practical relaxations for weekly Indian equity bars: weekly
// gaps are rare, so patterns that classically need a gap (morning star,
// piercing line) accept an open at or near the prior close instead; and
// "long" / "small" bodies are judged against the stock's own average
// body over the previous 10 bars rather than a fixed %.
//
// Detection is shape-only. Chart patterns (cup & handle, flags,
// triangles, double bottoms) need a judgment of structure over many bars
// and aren't attempted here.

const AVG_BODY_BARS = 10;

function parts(b) {
  const body = Math.abs(b.c - b.o);
  const range = b.h - b.l;
  return {
    body,
    range,
    upper: b.h - Math.max(b.o, b.c),
    lower: Math.min(b.o, b.c) - b.l,
    bull: b.c > b.o,
    bear: b.c < b.o,
    mid: (b.o + b.c) / 2,
  };
}

function valid(b) {
  return b && b.o != null && b.h != null && b.l != null && b.c != null && b.h >= b.l && b.h > 0;
}

function avgBody(bars, i) {
  const from = Math.max(0, i - AVG_BODY_BARS);
  const xs = bars.slice(from, i).filter(valid).map((b) => Math.abs(b.c - b.o));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** A pullback into bar s: the close before s is below the close 3 bars before that. */
function pullbackInto(bars, s) {
  const a = bars[s - 1];
  const b = bars[s - 4];
  return a && b && a.c < b.c;
}

const isDoji = (p) => p.range > 0 && p.body <= 0.1 * p.range;

/**
 * Each detector gets (bars, i) where i is the LAST bar of the pattern,
 * and returns true/false. All bars from i-(size-1) to i must be valid.
 */
export const BULLISH_PATTERNS = [
  // ---- single bar -----------------------------------------------------
  {
    name: "Hammer",
    size: 1,
    kind: "reversal",
    test(bars, i) {
      const p = parts(bars[i]);
      return p.range > 0 && p.body > 0 && p.lower >= 2 * p.body && p.upper <= Math.max(0.1 * p.range, 0.5 * p.body) && pullbackInto(bars, i);
    },
  },
  {
    name: "Inverted Hammer",
    size: 1,
    kind: "reversal",
    test(bars, i) {
      const p = parts(bars[i]);
      return p.range > 0 && p.body > 0 && p.upper >= 2 * p.body && p.lower <= Math.max(0.1 * p.range, 0.5 * p.body) && pullbackInto(bars, i);
    },
  },
  {
    name: "Dragonfly Doji",
    size: 1,
    kind: "reversal",
    test(bars, i) {
      const p = parts(bars[i]);
      return isDoji(p) && p.lower >= 0.6 * p.range && p.upper <= 0.1 * p.range && pullbackInto(bars, i);
    },
  },
  {
    name: "Bullish Belt Hold",
    size: 1,
    kind: "reversal",
    test(bars, i) {
      const p = parts(bars[i]);
      const ab = avgBody(bars, i);
      return p.bull && p.lower <= 0.05 * p.range && p.body >= 0.6 * p.range && ab && p.body >= ab && pullbackInto(bars, i);
    },
  },
  {
    name: "Bullish Marubozu",
    size: 1,
    kind: "continuation",
    test(bars, i) {
      const p = parts(bars[i]);
      const ab = avgBody(bars, i);
      return p.bull && p.range > 0 && p.body >= 0.9 * p.range && ab && p.body >= 1.3 * ab;
    },
  },

  // ---- two bars -------------------------------------------------------
  {
    name: "Bullish Engulfing",
    size: 2,
    kind: "reversal",
    test(bars, i) {
      const a = bars[i - 1];
      const b = bars[i];
      const pa = parts(a);
      const pb = parts(b);
      return pa.bear && pb.bull && b.o <= a.c && b.c >= a.o && pb.body > pa.body && pullbackInto(bars, i - 1);
    },
  },
  {
    name: "Piercing Line",
    size: 2,
    kind: "reversal",
    test(bars, i) {
      const a = bars[i - 1];
      const b = bars[i];
      const pa = parts(a);
      const pb = parts(b);
      const ab = avgBody(bars, i - 1);
      return pa.bear && ab && pa.body >= ab && pb.bull && b.o <= a.c && b.c > pa.mid && b.c < a.o && pullbackInto(bars, i - 1);
    },
  },
  {
    name: "Bullish Harami",
    size: 2,
    kind: "reversal",
    test(bars, i) {
      const a = bars[i - 1];
      const b = bars[i];
      const pa = parts(a);
      const pb = parts(b);
      const ab = avgBody(bars, i - 1);
      return (
        pa.bear && ab && pa.body >= ab && pb.bull && !isDoji(pb) &&
        b.o >= a.c && b.c <= a.o && pb.body <= 0.6 * pa.body && pullbackInto(bars, i - 1)
      );
    },
  },
  {
    name: "Bullish Harami Cross",
    size: 2,
    kind: "reversal",
    test(bars, i) {
      const a = bars[i - 1];
      const b = bars[i];
      const pa = parts(a);
      const pb = parts(b);
      const ab = avgBody(bars, i - 1);
      return (
        pa.bear && ab && pa.body >= ab && isDoji(pb) &&
        Math.min(b.o, b.c) >= a.c && Math.max(b.o, b.c) <= a.o && pullbackInto(bars, i - 1)
      );
    },
  },
  {
    name: "Tweezer Bottom",
    size: 2,
    kind: "reversal",
    test(bars, i) {
      const a = bars[i - 1];
      const b = bars[i];
      return parts(a).bear && parts(b).bull && Math.abs(a.l - b.l) <= 0.003 * b.c && pullbackInto(bars, i - 1);
    },
  },
  {
    name: "Bullish Kicker",
    size: 2,
    kind: "reversal",
    test(bars, i) {
      const a = bars[i - 1];
      const b = bars[i];
      const pb = parts(b);
      const ab = avgBody(bars, i);
      // A true kicker gaps: the whole up candle sits above the down
      // candle's open, so the two bodies don't overlap at all.
      return parts(a).bear && pb.bull && b.o > a.o && b.l >= a.o && ab && pb.body >= ab;
    },
  },

  // ---- three bars -----------------------------------------------------
  {
    name: "Morning Star",
    size: 3,
    kind: "reversal",
    test(bars, i) {
      const a = bars[i - 2];
      const m = bars[i - 1];
      const b = bars[i];
      const pa = parts(a);
      const pm = parts(m);
      const ab = avgBody(bars, i - 2);
      return (
        pa.bear && ab && pa.body >= ab && !isDoji(pm) && pm.body <= 0.4 * pa.body &&
        Math.max(m.o, m.c) <= a.c + 0.25 * pa.body &&
        parts(b).bull && b.c > pa.mid && pullbackInto(bars, i - 2)
      );
    },
  },
  {
    name: "Morning Doji Star",
    size: 3,
    kind: "reversal",
    test(bars, i) {
      const a = bars[i - 2];
      const m = bars[i - 1];
      const b = bars[i];
      const pa = parts(a);
      const ab = avgBody(bars, i - 2);
      return (
        pa.bear && ab && pa.body >= ab && isDoji(parts(m)) &&
        Math.max(m.o, m.c) <= a.c + 0.25 * pa.body &&
        parts(b).bull && b.c > pa.mid && pullbackInto(bars, i - 2)
      );
    },
  },
  {
    name: "Three Inside Up",
    size: 3,
    kind: "reversal",
    test(bars, i) {
      const a = bars[i - 2];
      const m = bars[i - 1];
      const b = bars[i];
      const pa = parts(a);
      const pm = parts(m);
      return (
        pa.bear && pm.bull && m.o >= a.c && m.c <= a.o && pm.body <= 0.6 * pa.body &&
        parts(b).bull && b.c > a.o && pullbackInto(bars, i - 2)
      );
    },
  },
  {
    name: "Three Outside Up",
    size: 3,
    kind: "reversal",
    test(bars, i) {
      const a = bars[i - 2];
      const m = bars[i - 1];
      const b = bars[i];
      const pa = parts(a);
      const pm = parts(m);
      return (
        pa.bear && pm.bull && m.o <= a.c && m.c >= a.o && pm.body > pa.body &&
        parts(b).bull && b.c > m.c && pullbackInto(bars, i - 2)
      );
    },
  },
  {
    name: "Three White Soldiers",
    size: 3,
    kind: "continuation",
    test(bars, i) {
      const ab = avgBody(bars, i - 2);
      if (!ab) return false;
      for (let k = i - 2; k <= i; k++) {
        const p = parts(bars[k]);
        if (!p.bull || p.body < 0.6 * ab || p.upper > 0.35 * p.body) return false;
        if (k > i - 2) {
          const prev = bars[k - 1];
          if (bars[k].c <= prev.c || bars[k].o < prev.o || bars[k].o > prev.c) return false;
        }
      }
      return true;
    },
  },

  // ---- five bars ------------------------------------------------------
  {
    name: "Rising Three Methods",
    size: 5,
    kind: "continuation",
    test(bars, i) {
      const first = bars[i - 4];
      const last = bars[i];
      const pf = parts(first);
      const pl = parts(last);
      const ab = avgBody(bars, i - 4);
      if (!pf.bull || !ab || pf.body < ab || !pl.bull || pl.body < 0.8 * ab || last.c <= first.c) return false;
      for (let k = i - 3; k <= i - 1; k++) {
        const p = parts(bars[k]);
        if (p.body > 0.6 * pf.body || bars[k].h > first.h || bars[k].l < first.l) return false;
      }
      return true;
    },
  },
];

/**
 * Bullish patterns completing on bar `i`.
 * Returns [{ name, kind }].
 */
export function bullishPatternsAt(bars, i) {
  const found = [];
  for (const pat of BULLISH_PATTERNS) {
    const start = i - (pat.size - 1);
    // Context checks reach back up to 4 bars before the pattern, plus the
    // 10-bar average body.
    if (start - 4 < 0) continue;
    let ok = true;
    for (let k = start - 4; k <= i; k++) {
      if (!valid(bars[k])) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    try {
      if (pat.test(bars, i)) found.push({ name: pat.name, kind: pat.kind });
    } catch {
      /* malformed bar — skip this pattern */
    }
  }
  return found;
}

export const BULLISH_PATTERN_NAMES = BULLISH_PATTERNS.map((p) => p.name);
