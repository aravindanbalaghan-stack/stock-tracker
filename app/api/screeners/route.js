import { getRecentBhavcopies, getBhavcopyNear } from "@/lib/nseBhavcopy";
import { getSessionCookies, nseApiFetchWithCookies } from "@/lib/nseSession";
import {
  sma,
  wma,
  ema,
  toWeeklyBars,
  weeklyExtremes,
  fetchDailyOHLCVBatch,
  symbolSeries,
} from "@/lib/screenerIndicators";
import { SCREENS } from "@/lib/screens";
import { fetchDebutBatch, withDebut } from "@/lib/debut";
import { analyzeStage2, mightBeStage2 } from "@/lib/stageAnalysis";
import { resolveWideUniverse } from "@/lib/nifty500";
import { fetchIndexOHLCV, fetchWeeklyOHLCVBatch } from "@/lib/screenerIndicators";

export const dynamic = "force-dynamic";
// Each screen fetches ~31 bhavcopy files (cached per-day for a week) and
// then Yahoo history for its shortlist. The bhavcopy half dominates on a
// cold cache.
export const maxDuration = 60;

// 31 days covers every short-window condition in these screens AND the
// "vs 30-day average volume" column that all of them display.
const BHAV_WINDOW = 31;

// Ceiling on how many symbols get Yahoo history fetched after the cheap
// bhavcopy filters run. The filters normally narrow the ~2000-stock
// universe to well under this; the cap only bites on unusual days, and
// when it does the response says so rather than silently truncating.
const SHORTLIST_CAP = 250;
const YAHOO_CONCURRENCY = 8;

// Market cap is only looked up for the Pocket Pivot final shortlist —
// NSE's quote endpoint is rate-limited and can't be run across a wide
// list. See the note in the response payload.
const MARKET_CAP_CONCURRENCY = 6;
const MARKET_CAP_TIMEOUT_MS = 4000;

// Stage 2 scans a ~500-stock universe (the NIFTY 500 where NSE's endpoint
// is reachable, otherwise the top 500 by turnover — see lib/nifty500.js).
// It can't be pre-filtered from the 31-day bhavcopy window the other
// screens use, because the stage verdict needs a 30-week MA. Instead it
// narrows in two passes: cheap WEEKLY bars for all ~500, then full daily
// history only for the ones that might qualify.
const STAGE_WEEKLY_CONCURRENCY = 12;
const STAGE_DAILY_CONCURRENCY = 10;
// The daily pass is the expensive half, so it's capped independently of
// SHORTLIST_CAP. In practice the weekly pre-filter lands well under this.
const STAGE_DAILY_CAP = 220;

async function fetchMarketCapCr(symbol, cookies) {
  const data = await nseApiFetchWithCookies(
    `/api/quote-equity?symbol=${encodeURIComponent(symbol)}&section=trade_info`,
    cookies,
    MARKET_CAP_TIMEOUT_MS
  );
  if (!data) return null;
  const direct = data?.marketDeptOrderBook?.tradeInfo?.totalMarketCap;
  if (typeof direct === "number") return direct;
  const issuedSize = data?.securityInfo?.issuedSize;
  const lastPrice = data?.priceInfo?.lastPrice;
  if (typeof issuedSize === "number" && typeof lastPrice === "number") {
    return (issuedSize * lastPrice) / 1e7; // rupees -> crore
  }
  return null;
}

// --- Shared per-symbol figures shown as columns on every screen ----------
function baseRow(symbol, series) {
  const today = series[series.length - 1];
  const priorVolumes = series.slice(0, -1).map((d) => d.volume).filter((v) => v > 0);
  const avgVolume30 = priorVolumes.length > 0 ? priorVolumes.reduce((a, b) => a + b, 0) / priorVolumes.length : null;
  const changePercent =
    today.prevClose && today.close ? ((today.close - today.prevClose) / today.prevClose) * 100 : null;

  // Where the stock stands against its own opening price for the session.
  // Note this is the LAST PUBLISHED session's open vs. that session's
  // close — bhavcopy is an end-of-day file, so during market hours this
  // reflects the previous completed session rather than a live intraday
  // position. The column header says "at close" for that reason.
  const vsOpenPct =
    today.open && today.close ? ((today.close - today.open) / today.open) * 100 : null;

  return {
    symbol,
    open: today.open,
    close: today.close,
    vsOpenPct: vsOpenPct != null ? Math.round(vsOpenPct * 100) / 100 : null,
    changePercent: changePercent != null ? Math.round(changePercent * 100) / 100 : null,
    deliveryPct: today.deliveryPct,
    volume: today.volume,
    avgVolume30: avgVolume30 != null ? Math.round(avgVolume30) : null,
    volumeRatio: avgVolume30 && avgVolume30 > 0 ? Math.round((today.volume / avgVolume30) * 100) / 100 : null,
    wma30: null, // filled in during Yahoo enrichment below
  };
}

