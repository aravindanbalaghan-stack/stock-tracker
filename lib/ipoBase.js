// IPO Base — a recent listing breaking out of the range it set on its
// first day. Judged on WEEKLY closes (this week so far vs last week), the
// way an IPO base breakout is read on a chart:
//
//   Breakout above listing-day high   this week's close is above the high of
//                                     the first trading session, and last
//                                     week's close was at or below it
//   Crossing listing-day open         this week's close is back above the
//                                     listing-day open (the debut price),
//                                     last week's close was at or below it,
//                                     and it's still under the listing-day
//                                     high — the earlier, lower-conviction
//                                     move inside the base
//   Crossing IPO price                same weekly test against the issue price
//
// then, for stocks not crossing anything this week:
//   Approaching listing-day high      within 5% below it
//   Approaching IPO price             within 5% below it
//   Holding above listing-day high / listing-day open / IPO price
//
// Extra checks shown with each row (they don't change the status):
//   • volume: this week's average daily volume vs the base's (listing day
//     excluded — it's always huge). 1.4×+ is the classic confirmation.
//   • new high: whether this week's close is also above every earlier
//     weekly close since listing. If the stock already ran past the
//     listing-day high and fell back, the real top of the base is higher,
//     and crossing the listing-day high alone isn't a new high.
//   • base length: weeks since listing. A breakout in the first 2-3 weeks
//     is a continuation of the debut, not a base.

import { istDateOf } from "@/lib/yahooFinance";

export const IPO = {
  nearPct: 5,
  volumeConfirm: 1.4,
  minBaseWeeks: 3,
};

export const IPO_STATUS = {
  BREAKOUT_HIGH: { rank: 1, label: "Breakout above listing-day high", tone: "gain" },
  CROSS_OPEN: { rank: 2, label: "Crossing listing-day open", tone: "gain" },
  CROSS_IPO: { rank: 3, label: "Crossing IPO price", tone: "gain" },
  NEAR_HIGH: { rank: 4, label: "Approaching listing-day high", tone: "accent" },
  NEAR_IPO: { rank: 5, label: "Approaching IPO price", tone: "accent" },
  ABOVE_HIGH: { rank: 6, label: "Holding above listing-day high", tone: "muted" },
  ABOVE_OPEN: { rank: 7, label: "Holding above listing-day open", tone: "muted" },
  ABOVE_IPO: { rank: 8, label: "Holding above IPO price", tone: "muted" },
  BELOW: { rank: 9, label: "Below all levels", tone: "loss" },
};
// Ranks that count as "crossing this week" — what the screen shows by default.
export const IPO_CROSSING_MAX_RANK = 3;

const pct = (a, b) => ((a - b) / b) * 100;
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

