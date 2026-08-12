import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { getResolvedSectorList } from "@/lib/sectorOverrides";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// WHAT THIS IS, AND WHAT IT ISN'T
//
// This studies the delivery events that DID run 20%+ and reports what they
// had in common, then flags today's events sharing those traits.
//
// It is pattern-matching over ~3 months of NSE data. It is NOT a
// prediction, and the numbers it reports are historical outcomes of past
// setups, not expected returns. Three reasons to treat it sceptically,
// all surfaced in the response so the UI can state them rather than
// implying more confidence than the data supports:
//
//  1. The hit rate is the headline. If 18% of matching setups reached
//     +20%, then 82% did not. `hitRate` and `sampleSize` are always
//     returned and the UI leads with them.
//  2. The sample is small and one-regime. A few hundred events from a
//     single quarter of one market cannot establish that a pattern
//     generalises. Traits found this way partly describe that quarter.
//  3. The traits are selected BY the outcome, so some will be noise that
//     happened to correlate. `lift` shows how much better than the base
//     rate each trait actually did — a lift near 1.0 means it told you
//     nothing.
// ---------------------------------------------------------------------------

const AVG_WINDOW = 30;
// Events need room to play out before their outcome means anything.
const STUDY_LOOKBACK = 60;
const MIN_FOLLOW_DAYS = 10;
const BHAV_WINDOW = STUDY_LOOKBACK + AVG_WINDOW + 5;
// A backtest needs history on BOTH sides of the split date: enough before
// it to learn a pattern from, and enough after it for the flagged setups
// to actually resolve. Without the extra room the "test" would just be
// the study measured against itself.
const BACKTEST_BHAV_WINDOW = BHAV_WINDOW + 45;

const DELIVERY_MIN = 70;
const VOL_MULTIPLE = 2;
const TARGET_MOVE = 20; // the "max up 20%" the study is built around

// Candidates are recent events that haven't had time to resolve yet.
const CANDIDATE_MAX_AGE = 10;

function pct(from, to) {
  if (!from || from <= 0 || to == null) return null;
  return Math.round(((to - from) / from) * 10000) / 100;
}

/**
 * Traits are deliberately coarse buckets rather than fine thresholds.
 * With a few hundred events, fine-grained cuts would fit noise; a handful
 * of wide buckets at least has enough observations per bucket to mean
 * something.
 */
