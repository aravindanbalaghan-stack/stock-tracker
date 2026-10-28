// IPO Base — where a recent listing stands against its two reference
// levels, and whether it's crossing or about to cross either:
//
//   IPO price         — what subscribers paid (lib/ipoIssuePrices.js)
//   Listing-day high  — the high of the first trading session
//
// The listing-day OPEN is shown separately by the generic "Debut ₹" column
// every screen already has (lib/debut.js).
//
// Each level gets a state:
//   "fresh"        close is above it now and was at/below it within the
//                  last 5 sessions — it just crossed
//   "above"        above it for longer than that
//   "approaching"  below it, but within 5%
//   "below"        further away
//
// and the two states combine into one Status, in this priority order:
//
//   1 Crossing listing-day high      4 Approaching IPO price
//   2 Approaching listing-day high   5 Holding above listing-day high
//   3 Crossing IPO price             6 Holding above IPO price
//                                    (7 Below both — dropped by the screen)

import { istDateOf } from "@/lib/yahooFinance";

export const IPO = {
  nearPct: 5,
  freshCrossSessions: 5,
};

export const IPO_STATUS = {
  CROSS_HIGH: { rank: 1, label: "Crossing listing-day high", tone: "gain" },
  NEAR_HIGH: { rank: 2, label: "Approaching listing-day high", tone: "accent" },
  CROSS_IPO: { rank: 3, label: "Crossing IPO price", tone: "gain" },
  NEAR_IPO: { rank: 4, label: "Approaching IPO price", tone: "accent" },
  ABOVE_HIGH: { rank: 5, label: "Holding above listing-day high", tone: "muted" },
  ABOVE_IPO: { rank: 6, label: "Holding above IPO price", tone: "muted" },
  BELOW: { rank: 7, label: "Below both", tone: "loss" },
};

const pct = (a, b) => ((a - b) / b) * 100;
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

function levelState(closes, level) {
  const last = closes.length - 1;
  const now = closes[last];
  if (now > level) {
    for (let k = Math.max(0, last - IPO.freshCrossSessions); k < last; k++) {
      if (closes[k] <= level) return "fresh";
    }
    return "above";
  }
  return now >= level * (1 - IPO.nearPct / 100) ? "approaching" : "below";
}

// The session on which the current run above `level` began, or null if it
// isn't above now. A stock above the level ever since listing has no
// crossing date — it opened there.
function crossedOn(closes, dates, level) {
  let j = closes.length - 1;
  if (!(closes[j] > level)) return null;
  while (j > 0 && closes[j - 1] > level) j--;
  return j === 0 ? null : dates[j];
}

function combine(ip, hi) {
  if (hi === "fresh") return IPO_STATUS.CROSS_HIGH;
  if (hi === "approaching") return IPO_STATUS.NEAR_HIGH;
  if (ip === "fresh") return IPO_STATUS.CROSS_IPO;
  if (ip === "approaching") return IPO_STATUS.NEAR_IPO;
  if (hi === "above") return IPO_STATUS.ABOVE_HIGH;
  if (ip === "above") return IPO_STATUS.ABOVE_IPO;
  return IPO_STATUS.BELOW;
}

/**
 * `bars` — Yahoo daily bars {t,o,h,l,c}, oldest-first, already truncated to
 * the as-of date; the first bar must be the listing day.
 * `today` — the as-of session's bhavcopy row (its close is the CMP).
 * `firstTradeDate` — Yahoo meta.firstTradeDate (epoch s), used to check the
 * first bar really is the listing day.
 * `issue` — { issuePrice, source } or null.
 */
export function analyzeIpoBase({ bars, today, todayDate, firstTradeDate, issue }) {
  if (!bars?.length || today?.close == null) return null;

  const first = bars[0];
  if (first.o == null || first.h == null) return null;
  const listingDate = istDateOf(first.t);

  const warnings = [];
  if (firstTradeDate && istDateOf(firstTradeDate) !== listingDate) {
    warnings.push(
      `Yahoo's first daily bar is ${listingDate}, not the listing date ${istDateOf(firstTradeDate)} — listing-day levels may be off`
    );
  }

  // Closing series up to the as-of session, with the bhavcopy close as the
  // last point so the CMP matches every other column.
  const closes = [];
  const dates = [];
  for (const b of bars) {
    const d = istDateOf(b.t);
    if (d >= todayDate) break;
    closes.push(b.c);
    dates.push(d);
  }
  closes.push(today.close);
  dates.push(todayDate);

  const listingOpen = first.o;
  const listingDayHigh = first.h;
  const issuePrice = issue?.issuePrice ?? null;

  // Yahoo bars are split/bonus-adjusted; the NSE issue price isn't. A wild
  // listing-open-to-issue ratio usually means a corporate action since
  // listing, so flag it rather than silently mis-classify.
  if (issuePrice) {
    const ratio = listingOpen / issuePrice;
    if (ratio < 0.4 || ratio > 3) {
      warnings.push(
        `Listing open is ${ratio.toFixed(2)}× the IPO price — possibly a split/bonus since listing; verify the IPO-price comparison`
      );
    }
  }

  const listingHighState = levelState(closes, listingDayHigh);
  const issueState = issuePrice ? levelState(closes, issuePrice) : null;
  const status = combine(issueState, listingHighState);

  let highSinceListing = -Infinity;
  let lowSinceListing = Infinity;
  for (const b of bars) {
    if (istDateOf(b.t) > todayDate) break;
    highSinceListing = Math.max(highSinceListing, b.h);
    lowSinceListing = Math.min(lowSinceListing, b.l);
  }
  highSinceListing = Math.max(highSinceListing, today.high ?? today.close);
  lowSinceListing = Math.min(lowSinceListing, today.low ?? today.close);

  return {
    listingDate,
    sessionsSinceListing: closes.length,
    issuePrice: r2(issuePrice),
    issuePriceSource: issue?.source ?? null,
    listingOpen: r2(listingOpen),
    listingDayHigh: r2(listingDayHigh),
    listingGainPct: issuePrice ? r2(pct(listingOpen, issuePrice)) : null,
    vsIssuePct: issuePrice ? r2(pct(today.close, issuePrice)) : null,
    vsListingHighPct: r2(pct(today.close, listingDayHigh)),
    aboveIssuePrice: issuePrice ? today.close > issuePrice : null,
    aboveListingDayHigh: today.close > listingDayHigh,
    issueState,
    listingHighState,
    ipoStatus: status.label,
    ipoStatusRank: status.rank,
    ipoStatusTone: status.tone,
    crossedIssueOn: issuePrice ? crossedOn(closes, dates, issuePrice) : null,
    crossedListingHighOn: crossedOn(closes, dates, listingDayHigh),
    highSinceListing: r2(highSinceListing),
    baseDepthPct: r2(((highSinceListing - lowSinceListing) / highSinceListing) * 100),
    ipoWarnings: warnings,
  };
}
