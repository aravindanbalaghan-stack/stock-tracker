// Volume, turnover and "vs 30-day average" for one stock — LIVE when the
// quote feed has a session newer than NSE's last end-of-day file (during
// market hours, and in the evening before NSE publishes), otherwise NSE's
// end-of-day figures. Used by the Watchlist and the Holdings cards.
//
// Live turnover is price × volume so far (approximate — NSE's turnover is
// the sum of every trade's value). During the session, the volume ratio is
// shown "so far" and also projected to a full day by how much of the
// session has passed; projections early in the day are rough, so none is
// shown in the first 15 minutes.

import { marketIsOpen, sessionProgress } from "@/lib/marketHours";

export function volumeFigures(quote, metrics, metricsAsOf) {
  const live =
    quote?.ok !== false &&
    quote?.volume > 0 &&
    quote?.sessionDate &&
    (!metricsAsOf || quote.sessionDate > metricsAsOf);

  if (live) {
    const open = marketIsOpen();
    const progress = open ? sessionProgress() : 1;
    const base = metrics?.avgVolume30Live ?? metrics?.avgVolume30 ?? null;
    const ratio = base ? quote.volume / base : null;
    return {
      source: open ? "live" : "today",
      volume: quote.volume,
      turnoverCr: quote.price ? (quote.price * quote.volume) / 1e7 : null,
      ratio,
      projectedRatio: open && ratio != null && progress >= 0.04 ? ratio / progress : null,
      asOf: quote.sessionDate,
    };
  }
  return {
    source: "eod",
    volume: metrics?.latestVolume ?? null,
    turnoverCr: metrics?.turnoverCr ?? null,
    ratio: metrics?.volumeRatio30d ?? null,
    projectedRatio: null,
    asOf: metricsAsOf ?? null,
  };
}

export function fmtVolume(n) {
  if (n == null) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
