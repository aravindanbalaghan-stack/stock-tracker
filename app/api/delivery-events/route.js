import { getRecentBhavcopies } from "@/lib/nseBhavcopy";

export const dynamic = "force-dynamic";
// Wholly bhavcopy-driven: no Yahoo, no NSE session endpoints. The window
// is large but every day file is cached for a week, so repeat loads are
// fast even though the first one isn't.
export const maxDuration = 60;

// Trailing window each event day is measured against.
const AVG_WINDOW = 30;
// How far back to look for events, and the ceiling the UI can request.
const DEFAULT_EVENT_LOOKBACK = 30;
const MAX_EVENT_LOOKBACK = 60;
// Events are only worth reporting once there's something after them to
// measure. A same-day event has no follow-through yet.
const MIN_FOLLOW_DAYS = 1;
const MAX_ROWS = 400;

function pct(from, to) {
  if (!from || from <= 0 || to == null) return null;
  return Math.round(((to - from) / from) * 10000) / 100;
}

/**
 * Annualised volatility of daily returns after the event.
 *
 * Standard deviation of daily log-ish percentage returns, scaled by
 * sqrt(252) to put it on the usual annual footing so a 5-day and a 40-day
 * sample are comparable. With very few post-event days this is noisy, so
 * `followDays` is returned alongside it and the UI shows the sample size.
 */
function annualisedVolatility(closes) {
  if (closes.length < 3) return null;
  const rets = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.round(Math.sqrt(variance) * Math.sqrt(252) * 10000) / 100;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const volMultiple = Math.max(1, Number(searchParams.get("volMultiple")) || 2);
  const deliveryMin = Math.max(0, Number(searchParams.get("deliveryMin")) || 70);
  const lookback = Math.min(
    MAX_EVENT_LOOKBACK,
    Math.max(5, Number(searchParams.get("lookback")) || DEFAULT_EVENT_LOOKBACK)
  );

  // Optional "as of" so this tab behaves like the rest of Delivery.
  const dateParam = searchParams.get("date");
  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  let asOfDate = null;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    asOfDate = dateParam > todayIST ? todayIST : dateParam;
  }

  // Need the event window plus a trailing average behind its oldest day.
  const windowDays = lookback + AVG_WINDOW + 5;

  try {
    const all = await getRecentBhavcopies(windowDays, windowDays * 2 + 25);
    let days = all;
    if (asOfDate) {
      days = all.filter((d) => d.date <= asOfDate);
    }
    if (days.length < AVG_WINDOW + 2) {
      return Response.json(
        { error: "Not enough trading-day data available from NSE for this window" },
        { status: 503 }
      );
    }
    days = days.slice(-windowDays);

    const latest = days[days.length - 1];
    const firstEventIdx = Math.max(AVG_WINDOW, days.length - lookback);

    const rows = [];
    for (let i = firstEventIdx; i < days.length - MIN_FOLLOW_DAYS; i++) {
      const day = days[i];
      for (const [symbol, r] of day.bySymbol) {
        if (r.series !== "EQ" || !r.volume || r.close == null) continue;
        if (r.deliveryPct == null || r.deliveryPct < deliveryMin) continue;

        // Volume against this symbol's own trailing average as it stood on
        // the event day — not one average taken from the end of the window.
        const priorVols = [];
        for (let k = Math.max(0, i - AVG_WINDOW); k < i; k++) {
          const v = days[k].bySymbol.get(symbol)?.volume;
          if (v > 0) priorVols.push(v);
        }
        if (priorVols.length < 10) continue;
        const avgVol = priorVols.reduce((a, b) => a + b, 0) / priorVols.length;
        if (!(avgVol > 0) || r.volume < avgVol * volMultiple) continue;

        // ---- Follow-through: every session strictly after the event ----
        const after = [];
        for (let k = i + 1; k < days.length; k++) {
          const f = days[k].bySymbol.get(symbol);
          if (f && f.close != null) after.push(f);
        }
        if (after.length < MIN_FOLLOW_DAYS) continue;

        const eventPrice = r.close;
        const currentPrice = after[after.length - 1].close;
        // Intraday extremes, so a spike that reversed the same day still
        // shows up rather than being hidden by close-only figures.
        const maxHigh = Math.max(...after.map((f) => f.high ?? f.close));
        const minLow = Math.min(...after.map((f) => f.low ?? f.close));

        rows.push({
          symbol,
          eventDate: day.date,
          daysSince: after.length,
          eventPrice: Math.round(eventPrice * 100) / 100,
          eventDeliveryPct: r.deliveryPct,
          eventVolume: r.volume,
          eventVolumeRatio: Math.round((r.volume / avgVol) * 100) / 100,
          eventChangePercent:
            r.prevClose && r.close ? Math.round(((r.close - r.prevClose) / r.prevClose) * 10000) / 100 : null,
          currentPrice: Math.round(currentPrice * 100) / 100,
          changeSincePct: pct(eventPrice, currentPrice),
          // Best and worst the price reached after the event, both measured
          // from the event close.
          maxUpPct: pct(eventPrice, maxHigh),
          maxDownPct: pct(eventPrice, minLow),
          volatilityPct: annualisedVolatility([eventPrice, ...after.map((f) => f.close)]),
        });
      }
    }

    // Most recent events first — the actionable end of the list.
    rows.sort((a, b) => (a.eventDate < b.eventDate ? 1 : a.eventDate > b.eventDate ? -1 : (b.eventVolumeRatio ?? 0) - (a.eventVolumeRatio ?? 0)));
    const truncated = rows.length > MAX_ROWS;

    // Summary of how this setup actually behaved across the window — the
    // point of the tab is the pattern, not any single row.
    const withOutcome = rows.filter((r) => r.changeSincePct != null);
    const positive = withOutcome.filter((r) => r.changeSincePct > 0).length;
    const summary = withOutcome.length
      ? {
          count: withOutcome.length,
          positiveCount: positive,
          positiveRatePct: Math.round((positive / withOutcome.length) * 1000) / 10,
          medianChangePct: median(withOutcome.map((r) => r.changeSincePct)),
          avgMaxUpPct: avg(withOutcome.map((r) => r.maxUpPct)),
          avgMaxDownPct: avg(withOutcome.map((r) => r.maxDownPct)),
          avgVolatilityPct: avg(withOutcome.map((r) => r.volatilityPct)),
        }
      : null;

    return Response.json({
      asOf: latest.date,
      requestedDate: asOfDate,
      dateAdjusted: !!asOfDate && asOfDate !== latest.date,
      criteria: { volMultiple, deliveryMin, lookback, avgWindow: AVG_WINDOW },
      eventCount: rows.length,
      truncated,
      maxRows: MAX_ROWS,
      summary,
      rows: rows.slice(0, MAX_ROWS),
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to scan delivery events", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}

function avg(list) {
  const v = list.filter((x) => x != null);
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100;
}

function median(list) {
  const v = list.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  const m = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return Math.round(m * 100) / 100;
}