// 30-week moving average of weekly closes, from the same Yahoo history
// already fetched for the screen's long-horizon indicators — so the 30WMA
// column costs no extra requests.
function wma30From(weeklyBars) {
  const completed = weeklyBars.slice(0, -1); // drop the in-progress week
  if (completed.length < 30) return null;
  const closes = completed.slice(-30).map((w) => w.c);
  return closes.reduce((a, b) => a + b, 0) / 30;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const screen = searchParams.get("screen");

  if (!screen || !SCREENS[screen]) {
    return Response.json(
      { error: `Unknown screen. Expected one of: ${Object.keys(SCREENS).join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const days = await getRecentBhavcopies(BHAV_WINDOW, BHAV_WINDOW * 2 + 20);
    if (days.length < 6) {
      return Response.json(
        { error: "Not enough trading-day data available from NSE yet" },
        { status: 503 }
      );
    }
    const latest = days[days.length - 1];

    // Build per-symbol bhavcopy series once, for every EQ symbol that
    // traded today. Every screen filters off this same structure.
    const universe = [];
    for (const [symbol, row] of latest.bySymbol) {
      if (row.series !== "EQ" || !row.volume || row.close == null) continue;
      universe.push({ symbol, series: symbolSeries(symbol, days) });
    }

    let candidates = [];
    let extraNotes = [];
    let listedAfterDate = null;
    let stageUniverseSource = null;
    let stageWeeklyScanned = null;
    let stagePlausible = null;

    // ---------------- Cheap bhavcopy-only filters ----------------
    if (screen === "ipo-base") {
      // "Listed within the last 15 months" is established in two steps:
      // a single bhavcopy snapshot from ~15 months ago tells us which
      // symbols already existed then (one file instead of ~300), and the
      // Yahoo enrichment below confirms each survivor's actual first
      // trading day.
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 15);
      listedAfterDate = cutoff.toISOString().slice(0, 10);

      const oldDay = await getBhavcopyNear(cutoff);
      if (!oldDay) {
        return Response.json(
          {
            error:
              "NSE's archive didn't return a bhavcopy from around 15 months ago, which this screen needs to tell new listings apart from long-listed stocks. Try again shortly.",
          },
          { status: 503 }
        );
      }
      extraNotes.push(`Compared against the bhavcopy from ${oldDay.date}.`);

      candidates = universe.filter(({ symbol, series }) => {
        const today = series[series.length - 1];
        return today.volume > 5000 && !oldDay.bySymbol.has(symbol);
      });
    }

    if (screen === "pocket-pivot") {
      candidates = universe.filter(({ series }) => {
        if (series.length < 12) return false;
        const today = series[series.length - 1];
        if (today.close == null || today.close < 20) return false;
        if (today.prevClose == null || today.close < today.prevClose) return false;

        // prior[0] = 1 day ago, prior[1] = 2 days ago, ...
        const prior = series.slice(0, -1).reverse();
        if (prior.length < 11) return false;

        // Branch A — today's volume beats the largest DOWN-day (close <
        // open) volume of the last 10 sessions.
        let maxDownDayVolume = 0;
        for (let i = 0; i < 10; i++) {
          const d = prior[i];
          if (d.open != null && d.close != null && d.close < d.open) {
            maxDownDayVolume = Math.max(maxDownDayVolume, d.volume);
          }
        }
        const branchA = today.volume > maxDownDayVolume;

        // Branch B — the explicit day-by-day form: each of the last 10
        // sessions either closed up on its own previous day, or closed
        // down on lighter volume than today.
        let branchB = true;
        for (let i = 0; i < 10; i++) {
          const cur = prior[i];
          const before = prior[i + 1];
          if (!cur || !before) {
            branchB = false;
            break;
          }
          const up = cur.close > before.close;
          const downOnLighterVolume = cur.close < before.close && cur.volume < today.volume;
          if (!up && !downOnLighterVolume) {
            branchB = false;
            break;
          }
        }

        if (!branchA && !branchB) return false;

        // Today's low pulled back into the 10-day weighted average.
        const closes10 = series.slice(-10).map((d) => d.close);
        const wma10 = wma(closes10, 10);
        if (wma10 == null || today.low == null || today.low > wma10) return false;

        return true;
      });
    }

    if (screen === "gap-up") {
      candidates = universe.filter(({ series }) => {
        const t = series[series.length - 1];
        if (t.open == null || t.low == null || t.prevClose == null || t.close == null) return false;
        return (
          t.open > t.prevClose * 1.03 &&
          t.low > t.prevClose &&
          t.close > t.open &&
          t.close > 100
        );
      });
    }

    if (screen === "volume-expansion") {
      candidates = universe.filter(({ series }) => {
        if (series.length < 6) return false;
        const today = series[series.length - 1];
        const prior = series.slice(0, -1).reverse(); // [0] = 1 day ago
        const [d1, d2, d3, d4] = prior;
        if (!d1 || !d2 || !d3 || !d4) return false;

        // Three consecutive days of shrinking volume, then today expands.
        if (!(d1.volume < d2.volume && d2.volume < d3.volume && d3.volume < d4.volume)) return false;
        if (!(today.volume > d1.volume)) return false;

        // Above the 30-day average volume (bhavcopy window covers this).
        const priorVolumes = series.slice(0, -1).map((d) => d.volume).filter((v) => v > 0);
        const avgVol30 = sma(priorVolumes, Math.min(30, priorVolumes.length));
        if (avgVol30 == null || today.volume <= avgVol30) return false;

        return true;
      });
    }

    if (screen === "stage-2") {
      // Pass 1 — resolve the ~500-stock universe, then run a cheap weekly
      // pre-filter over it to find which stocks are plausibly above a
      // rising 30-week MA. Weekly bars are ~1/5 the payload of daily, so
      // this is what makes a 500-stock scan affordable at all.
      const resolved = await resolveWideUniverse(universe);
      stageUniverseSource = resolved.source;
      const bySymbol = new Map(universe.map((u) => [u.symbol, u]));
      const inUniverse = resolved.symbols.map((s) => bySymbol.get(s)).filter(Boolean);

      const weekly = await fetchWeeklyOHLCVBatch(
        inUniverse.map((u) => u.symbol),
        { concurrency: STAGE_WEEKLY_CONCURRENCY }
      );

      const plausible = inUniverse.filter(({ symbol }) => mightBeStage2(weekly.get(symbol)));
      stageWeeklyScanned = inUniverse.length;
      stagePlausible = plausible.length;

      // Pass 2 (below, via the shared Yahoo enrichment) gets full daily
      // history for these only.
      candidates = plausible.slice(0, STAGE_DAILY_CAP);

      extraNotes.push(
        `${resolved.sourceLabel} Of those, ${plausible.length} passed a weekly pre-filter and were checked in full against daily data.`
      );
      if (plausible.length > STAGE_DAILY_CAP) {
        extraNotes.push(
          `Capped at ${STAGE_DAILY_CAP} full daily checks; the most liquid were kept.`
        );
      }
    }

    if (screen === "gap-down-reversal") {
      candidates = universe.filter(({ series }) => {
        const today = series[series.length - 1];
        if (today.open == null || today.prevClose == null || today.close == null) return false;
        if (!(today.open < today.prevClose * 0.97)) return false;
        if (!(today.close > today.open * 1.05)) return false;

        const priorVolumes = series.slice(0, -1).map((d) => d.volume).filter((v) => v > 0);
        const avgVol30 = sma(priorVolumes, Math.min(30, priorVolumes.length));
        return avgVol30 != null && today.volume > avgVol30;
      });
    }

    // ---------------- Yahoo enrichment ----------------
    const truncated = candidates.length > SHORTLIST_CAP;
    // Sort by turnover before capping so that if the cap does bite, it
    // keeps the most liquid names rather than an arbitrary slice.
    const shortlist = [...candidates]
      .sort((a, b) => {
        const at = a.series[a.series.length - 1];
        const bt = b.series[b.series.length - 1];
        return bt.volume * (bt.close ?? 0) - at.volume * (at.close ?? 0);
      })
      .slice(0, SHORTLIST_CAP);

    const history = await fetchDailyOHLCVBatch(
      shortlist.map((c) => c.symbol),
      { concurrency: screen === "stage-2" ? STAGE_DAILY_CONCURRENCY : YAHOO_CONCURRENCY }
    );

    // Weinstein required a Stage 2 stock to be OUTPERFORMING the market,
    // not just rising, so the relative-strength column needs the index.
    let benchmarkBars = null;
    if (screen === "stage-2") {
      const nifty = await fetchIndexOHLCV("^NSEI").catch(() => null);
      benchmarkBars = nifty?.bars ?? null;
    }

    let rows = [];
    for (const { symbol, series } of shortlist) {
      const hist = history.get(symbol);
      const row = baseRow(symbol, series);
      const today = series[series.length - 1];

      // Every screen shows a 30WMA column, and most also need long-horizon
      // indicators — both come from this one Yahoo history per symbol.
      let weekly = null;
      let closes = null;
      let volumes = null;
      if (hist?.bars?.length) {
        closes = hist.bars.map((b) => b.c);
        volumes = hist.bars.map((b) => b.v ?? 0);
        weekly = toWeeklyBars(hist.bars);
        const w30 = wma30From(weekly);
        row.wma30 = w30 != null ? Math.round(w30 * 100) / 100 : null;
      }

      // Screens whose remaining conditions need that history. A symbol
      // whose history couldn't be fetched is dropped rather than passed
      // through unchecked — better to under-report than to show a stock
      // that may not actually meet the filter.
      if (screen === "ipo-base") {
        const first = hist?.firstTradeDate;
        if (!first) continue;
        const firstDate = new Date(first * 1000);
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 15);
        if (firstDate < cutoff) continue;
        row.listedOn = firstDate.toISOString().slice(0, 10);
      }

      if (screen === "pocket-pivot") {
        if (!closes || closes.length < 200 || !weekly) continue;
        const sma50 = sma(closes, 50);
        const sma200 = sma(closes, 200);
        const avgVol50 = sma(volumes, 50);
        const { high: high52, low: low52 } = weeklyExtremes(weekly, 52);
        const weeklyVolSma10 = sma(weekly.map((w) => w.v), 10);

        if (sma50 == null || sma200 == null || avgVol50 == null || high52 == null || low52 == null) continue;
        if (!(today.close > sma50)) continue;
        if (!(today.close > sma200)) continue;
        if (!(today.close > 1.3 * low52)) continue;
        if (!(today.close > 0.75 * high52)) continue;
        if (weeklyVolSma10 == null || !(weeklyVolSma10 > 100000)) continue;
        if (!(avgVol50 * today.close > 5000000)) continue;

        row.sma50 = Math.round(sma50 * 100) / 100;
        row.sma200 = Math.round(sma200 * 100) / 100;
      }

      if (screen === "stage-2") {
        if (!hist?.bars?.length) continue;
        const stage = analyzeStage2(hist.bars, benchmarkBars);
        if (!stage) continue; // not in Stage 2, or not enough history to say
        Object.assign(row, stage);
      }

      if (screen === "gap-up") {
        if (!closes) continue;
        const sma150 = sma(closes, 150);
        if (sma150 == null || !(today.close > sma150)) continue;
        row.sma150 = Math.round(sma150 * 100) / 100;
      }

      if (screen === "volume-expansion") {
        if (!closes) continue;
        const sma150 = sma(closes, 150);
        const ema21 = ema(closes, 21);
        if (sma150 == null || ema21 == null) continue;
        if (!(today.close > ema21)) continue;
        if (!(today.close > sma150)) continue;
        row.sma150 = Math.round(sma150 * 100) / 100;
        row.ema21 = Math.round(ema21 * 100) / 100;
      }

      rows.push(row);
    }

    // ---------------- Listing debut ----------------
    // Cheap after the first lookup of each symbol — a debut price can
    // never change, so lib/debut.js caches it for 30 days.
    if (rows.length > 0) {
      const debuts = await fetchDebutBatch(rows.map((r) => r.symbol), { concurrency: YAHOO_CONCURRENCY });
      rows = rows.map((r) => withDebut(r, debuts.get(r.symbol)));
    }

    // ---------------- Market cap (Pocket Pivot only) ----------------
    if (screen === "pocket-pivot" && rows.length > 0) {
      const cookies = await getSessionCookies();
      const caps = [];
      for (let i = 0; i < rows.length; i += MARKET_CAP_CONCURRENCY) {
        const batch = rows.slice(i, i + MARKET_CAP_CONCURRENCY);
        const got = await Promise.all(batch.map((r) => fetchMarketCapCr(r.symbol, cookies).catch(() => null)));
        caps.push(...got);
      }
      rows = rows
        .map((r, i) => ({ ...r, marketCapCr: caps[i] != null ? Math.round(caps[i]) : null }))
        // The filter is "market cap >= ₹100 Cr". A symbol whose market cap
        // couldn't be read is KEPT rather than dropped — NSE's quote
        // endpoint fails often enough from hosted servers that dropping on
        // failure would quietly hide valid results. Those rows show "—"
        // in the column so it's visible which ones weren't verified.
        .filter((r) => r.marketCapCr == null || r.marketCapCr >= 100);
      extraNotes.push(
        "Market cap is read per-symbol from NSE and can fail intermittently; rows showing “—” for it weren't verified against the ₹100 Cr floor."
      );
    }

    rows.sort((a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0));

    return Response.json({
      screen,
      label: SCREENS[screen].label,
      description: SCREENS[screen].description,
      asOf: latest.date,
      universeSize: universe.length,
      matchedBeforeEnrichment: candidates.length,
      resultCount: rows.length,
      truncated,
      shortlistCap: SHORTLIST_CAP,
      listedAfterDate,
      stageUniverseSource,
      stageWeeklyScanned,
      stagePlausible,
      notes: extraNotes,
      rows,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to run this screen", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
