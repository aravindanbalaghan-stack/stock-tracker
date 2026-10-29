// Definitions for the Chartink-style screens, shared between
// app/api/screeners/route.js and the UI so the label and the plain-English
// description of each filter live in exactly one place.
//
// `conditions` is the literal filter, written out for the "How this works"
// note — worth keeping verbatim so it can be checked against the original
// Chartink screener without reading the implementation.

export const SCREENS = {
  "ipo-base": {
    label: "IPO base",
    description:
      "Recent listings crossing — or within 5% of — their IPO price or their listing-day high.",
    conditions: [
      "Listed on the exchange within the last 15 months, daily volume above 5,000 shares",
      "IPO price = final issue price from NSE's Past Issues data (top of the price band where no final price is published); listing-day high = the high of the first trading session",
      "Status — Crossing: closed above the level within the last 5 sessions, after being at or below it. Approaching: below the level but within 5%. Holding above: above it for more than 5 sessions",
      "Priority when both levels apply: Crossing listing-day high → Approaching listing-day high → Crossing IPO price → Approaching IPO price → Holding above listing-day high → Holding above IPO price",
      "Stocks more than 5% below both levels are left out",
      "Debut ₹ is the listing-day open; prices are split/bonus-adjusted, and a ⚠ marks rows where the IPO price may not be on the same basis",
    ],
  },
  "pocket-pivot": {
    label: "Pocket pivot",
    description:
      "Morales & Kacher's early-entry signal: an up day whose volume out-prints every down day of the last 10 sessions, near the 10 DMA, inside an uptrend.",
    conditions: [
      "Close above the previous session's close",
      "Today's volume beats the highest volume of any DOWN day (close below the prior close) in the previous 10 sessions — and there must be at least one down day to beat",
      "Not extended: close no more than 5% above the 10-day SMA",
      "Close above both the 50 DMA and the 200 DMA",
      "Liquidity floors: close ≥ ₹20, market cap ≥ ₹100 Cr, 10-week average weekly volume above 100,000, 50-day average volume × close above ₹50 lakh",
      "Type: 50-DMA bounce or 10-DMA continuation when the day's low (or the prior close) came within 1.5% of that MA; otherwise Inside base",
      "Grade A = no warnings. Grade B = at least one of: close in the lower half of the day's range, 50 DMA declining, wedging (3+ low-volume up days into the signal), a run-up of more than 25% in the prior 20 sessions, or a rebound of more than 15% off the 10-session low",
      "Stop = the pivot day's low; Risk = distance from the close to that stop",
    ],
  },
  shakeout: {
    label: "Shakeout",
    description:
      "Stocks that just flushed the weak hands — broke a level everyone was watching, then quickly closed back above it — and are still coiled near that level for the next move.",
    conditions: [
      "Uptrend: close above a rising (or flat) 200 DMA",
      "Level: the base low (lowest low of the prior 60 sessions, set at least 5 sessions before the break and untouched since) or the 50 DMA (for stocks that closed above it on 15 of the prior 20 sessions)",
      "Shakeout: within the last 15 sessions the day's low broke that level by 0.5%–10% — deeper than 10% is treated as a breakdown",
      "Reclaim: a close back above the level within 3 sessions (the same session counts)",
      "Holding: no close below the level since the reclaim and no lower low than the shakeout low",
      "Still loaded: close no more than 15% above the level and no more than 5% above the base high (pivot); base no deeper than 35%",
      "Undercut — watch for reclaim: broke the level in the last 3 sessions and hasn't closed back above yet. Not a shakeout until it does",
      "Evidence, scored out of 7 (hover or click a row): panic volume on the break (≥1.5× avg), volume on the reclaim (≥1.2×), reclaim close in the top 40% of the range, reclaim within 1 session, delivery % higher on the reclaim than on the break and above its 30-session average, volume below 0.8× avg since the reclaim, close within 10% of the pivot",
      "Grade A = 5+ of 7, B = 3–4, C = under 3. Stop = the shakeout low",
      "Liquidity: close ≥ ₹20 and average daily turnover ≥ ₹2 Cr",
    ],
  },
  "gap-up": {
    label: "Gap up",
    description: "Gapped up and held the gap all day.",
    conditions: [
      "Open more than 3% above the previous close",
      "Day's low stayed above the previous close (gap never filled)",
      "Closed above the open",
      "Close above ₹100",
      "Close above the 150 DMA",
    ],
  },
  "volume-expansion": {
    label: "Volume expansion",
    description: "Volume returns after three quiet days, in an uptrend.",
    conditions: [
      "Volume fell on each of the last three sessions",
      "Today's volume is higher than yesterday's",
      "Today's volume is above the 30-day average volume",
      "Close above the 21 EMA",
      "Close above the 150 DMA",
    ],
  },
  "stage-2": {
    label: "Stage 2",
    description:
      "Stocks in — or just entering — Stage 2 of the four-stage model, with the entry points Weinstein and Wyckoff each prescribe.",
    conditions: [
      "Weekly close above a RISING 30-week moving average (Weinstein's Stage 2 definition)",
      "A prior basing range of at least 5 weeks, whose high is the breakout level",
      "A daily close above that base resistance — the Stage 2 breakout / Wyckoff Sign of Strength",
      "Reports every entry the two methods give: Wyckoff Spring, the breakout itself, Wyckoff Last Point of Support, and Weinstein's pullback to the rising MA",
      "Prev. stage, Stage changes and Invalid at come from the week-by-week stage since the breakout: the stage before it, every week it slipped into another stage and came back, and the weekly close that would end Stage 2 now",
      "Scanned across a ~500-stock universe — the NIFTY 500 where NSE's constituent endpoint responds, otherwise the top 500 by turnover (the note below says which was used)",
    ],
  },
  "ma-reclaim": {
    label: "30WMA reclaim",
    description: "Price dipped below the 30-week moving average and closed back above it.",
    conditions: [
      "Daily: yesterday CLOSED below the 30-week MA and today CLOSED back above it",
      "Weekly: this week TRADED below the 30-week MA but CLOSED the week above it",
      "The Type column says which condition put each stock on the list — or Both",
      "The 30-week MA is the average of the last 30 completed weekly closes, matching the 30WMA column used elsewhere in the app (not a 150-day SMA approximation)",
      "Scanned across the same ~500-stock universe as Stage 2",
    ],
  },
  wyckoff: {
    label: "Wyckoff",
    description:
      "Stocks currently showing a Wyckoff Aggressive (Spring/Shakeout) or Conservative (Last Point of Support) entry inside a Stage-2 base, with a 6-month backtested win probability for each style.",
    conditions: [
      "Same base/breakout detection as Stage 2, restricted to the two Wyckoff-labelled entries: Spring/Shakeout (Phase C) and Last Point of Support",
      "Only entries dated within the last ~40 trading days are shown — an old spring from a base that resolved long ago isn't a current opportunity",
      "Each entry is dated to the session that CONFIRMED it — for a Spring, the close back above the undercut support, not the day the low was made",
      "The headline is the most recent qualifying entry, and Phase shows where the stock is in Wyckoff's schedule now (C → D → E markup) with the session it got there",
      "The probability banner is a 6-month backtest of both entry styles across the same wide universe: win = price reaches +5% before -4% within 20 trading days of the signal (see the Wyckoff tab for the exact rule)",
      "Scanned across the same ~500-stock universe as Stage 2",
    ],
  },
  weinstein: {
    label: "Weinstein",
    description: "Stocks that recently transitioned into any of Weinstein's four stages — Basing, Advancing, Topping, or Declining.",
    conditions: [
      "Stage judged weekly: close vs. a 30-week MA, and whether that MA is rising, flat, or falling",
      "\"Entering\" means the stage changed within roughly the last 5 weeks — older, settled stages aren't shown",
      "Click a row for the stage journey: the previous stage, any dips of 3 weeks or less out of this stage and back (a re-entry), and the weekly close that would invalidate it",
      "Runs on weekly bars only, so it doesn't need a second daily-history fetch on top of Stage 2's",
      "Scanned across the same ~500-stock universe as Stage 2",
    ],
  },
  "personal-learning": {
    label: "Personal learning",
    description: "Weekly RSI above 50, above the 30-week MA, outperforming the NIFTY 500 — with any bullish weekly candlestick pattern flagged.",
    conditions: [
      "Weekly RSI(14) above 50 (Wilder's standard RSI)",
      "Weekly close above the 30-week simple moving average",
      "Relative Strength vs the NIFTY 500 above its 0 line: (stock ÷ its close 52 weeks ago) ÷ (NIFTY 500 ÷ its close 52 weeks ago) − 1 > 0. A stock that crossed 0 from below in the last 8 weeks is tagged as a fresh crossover",
      "Bullish candlestick pattern on this week's or last week's candle — 17 patterns: Hammer, Inverted Hammer, Dragonfly Doji, Bullish Belt Hold, Bullish Marubozu, Bullish Engulfing, Piercing Line, Bullish Harami, Bullish Harami Cross, Tweezer Bottom, Bullish Kicker, Morning Star, Morning Doji Star, Three Inside Up, Three Outside Up, Three White Soldiers, Rising Three Methods",
      "Reversal patterns (Hammer, Engulfing, Morning Star…) only count after a pullback into them — the same shape at the top of a run isn't bullish",
      "The current week's candle is provisional until Friday's close and is marked \"forming\"",
      "Use the Pattern filter to require a pattern or show every stock meeting the other three conditions",
      "Scanned across the same ~500-stock universe as Stage 2",
    ],
  },
  "gap-down-reversal": {
    label: "Gap-down reversal",
    description: "Opened sharply lower, then reversed hard on volume.",
    conditions: [
      "Open more than 3% below the previous close",
      "Closed at least 5% above its own open",
      "Volume above the 30-day average",
    ],
  },
};

// The confluence view isn't a filter of its own — it's the overlap of the
// six screens above, so it's ordered last and handled separately in the
// API. Kept here so the sub-nav can render it alongside the rest.
export const CONFLUENCE_SCREEN = "confluence";

export const CONFLUENCE_DEF = {
  label: "Confluence",
  description: "Stocks that showed up in at least two of the six screens on the same day.",
  conditions: [
    "Runs all six screens over the same trading day",
    "Keeps only the stocks matching two or more of them",
    "Sorted by how many screens each stock hit",
    "Slower than a single screen, since it runs all six",
  ],
};

export const SCREEN_ORDER = [
  "stage-2",
  "wyckoff",
  "weinstein",
  "personal-learning",
  "ipo-base",
  "pocket-pivot",
  "shakeout",
  "gap-up",
  "volume-expansion",
  "gap-down-reversal",
  "ma-reclaim",
];

// Everything shown in the Screeners sub-nav that is powered by the
// /api/screeners route.
export const ALL_SCREEN_IDS = [...SCREEN_ORDER, CONFLUENCE_SCREEN];
