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
    description: "Recent listings that are actually trading.",
    conditions: [
      "Listed on the exchange within the last 15 months",
      "Daily volume above 5,000 shares",
    ],
  },
  "pocket-pivot": {
    label: "Pocket pivot",
    description: "Volume surge on an up day, inside an established uptrend.",
    conditions: [
      "Today's volume beats the largest down-day volume of the last 10 sessions",
      "Close at or above the previous close",
      "Close ≥ ₹20, market cap ≥ ₹100 Cr",
      "10-week average weekly volume above 100,000",
      "50-day average volume × close above ₹50 lakh (turnover floor)",
      "Close above both the 50 DMA and 200 DMA",
      "Close more than 30% above the 52-week low",
      "Close within 25% of the 52-week high",
      "Today's low touched the 10-day weighted moving average",
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
      "Scanned across a ~500-stock universe — the NIFTY 500 where NSE's constituent endpoint responds, otherwise the top 500 by turnover (the note below says which was used)",
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

export const SCREEN_ORDER = [
  "stage-2",
  "ipo-base",
  "pocket-pivot",
  "gap-up",
  "volume-expansion",
  "gap-down-reversal",
];
