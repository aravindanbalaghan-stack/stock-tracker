// Reads a plain-language trade note — "Bought 50 TCS at 4012, SL 3950,
// target 4200. Pocket pivot off the 10 DMA, felt a bit of FOMO" — and pulls
// out whatever it can: side, symbol, quantity, price, stop, target, setup,
// emotions, segment. Pure pattern matching in the browser (no AI call, no
// cost, works offline); anything it misses you fill in when completing the
// trade. Also spots exit notes ("Closed TCS at 4100") so they can be
// attached to the open trade.

import { EMOTIONS } from "@/lib/journalStats";

const SETUPS = [
  "Trendline breakout",
  "Pocket pivot",
  "Shakeout",
  "IPO base",
  "Personal learning",
  "Odds-ranked pick",
  "Trading Suggestion",
  "Breakout",
  "Pullback",
  "Gap up",
  "Reversal",
  "Retest",
  "VCP",
  "Cup and handle",
  "Flag",
];

// Upper-case words that aren't stock symbols.
const NOT_SYMBOLS = new Set([
  "SL", "TP", "CE", "PE", "NSE", "BSE", "AT", "RS", "INR", "FOMO", "DMA", "EMA", "SMA", "MA", "RSI", "ATH", "VWAP", "OI", "PCR",
  "IPO", "VCP", "AM", "PM", "EOD", "BTST", "STBT", "MIS", "CNC", "NRML", "LTP", "Q1", "Q2", "Q3", "Q4", "I", "A", "OK", "R", "RR",
  "FUT", "CALL", "PUT", "ITM", "OTM", "ATM", "GTT", "AMO", "NIFTY50",
]);

const N = "(\\d[\\d,]*(?:\\.\\d+)?)";
const num = (s) => (s == null ? null : Number(String(s).replace(/,/g, "")));

const ENTRY_WORDS = /\b(bought|buy|buying|long|went long|entered|added|accumulated|short(?:ed)?|sold short|took (?:a )?(?:long|short))\b/i;
const EXIT_WORDS = /\b(exit(?:ed)?|closed?|booked|sold|squared? off|stopped out|hit (?:my )?(?:sl|stop)|cut (?:the )?loss|took profit|trailed out)\b/i;