// Monday of the IST week an ISO date falls in.
function weekOfIso(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Weekly closes from daily closes: [{ week, close, firstIdx, lastIdx }] oldest first. */
function weeklyCloses(closes, dates) {
  const out = [];
  dates.forEach((d, i) => {
    const wk = weekOfIso(d);
    const last = out[out.length - 1];
    if (last && last.week === wk) {
      last.close = closes[i];
      last.lastIdx = i;
    } else out.push({ week: wk, close: closes[i], firstIdx: i, lastIdx: i });
  });
  return out;
}

// This week vs last week against one level.
function weeklyState(weeks, level) {
  if (level == null) return null;
  const now = weeks[weeks.length - 1]?.close;
  const prev = weeks[weeks.length - 2]?.close;
  if (now == null) return null;
  if (now > level) return prev != null && prev <= level ? "crossing" : "above";
  return now >= level * (1 - IPO.nearPct / 100) ? "approaching" : "below";
}

// Week-ending session on which the current run of weekly closes above
// `level` began (null if not above now, or above ever since listing).
function crossedOnWeekly(weeks, dates, level) {
  let j = weeks.length - 1;
  if (!(weeks[j]?.close > level)) return null;
  while (j > 0 && weeks[j - 1].close > level) j--;
  return j === 0 ? null : dates[weeks[j].lastIdx];
}

function combine({ high, open, ipo }) {
  if (high === "crossing") return IPO_STATUS.BREAKOUT_HIGH;
  if (open === "crossing" && high !== "above") return IPO_STATUS.CROSS_OPEN;
  if (ipo === "crossing") return IPO_STATUS.CROSS_IPO;
  if (high === "approaching") return IPO_STATUS.NEAR_HIGH;
  if (ipo === "approaching") return IPO_STATUS.NEAR_IPO;
  if (high === "above") return IPO_STATUS.ABOVE_HIGH;
  if (open === "above" || open === "crossing") return IPO_STATUS.ABOVE_OPEN;
  if (ipo === "above") return IPO_STATUS.ABOVE_IPO;
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

  // Daily volumes lined up with `closes` (the bhavcopy volume for today).
  const vols = [];
  for (const b of bars) {
    if (istDateOf(b.t) >= todayDate) break;
    vols.push(b.v ?? null);
  }
  vols.push(today.volume ?? null);

  const weeks = weeklyCloses(closes, dates);
  const weeksSinceListing = weeks.length; // listing week counts as week 1
  const listingHighState = weeklyState(weeks, listingDayHigh);
  const listingOpenState = weeklyState(weeks, listingOpen);
  const issueState = issuePrice ? weeklyState(weeks, issuePrice) : null;
  const status =
    weeks.length < 2
      ? { rank: 99, label: "Listed this week", tone: "muted" }
      : combine({ high: listingHighState, open: listingOpenState, ipo: issueState });

  // Volume: this week's average daily volume vs the base's (listing day
  // excluded — day one's volume is always an outlier).
  const thisWeek = weeks[weeks.length - 1];
  const avg = (arr) => {
    const v = arr.filter((x) => Number.isFinite(x) && x > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const weekVol = avg(vols.slice(thisWeek.firstIdx));
  const baseVol = avg(vols.slice(1, thisWeek.firstIdx));
  const weekVolumeRatio = weekVol && baseVol ? weekVol / baseVol : null;

  // New high: this week's close above every earlier weekly close.
  const priorBest = Math.max(...weeks.slice(0, -1).map((w) => w.close));
  const newWeeklyHigh = weeks.length >= 2 && thisWeek.close > priorBest;

  const notes = [];
  if (status.rank <= IPO_CROSSING_MAX_RANK) {
    if (weekVolumeRatio != null && weekVolumeRatio < IPO.volumeConfirm) {
      notes.push(`Volume this week is ${weekVolumeRatio.toFixed(2)}× the base average — below the ${IPO.volumeConfirm}× that usually confirms a breakout`);
    }
    if (status === IPO_STATUS.BREAKOUT_HIGH && !newWeeklyHigh) {
      notes.push("Already traded above the listing-day high earlier and fell back — the base's real top is higher than this level");
    }
    if (weeksSinceListing <= IPO.minBaseWeeks) {
      notes.push(`Only ${weeksSinceListing} weeks since listing — too early to be a base`);
    }
  }

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
    aboveListingOpen: today.close > listingOpen,
    vsListingOpenPct: r2(pct(today.close, listingOpen)),
    lastWeekClose: r2(weeks[weeks.length - 2]?.close ?? null),
    weeksSinceListing,
    weekVolumeRatio: r2(weekVolumeRatio),
    volumeConfirmed: weekVolumeRatio != null ? weekVolumeRatio >= IPO.volumeConfirm : null,
    newWeeklyHigh,
    ipoNotes: notes,
    issueState,
    listingHighState,
    listingOpenState,
    ipoStatus: status.label,
    ipoStatusRank: status.rank,
    ipoStatusTone: status.tone,
    crossedIssueOn: issuePrice ? crossedOnWeekly(weeks, dates, issuePrice) : null,
    crossedListingHighOn: crossedOnWeekly(weeks, dates, listingDayHigh),
    crossedListingOpenOn: crossedOnWeekly(weeks, dates, listingOpen),
    highSinceListing: r2(highSinceListing),
    baseDepthPct: r2(((highSinceListing - lowSinceListing) / highSinceListing) * 100),
    ipoWarnings: warnings,
  };
}
