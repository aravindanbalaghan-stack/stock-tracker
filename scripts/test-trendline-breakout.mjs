// Self-check for lib/trendlineBreakout.js on synthetic weekly bars shaped
// like the reference chart, plus shapes that must NOT match.
// Run: node --no-warnings scripts/test-trendline-breakout.mjs
import assert from "node:assert/strict";
import { analyzeTrendlineBreakout } from "../lib/trendlineBreakout.js";

let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const lerp = (a, b, steps) => Array.from({ length: steps }, (_, i) => a + ((b - a) * (i + 1)) / steps);

function build(closes, volumes) {
  const start = Date.UTC(2024, 0, 1) / 1000; // a Monday
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    const wick = Math.abs(rand()) * 0.03 * c;
    return {
      t: start + i * 7 * 86400,
      o,
      h: Math.max(o, c) + wick,
      l: Math.min(o, c) - wick,
      c,
      v: volumes?.[i] ?? 1_000_000 * (1 + rand() * 0.3),
    };
  });
}

// flat -> spike -> downtrend with 3 lower highs on one falling line ->
// base with a shakeout below support -> breakout week on 3.5x volume
function referenceSeries(after) {
  const closes = [];
  closes.push(...Array.from({ length: 30 }, () => 100 + rand() * 4));
  closes.push(...lerp(100, 160, 6));
  closes.push(
    150, 142, 136, 132, 131, 135, 139, 143, 145,
    139, 133, 128, 124, 121, 119, 121, 124,
    126, 124, 122, 124, 126, 127,
    121, 115, 110, 106, 102, 99, 102, 105,
    107, 108, 109, 111,
    106, 101, 97, 94, 93, 94, 92, 93,
    89, 84, 87, 91,
    91, 92, 92,
  );
  const bIdx = closes.length;
  closes.push(104, ...after);
  const vols = closes.map((_, i) => (i === bIdx ? 3_500_000 : 1_000_000 * (1 + rand() * 0.3)));
  return { bars: build(closes, vols), bIdx };
}

function cases() {
  const out = [];
  out.push(["retest", referenceSeries([101, 98, 103]).bars, "match"]);
  out.push(["ran away", referenceSeries([110, 117, 124, 130, 136, 140, 145, 148]).bars, "extended"]);
  out.push(["failed breakout", referenceSeries([95, 86, 80, 74]).bars, null]);
  out.push([
    "still in downtrend",
    build([...Array.from({ length: 30 }, () => 100 + rand() * 4), ...lerp(100, 160, 6), ...lerp(158, 90, 40)]),
    null,
  ]);
  const { bars, bIdx } = referenceSeries([101, 103]);
  bars[bIdx].v = 1_000_000;
  out.push(["no volume", bars, null]);
  return out;
}

// Named cases, with reasons printed.
for (const [name, bars, want] of cases()) {
  const r = analyzeTrendlineBreakout(bars);
  const dbg = analyzeTrendlineBreakout(bars, { debug: true });
  console.log(name.padEnd(18), "->", r ? `${r.status} / ${r.stage} / score ${r.score}` : `no match (${dbg.rejected})`);
  assert.equal(r ? r.status : null, want, name);
}
const ref = analyzeTrendlineBreakout(referenceSeries([101, 98, 103]).bars);
assert.ok(ref.trendlineTouches >= 3 && ref.shakeout, "reference: touches + shakeout");
if (ref.status !== "match") throw new Error("unreachable");

// Robustness: same shapes, 300 different noise seeds.
let wrong = 0;
for (let s = 1; s <= 300; s++) {
  seed = s * 7919;
  for (const [name, bars, want] of cases()) {
    const r = analyzeTrendlineBreakout(bars);
    if ((r ? r.status : null) !== want) {
      wrong++;
      if (wrong <= 5) console.log("  mismatch:", name, "seed", s, analyzeTrendlineBreakout(bars, { debug: true }));
    }
  }
}
console.log(`robustness: ${300 * 5 - wrong}/${300 * 5} correct`);
assert.equal(wrong, 0);
console.log("All trendline-breakout checks passed.");