export function parseQuickNote(text) {
  const t = String(text ?? "");
  const out = {};

  const shortish = /\b(short(?:ed)?|sold short|went short)\b/i.test(t);
  const isEntry = ENTRY_WORDS.test(t);
  const isExit = EXIT_WORDS.test(t) && !/\bsold short\b/i.test(t);
  out.kind = isExit && !isEntry ? "exit" : "entry";
  if (out.kind === "entry" && (isEntry || shortish)) out.side = shortish ? "Short" : "Long";

  // Symbol: the first ALL-CAPS token that isn't a known abbreviation.
  // Options/futures names like BANKNIFTY 52000 CE keep the index name.
  const tokens = t.match(/\b[A-Z][A-Z0-9&-]{1,19}\b/g) ?? [];
  let symbol = tokens.find((w) => !NOT_SYMBOLS.has(w) && !/^\d/.test(w));
  if (!symbol) {
    // Typed in lower case: take the word after the action ("bought 10 reliance at…").
    const m = t.match(
      /\b(?:bought|buy|sold|short(?:ed)?|long(?:\s+on)?|closed|exited|entered|added)\s+(?:\d[\d,]*\s+)?(?:(?:shares|qty)\s+)?(?:of\s+)?([a-z][a-z0-9&-]{1,19})\b/i
    );
    const w = m?.[1]?.toUpperCase();
    if (w && !NOT_SYMBOLS.has(w) && !["AT", "ON", "THE", "SOME", "MORE", "QTY", "SHARES", "MY", "OUT", "OF", "INTO", "IN"].includes(w)) symbol = w;
  }
  if (symbol) out.symbol = symbol;

  const stop = t.match(new RegExp(`\\b(?:sl|stop(?:[- ]?loss)?|stoploss)\\b\\s*(?:at|@|of|is|=|:)?\\s*(?:rs\\.?|₹)?\\s*${N}`, "i"));
  if (stop) out.stopLoss = num(stop[1]);
  const target = t.match(new RegExp(`\\b(?:target|tgt|tp)\\b\\s*(?:at|@|of|is|=|:)?\\s*(?:rs\\.?|₹)?\\s*${N}`, "i"));
  if (target) out.target = num(target[1]);

  // Price: "at 4012" / "@ 4012" / "₹4012" — skipping the stop and target numbers.
  const prices = [...t.matchAll(new RegExp(`(?:\\bat\\b|@|₹|rs\\.?)\\s*${N}`, "gi"))].map((m) => num(m[1]));
  const price = prices.find((p) => p !== out.stopLoss && p !== out.target);
  if (price != null) {
    if (out.kind === "exit") out.exitPrice = price;
    else out.entryPrice = price;
  }

  // Quantity: "50 TCS", "50 shares", "qty 50", "2 lots".
  const qty =
    t.match(new RegExp(`\\b(?:qty|quantity)\\s*(?:of|=|:)?\\s*${N}`, "i")) ??
    t.match(new RegExp(`${N}\\s*(?:shares|qty|nos|units)\\b`, "i")) ??
    (symbol ? t.match(new RegExp(`\\b${N}\\s+(?:of\\s+)?${symbol.replace(/[-&]/g, "\\$&")}\\b`)) : null);
  if (qty) out.quantity = num(qty[1]);
  const lots = t.match(new RegExp(`${N}\\s*lots?\\b`, "i"));
  if (lots) out.lots = num(lots[1]);

  if (/\b(CE|PE|call|put|option)\b/i.test(t)) out.segment = "Options";
  else if (/\b(fut|futures?)\b/i.test(t)) out.segment = "Futures";
  else if (/\b(intraday|mis|scalp)\b/i.test(t)) out.segment = "Equity – intraday";

  if (/\bintraday|scalp\b/i.test(t)) out.timeframe = "Intraday";
  else if (/\b(swing|btst)\b/i.test(t)) out.timeframe = "Swing (days)";
  else if (/\b(positional|long[- ]term|investment)\b/i.test(t)) out.timeframe = "Positional (weeks+)";

  const lower = t.toLowerCase();
  const setup = SETUPS.find((s) => lower.includes(s.toLowerCase()));
  if (setup) out.setup = setup;
  const emotions = EMOTIONS.filter((e) => new RegExp(`\\b${e.toLowerCase()}`).test(lower));
  if (/\bscared|nervous|anxious\b/.test(lower) && !emotions.includes("Fear")) emotions.push("Fear");
  if (/\brevenge\b/.test(lower) && !emotions.includes("Revenge")) emotions.push("Revenge");
  if (emotions.length) out.emotions = emotions;

  return out;
}

/** Short human labels for what was understood, shown under the note box. */
export function describeParse(p) {
  const bits = [];
  if (p.kind === "exit") bits.push("Exit");
  if (p.side) bits.push(p.side);
  if (p.symbol) bits.push(p.symbol);
  if (p.quantity) bits.push(`qty ${p.quantity}`);
  if (p.lots) bits.push(`${p.lots} lot${p.lots === 1 ? "" : "s"}`);
  if (p.entryPrice) bits.push(`@ ${p.entryPrice}`);
  if (p.exitPrice) bits.push(`exit @ ${p.exitPrice}`);
  if (p.stopLoss) bits.push(`SL ${p.stopLoss}`);
  if (p.target) bits.push(`target ${p.target}`);
  if (p.segment) bits.push(p.segment);
  if (p.setup) bits.push(p.setup);
  if (p.emotions?.length) bits.push(p.emotions.join(", "));
  return bits;
}