function traitsOf(ev) {
  const t = [];
  if (ev.eventVolumeRatio >= 5) t.push("volume≥5x");
  else if (ev.eventVolumeRatio >= 3) t.push("volume 3-5x");
  else t.push("volume 2-3x");

  if (ev.eventDeliveryPct >= 85) t.push("delivery≥85%");
  else if (ev.eventDeliveryPct >= 77) t.push("delivery 77-85%");
  else t.push("delivery 70-77%");

  if (ev.eventChangePercent != null) {
    if (ev.eventChangePercent >= 5) t.push("day gain≥5%");
    else if (ev.eventChangePercent >= 2) t.push("day gain 2-5%");
    else if (ev.eventChangePercent >= 0) t.push("day gain 0-2%");
    else t.push("closed down on the day");
  }

  if (ev.aboveMa20 === true) t.push("above 20-day average");
  else if (ev.aboveMa20 === false) t.push("below 20-day average");

  if (ev.rangePosition != null) {
    if (ev.rangePosition >= 0.8) t.push("closed near the day's high");
    else if (ev.rangePosition <= 0.4) t.push("closed in the day's lower half");
  }
  return t;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const target = Math.max(5, Number(searchParams.get("target")) || TARGET_MOVE);
  const minLift = Math.max(1, Number(searchParams.get("minLift")) || 1.3);

  // Backtest mode. The split date is where the walk-forward boundary sits:
  // the pattern is learned ONLY from events that had already resolved by
  // then, and is then judged on setups appearing after it. Both halves
  // come from the same fetch, sliced by date, so nothing from the future
  // leaks into the training half.
  const backtest = searchParams.get("backtest") === "1" || searchParams.get("backtest") === "true";
  const dateParam = searchParams.get("date");
  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  let splitDate = null;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    splitDate = dateParam > todayIST ? todayIST : dateParam;
  }

  try {
    const days = await getRecentBhavcopies(
      backtest ? BACKTEST_BHAV_WINDOW : BHAV_WINDOW,
      (backtest ? BACKTEST_BHAV_WINDOW : BHAV_WINDOW) * 2 + 30
    );
    if (days.length < AVG_WINDOW + MIN_FOLLOW_DAYS + 5) {
      return Response.json(
        { error: "Not enough trading-day data available from NSE yet" },
        { status: 503 }
      );
    }
    const latest = days[days.length - 1];

    // ---- Collect every qualifying event and its outcome ----------------
    const events = [];
    for (let i = AVG_WINDOW; i < days.length; i++) {
      const day = days[i];
      for (const [symbol, r] of day.bySymbol) {
        if (r.series !== "EQ" || !r.volume || r.close == null) continue;
        if (r.deliveryPct == null || r.deliveryPct < DELIVERY_MIN) continue;

        const priorVols = [];
        const priorCloses = [];
        for (let k = Math.max(0, i - AVG_WINDOW); k < i; k++) {
          const p = days[k].bySymbol.get(symbol);
          if (p?.volume > 0) priorVols.push(p.volume);
          if (p?.close != null) priorCloses.push(p.close);
        }
        if (priorVols.length < 10) continue;
        const avgVol = priorVols.reduce((a, b) => a + b, 0) / priorVols.length;
        if (!(avgVol > 0) || r.volume < avgVol * VOL_MULTIPLE) continue;

        const ma20 = priorCloses.length >= 20
          ? priorCloses.slice(-20).reduce((a, b) => a + b, 0) / 20
          : null;
        const range = r.high != null && r.low != null ? r.high - r.low : null;

        const ev = {
          symbol,
          eventDate: day.date,
          eventIdx: i,
          eventPrice: r.close,
          eventDeliveryPct: r.deliveryPct,
          eventVolume: r.volume,
          eventVolumeRatio: Math.round((r.volume / avgVol) * 100) / 100,
          eventChangePercent:
            r.prevClose && r.close ? Math.round(((r.close - r.prevClose) / r.prevClose) * 10000) / 100 : null,
          aboveMa20: ma20 != null ? r.close > ma20 : null,
          rangePosition: range > 0 ? (r.close - r.low) / range : null,
        };

        // Outcome, where enough sessions have passed to judge it.
        const after = [];
        for (let k = i + 1; k < days.length; k++) {
          const f = days[k].bySymbol.get(symbol);
          if (f?.close != null) after.push(f);
        }
        ev.followDays = after.length;
        if (after.length >= MIN_FOLLOW_DAYS) {
          const maxHigh = Math.max(...after.map((f) => f.high ?? f.close));
          const minLow = Math.min(...after.map((f) => f.low ?? f.close));
          ev.maxUpPct = pct(ev.eventPrice, maxHigh);
          ev.maxDownPct = pct(ev.eventPrice, minLow);
          ev.resolved = true;
          ev.hit = ev.maxUpPct != null && ev.maxUpPct >= target;
        } else {
          ev.resolved = false;
        }
        events.push(ev);
      }
    }

    // In backtest mode the pattern may only be learned from events that had
    // BOTH occurred and fully resolved before the split date. Using events
    // that resolved after it would be lookahead — the study would already
    // know the answers it is about to be tested on.
    const splitIdx = splitDate ? days.findIndex((d) => d.date > splitDate) : -1;
    const splitBoundary = splitIdx === -1 ? days.length : splitIdx;

    const resolved = events.filter((e) => {
      if (!e.resolved) return false;
      if (!backtest || !splitDate) return true;
      return e.eventIdx + MIN_FOLLOW_DAYS < splitBoundary;
    });
    if (resolved.length < 30) {
      return Response.json({
        error:
          "Too few resolved events in this window to say anything meaningful about a pattern. Widen the window or try again once more sessions have printed.",
        sampleSize: resolved.length,
      }, { status: 422 });
    }

    // ---- Base rate, then per-trait lift --------------------------------
    const hits = resolved.filter((e) => e.hit);
    const baseRate = hits.length / resolved.length;

    const traitStats = new Map();
    for (const e of resolved) {
      for (const t of traitsOf(e)) {
        const s = traitStats.get(t) ?? { trait: t, n: 0, hits: 0 };
        s.n++;
        if (e.hit) s.hits++;
        traitStats.set(t, s);
      }
    }

    const traits = [...traitStats.values()]
      .filter((s) => s.n >= 20) // too few observations to trust
      .map((s) => ({
        trait: s.trait,
        sampleSize: s.n,
        hitRatePct: Math.round((s.hits / s.n) * 1000) / 10,
        // >1 means the trait did better than the base rate; ~1 means it
        // carried no information at all.
        lift: Math.round((s.hits / s.n / baseRate) * 100) / 100,
      }))
      .sort((a, b) => b.lift - a.lift);

    const helpfulTraits = traits.filter((t) => t.lift >= minLift);
    const helpfulSet = new Set(helpfulTraits.map((t) => t.trait));

    // ---- Score the unresolved (recent) events ---------------------------
    const candidates = [];
    for (const e of events) {
      if (backtest && splitDate) {
        // Setups that appeared in the window just before the split — these
        // are what the pattern is asked to judge, and their outcomes come
        // entirely from sessions after it.
        if (e.eventIdx >= splitBoundary) continue;
        if (splitBoundary - 1 - e.eventIdx > CANDIDATE_MAX_AGE) continue;
        // An event that had already RESOLVED before the boundary was part
        // of the training set. Scoring the pattern on it would be marking
        // its own homework, so only genuinely unresolved-at-the-split
        // setups are tested.
        if (e.eventIdx + MIN_FOLLOW_DAYS < splitBoundary) continue;
      } else {
        if (e.resolved) continue;
        if (days.length - 1 - e.eventIdx > CANDIDATE_MAX_AGE) continue;
      }

      const own = traitsOf(e);
      const matched = own.filter((t) => helpfulSet.has(t));
      if (matched.length === 0) continue;

      // Outcomes of past events that shared ALL of this one's matched
      // traits — a direct historical answer rather than a model.
      const comparable = resolved.filter((r) => {
        const rt = new Set(traitsOf(r));
        return matched.every((t) => rt.has(t));
      });
      if (comparable.length < 15) continue;

      const compHits = comparable.filter((c) => c.hit);
      const ups = comparable.map((c) => c.maxUpPct).filter((v) => v != null).sort((a, b) => a - b);
      const downs = comparable.map((c) => c.maxDownPct).filter((v) => v != null).sort((a, b) => a - b);
      const median = (arr) =>
        arr.length ? Math.round(((arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2)) * 100) / 100 : null;

      const cur = latest.bySymbol.get(e.symbol);

      // What this setup ACTUALLY did after the split — the whole point of
      // the backtest. Measured from the sessions following the event.
      let realised = null;
      if (backtest && splitDate) {
        const after = [];
        for (let k = e.eventIdx + 1; k < days.length; k++) {
          const f = days[k].bySymbol.get(e.symbol);
          if (f?.close != null) after.push(f);
        }
        if (after.length >= MIN_FOLLOW_DAYS) {
          const maxHigh = Math.max(...after.map((f) => f.high ?? f.close));
          const minLow = Math.min(...after.map((f) => f.low ?? f.close));
          realised = {
            followDays: after.length,
            maxUpPct: pct(e.eventPrice, maxHigh),
            maxDownPct: pct(e.eventPrice, minLow),
            finalPct: pct(e.eventPrice, after[after.length - 1].close),
          };
          realised.hit = realised.maxUpPct != null && realised.maxUpPct >= target;
        }
      }

      candidates.push({
        realised,
        symbol: e.symbol,
        eventDate: e.eventDate,
        daysSinceEvent: days.length - 1 - e.eventIdx,
        entryPrice: e.eventPrice,
        currentPrice: cur?.close ?? null,
        changeSinceEvent: cur?.close != null ? pct(e.eventPrice, cur.close) : null,
        eventDeliveryPct: e.eventDeliveryPct,
        eventVolumeRatio: e.eventVolumeRatio,
        matchedTraits: matched,
        // Everything below describes the COMPARABLE HISTORICAL SET, not a
        // forecast for this stock.
        comparableCount: comparable.length,
        historicalHitRatePct: Math.round((compHits.length / comparable.length) * 1000) / 10,
        medianMaxUpPct: median(ups),
        medianMaxDownPct: median(downs),
        bestMaxUpPct: ups.length ? ups[ups.length - 1] : null,
        worstMaxDownPct: downs.length ? downs[0] : null,
      });
    }

    // ---- Sectors -------------------------------------------------------
    // Every sector each candidate belongs to, so the tab can show them and
    // offer to classify anything that belongs to none.
    try {
      const sectorList = await getResolvedSectorList();
      const bySymbol = new Map();
      for (const s of sectorList) {
        for (const sym of s.symbols) {
          if (!bySymbol.has(sym)) bySymbol.set(sym, []);
          bySymbol.get(sym).push({ key: s.key, name: s.name });
        }
      }
      for (const cand of candidates) cand.sectors = bySymbol.get(cand.symbol) ?? [];
    } catch {
      for (const cand of candidates) cand.sectors = null; // unavailable, not "none"
    }

    candidates.sort(
      (a, b) => b.historicalHitRatePct - a.historicalHitRatePct || b.comparableCount - a.comparableCount
    );

    // ---- Backtest scorecard ---------------------------------------------
    // How the pattern actually did on setups it had never seen. This is the
    // number that matters: a study can always describe its own data well,
    // and only a forward test says whether that carried over.
    let backtestResult = null;
    if (backtest && splitDate) {
      const scored = candidates.filter((c) => c.realised);
      const wins = scored.filter((c) => c.realised.hit);
      const ups = scored.map((c) => c.realised.maxUpPct).filter((v) => v != null).sort((a, b) => a - b);
      const downs = scored.map((c) => c.realised.maxDownPct).filter((v) => v != null).sort((a, b) => a - b);
      const finals = scored.map((c) => c.realised.finalPct).filter((v) => v != null);
      const med = (arr) =>
        arr.length
          ? Math.round(
              (arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2) * 100
            ) / 100
          : null;

      backtestResult = {
        splitDate,
        trainedOnEvents: resolved.length,
        flaggedCount: candidates.length,
        scoredCount: scored.length,
        hitCount: wins.length,
        hitRatePct: scored.length ? Math.round((wins.length / scored.length) * 1000) / 10 : null,
        // The comparison that decides whether the pattern was worth
        // anything: the flagged set against the base rate it was drawn from.
        baseRatePct: Math.round(baseRate * 1000) / 10,
        edgePct: scored.length
          ? Math.round((wins.length / scored.length - baseRate) * 1000) / 10
          : null,
        medianMaxUpPct: med(ups),
        medianMaxDownPct: med(downs),
        medianFinalPct: med(finals.sort((a, b) => a - b)),
        positiveFinalCount: finals.filter((v) => v > 0).length,
      };
    }

    return Response.json({
      asOf: latest.date,
      windowFirstDate: days[0]?.date ?? null,
      target,
      criteria: { deliveryMin: DELIVERY_MIN, volMultiple: VOL_MULTIPLE, avgWindow: AVG_WINDOW, minFollowDays: MIN_FOLLOW_DAYS, minLift },
      backtest: backtestResult,
      backtestRequested: backtest,
      splitDate,
      study: {
        totalEvents: events.length,
        resolvedEvents: resolved.length,
        hitCount: hits.length,
        // The single most important number on the page.
        baseRatePct: Math.round(baseRate * 1000) / 10,
        traits,
        helpfulTraits,
      },
      candidates,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to build entry candidates", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
