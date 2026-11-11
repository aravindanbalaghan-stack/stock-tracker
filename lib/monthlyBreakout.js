// Monthly breakout — a stock clearing the highest monthly high it has
// printed in a long time, after spending at least a year below it.
//
// WHY MONTHLY
// A monthly high that has capped price for 12+ months is the level the
// whole market has been watching (and selling into). When price finally
// closes above it, everyone who bought near that high and waited to "get
// out at breakeven" has been absorbed — there's no overhead supply left
// until the next, much older, high. Monthly charts filter out the noise
// that daily and weekly breakouts are full of.
//
// THE RULES
//   Base high (H)  the highest monthly HIGH across every COMPLETED month
//                  available (up to 10 years)
//   Base length    H must have been set at least 12 months before the
//                  breakout month — "after a good amount of time"
//   Base depth     price must have pulled back at least 15% from H at some
//                  point since (a real base, not a stock grinding along
//                  its highs) and not more than 70% (a broken stock)
//   Breakout       measured on CLOSES, never on an intraday spike:
//     "Breaking out"   the latest daily close is above H in the month in
//                      progress (last month closed at or below it)
//     "Confirmed"      last month CLOSED above H for the first time, and
//                      the latest close is still above H
//   Not extended   latest close no more than 15% above H
//
// SHOWN, NOT FILTERED
//   Volume         this month's volume projected to a full month vs the
//                  average of the 12 completed months before it
//   All-time high  H is the highest high in the whole history fetched
//                  (needs at least 5 years of data to be called that)
//   Failure line   a monthly close back below H would void the breakout

export const MB = {
  minBaseMonths: 12,
  minDepthPct: 15,
  maxDepthPct: 70,
  maxAbovePct: 15,
  athMinMonths: 60,
};

const monthKeyOfEpoch = (t) => new Date((t + 19800) * 1000).toISOString().slice(0, 7);
const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const pct = (a, b) => ((a - b) / b) * 100;

/**
 * Completed months from Yahoo's monthly bars (anything in or after the
 * as-of month is dropped), plus the month in progress rebuilt from the
 * bhavcopy daily rows of that month — so a historical run never sees
 * prices after its date, and a holiday can't add a fake session.
 */
export function buildMonthly(yahooMonthly, series, asOfDate) {
  const curKey = asOfDate.slice(0, 7);
  const completed = (yahooMonthly ?? [])
    .map((b) => ({ key: monthKeyOfEpoch(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 }))
    .filter((b) => b.key < curKey);
  const days = series.filter((d) => d.date.slice(0, 7) === curKey && d.date <= asOfDate && d.close != null);
  if (!days.length) return null;
  const current = {
    key: curKey,
    o: days[0].open ?? days[0].close,
    h: Math.max(...days.map((d) => d.high ?? d.close)),
    l: Math.min(...days.map((d) => d.low ?? d.close)),
    c: days[days.length - 1].close,
    v: days.reduce((a, d) => a + (d.volume || 0), 0),
    sessions: days.length,
  };
  return { completed, current };
}

function baseFor(months, breakoutIdx) {
  // Highest high in all months BEFORE breakoutIdx, and where it was set.
  let hi = -Infinity;
  let at = -1;
  for (let i = 0; i < breakoutIdx; i++) {
    if (months[i].h > hi) {
      hi = months[i].h;
      at = i;
    }
  }
  if (at < 0) return null;
  let lo = Infinity;
  for (let i = at; i < breakoutIdx; i++) lo = Math.min(lo, months[i].l);
  return { high: hi, at, ageMonths: breakoutIdx - at, depthPct: ((hi - lo) / hi) * 100, low: lo };
}

export function analyzeMonthlyBreakout(built) {
  if (!built) return null;
  const { completed, current } = built;
  if (completed.length < MB.minBaseMonths + 2) return null;
  const all = [...completed, current];
  const n = all.length - 1; // index of the month in progress

  const candidates = [];
  // A) Breaking out in the month in progress.
  {
    const base = baseFor(all, n);
    if (base && current.c > base.high && all[n - 1].c <= base.high) candidates.push({ status: "Breaking out", idx: n, base });
  }
  // B) Last completed month closed above for the first time; still holding.
  {
    const L = n - 1;
    const base = baseFor(all, L);
    if (base && all[L].c > base.high && all[L - 1].c <= base.high && current.c > base.high) {
      candidates.push({ status: "Confirmed", idx: L, base });
    }
  }

  for (const cand of candidates) {
    const { base } = cand;
    if (base.ageMonths < MB.minBaseMonths) continue;
    if (base.depthPct < MB.minDepthPct || base.depthPct > MB.maxDepthPct) continue;
    const abovePct = pct(current.c, base.high);
    if (abovePct > MB.maxAbovePct) continue;

    // Volume: the breakout month (projected to ~21 sessions if still in
    // progress) against the 12 completed months before it.
    const prior = all.slice(Math.max(0, cand.idx - 12), cand.idx).map((m) => m.v).filter((v) => v > 0);
    const avgVol = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : null;
    const bVol = cand.idx === n ? (current.v / Math.max(1, current.sessions)) * 21 : all[cand.idx].v;
    const volRatio = avgVol ? bVol / avgVol : null;

    const isAth = completed.length >= MB.athMinMonths && base.high >= Math.max(...all.slice(0, cand.idx).map((m) => m.h));
    const baseYears = base.ageMonths / 12;
    const reason =
      `${cand.status === "Confirmed" ? `Closed ${all[cand.idx].key} above` : "Trading above"} the ₹${r2(base.high)} monthly high ` +
      `set in ${all[base.at].key} — ${base.ageMonths} months (${baseYears.toFixed(1)} years) of base, ${r2(base.depthPct)}% deep` +
      `${isAth ? ", at an all-time high in the data" : ""}. ` +
      `${volRatio != null ? `Breakout-month volume ${r2(volRatio)}× its 12-month average${cand.idx === n ? " (projected)" : ""}. ` : ""}` +
      `A monthly close back below ₹${r2(base.high)} would void it.`;

    return {
      mbStatus: cand.status,
      mbStatusRank: cand.status === "Breaking out" ? 1 : 2,
      mbBaseHigh: r2(base.high),
      mbBaseHighMonth: all[base.at].key,
      mbBaseMonths: base.ageMonths,
      mbBaseDepthPct: r2(base.depthPct),
      mbBaseLow: r2(base.low),
      mbAboveHighPct: r2(abovePct),
      mbVolRatio: r2(volRatio),
      mbAllTimeHigh: isAth,
      mbBreakoutMonth: all[cand.idx].key,
      mbMonthsOfData: completed.length,
      reason,
    };
  }
  return null;
}
