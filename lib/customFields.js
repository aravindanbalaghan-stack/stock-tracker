// What the custom screener builder can test — shared by the UI (pickers,
// labels) and the server (validation, evaluation). No server imports here.

export const FIELD_GROUPS = ["Price", "Moving averages", "Highs & lows", "Momentum", "Volume", "Delivery", "Trend"];

// unit: how a value is shown and typed — "₹", "%", "×", "Cr", "shares", "" (plain), "stage"
export const FIELDS = [
  { id: "close", label: "Close", group: "Price", unit: "₹" },
  { id: "chg1", label: "Change today", group: "Price", unit: "%" },
  { id: "ret5", label: "Return 5 days", group: "Price", unit: "%" },
  { id: "ret20", label: "Return 20 days", group: "Price", unit: "%" },
  { id: "ret60", label: "Return 60 days", group: "Price", unit: "%" },
  { id: "ret120", label: "Return 120 days", group: "Price", unit: "%" },

  { id: "sma10", label: "10-day average", group: "Moving averages", unit: "₹" },
  { id: "sma20", label: "20-day average", group: "Moving averages", unit: "₹" },
  { id: "sma50", label: "50-day average", group: "Moving averages", unit: "₹" },
  { id: "sma100", label: "100-day average", group: "Moving averages", unit: "₹" },
  { id: "sma200", label: "200-day average", group: "Moving averages", unit: "₹" },
  { id: "ema20", label: "20-day EMA", group: "Moving averages", unit: "₹" },

  { id: "high20", label: "Highest high, prior 20 days", group: "Highs & lows", unit: "₹" },
  { id: "high50", label: "Highest high, prior 50 days", group: "Highs & lows", unit: "₹" },
  { id: "low20", label: "Lowest low, prior 20 days", group: "Highs & lows", unit: "₹" },
  { id: "high52", label: "52-week high (prior)", group: "Highs & lows", unit: "₹" },
  { id: "low52", label: "52-week low (prior)", group: "Highs & lows", unit: "₹" },
  { id: "fromHigh52", label: "% from 52-week high", group: "Highs & lows", unit: "%" },
  { id: "fromLow52", label: "% above 52-week low", group: "Highs & lows", unit: "%" },

  { id: "rsi14", label: "RSI (14)", group: "Momentum", unit: "" },
  { id: "atrPct14", label: "ATR (14) as % of price", group: "Momentum", unit: "%" },

  { id: "volume", label: "Volume", group: "Volume", unit: "shares" },
  { id: "avgVol20", label: "Avg volume, prior 20 days", group: "Volume", unit: "shares" },
  { id: "avgVol50", label: "Avg volume, prior 50 days", group: "Volume", unit: "shares" },
  { id: "volRatio", label: "Volume vs 20-day avg", group: "Volume", unit: "×" },
  { id: "turnover", label: "Turnover", group: "Volume", unit: "Cr" },
  { id: "avgTurnover20", label: "Avg turnover, 20 days", group: "Volume", unit: "Cr" },

  { id: "deliv", label: "Delivery %", group: "Delivery", unit: "%" },
  { id: "avgDeliv20", label: "Avg delivery %, 20 days", group: "Delivery", unit: "%" },

  { id: "stage", label: "Weinstein stage", group: "Trend", unit: "stage" },
];

export const FIELD_BY_ID = Object.fromEntries(FIELDS.map((f) => [f.id, f]));

export const OPS = [
  { id: "gt", label: ">" },
  { id: "gte", label: "≥" },
  { id: "lt", label: "<" },
  { id: "lte", label: "≤" },
  { id: "eq", label: "=" },
  { id: "crossAbove", label: "crosses above" },
  { id: "crossBelow", label: "crosses below" },
];
export const OP_BY_ID = Object.fromEntries(OPS.map((o) => [o.id, o]));

export const UNIVERSES = [
  { id: "top500", label: "Top 500 by turnover (≈ NIFTY 500)" },
  { id: "liquid", label: "All liquid stocks (₹1 Cr+/day)" },
  { id: "all", label: "Every NSE stock" },
];

export const BLANK_CONDITION = { left: "close", op: "gt", right: { kind: "field", field: "sma50", mult: 1 } };

export const PRESETS = [
  {
    name: "Stage 2 breakout on volume",
    def: {
      universe: "top500",
      logic: "all",
      conditions: [
        { left: "stage", op: "eq", right: { kind: "value", value: 2 } },
        { left: "close", op: "gt", right: { kind: "field", field: "high20", mult: 1 } },
        { left: "volRatio", op: "gte", right: { kind: "value", value: 2 } },
      ],
    },
  },
  {
    name: "Delivery accumulation in an uptrend",
    def: {
      universe: "liquid",
      logic: "all",
      conditions: [
        { left: "avgDeliv20", op: "gte", right: { kind: "value", value: 55 } },
        { left: "close", op: "gt", right: { kind: "field", field: "sma50", mult: 1 } },
        { left: "ret20", op: "gt", right: { kind: "value", value: 0 } },
        { left: "avgTurnover20", op: "gte", right: { kind: "value", value: 5 } },
      ],
    },
  },
  {
    name: "Within 5% of a 52-week high",
    def: {
      universe: "top500",
      logic: "all",
      conditions: [
        { left: "fromHigh52", op: "gte", right: { kind: "value", value: -5 } },
        { left: "close", op: "gt", right: { kind: "field", field: "sma200", mult: 1 } },
      ],
    },
  },
  {
    name: "Pullback in an uptrend",
    def: {
      universe: "top500",
      logic: "all",
      conditions: [
        { left: "close", op: "gt", right: { kind: "field", field: "sma200", mult: 1 } },
        { left: "sma50", op: "gt", right: { kind: "field", field: "sma200", mult: 1 } },
        { left: "rsi14", op: "lt", right: { kind: "value", value: 40 } },
      ],
    },
  },
  {
    name: "Golden cross",
    def: {
      universe: "top500",
      logic: "all",
      conditions: [{ left: "sma50", op: "crossAbove", right: { kind: "field", field: "sma200", mult: 1 } }],
    },
  },
];

/** Cleans a definition from the client; throws with a readable message. */
export function validateDefinition(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Missing screen definition");
  const universe = UNIVERSES.some((u) => u.id === raw.universe) ? raw.universe : "top500";
  const logic = raw.logic === "any" ? "any" : "all";
  const list = Array.isArray(raw.conditions) ? raw.conditions : [];
  if (!list.length) throw new Error("Add at least one condition");
  if (list.length > 12) throw new Error("Up to 12 conditions per screen");
  const conditions = list.map((c, k) => {
    if (!FIELD_BY_ID[c?.left]) throw new Error(`Condition ${k + 1}: pick what to test`);
    if (!OP_BY_ID[c?.op]) throw new Error(`Condition ${k + 1}: pick a comparison`);
    const r = c.right ?? {};
    if (r.kind === "field") {
      if (!FIELD_BY_ID[r.field]) throw new Error(`Condition ${k + 1}: pick what to compare against`);
      const mult = Number(r.mult ?? 1);
      if (!Number.isFinite(mult) || mult <= 0) throw new Error(`Condition ${k + 1}: the multiplier must be a positive number`);
      return { left: c.left, op: c.op, right: { kind: "field", field: r.field, mult } };
    }
    const value = Number(r.value);
    if (!Number.isFinite(value)) throw new Error(`Condition ${k + 1}: enter a number`);
    if (c.op === "crossAbove" || c.op === "crossBelow") {
      // crossing a fixed level is fine too (e.g. RSI crosses above 30)
    }
    return { left: c.left, op: c.op, right: { kind: "value", value } };
  });
  const sectors = Array.isArray(raw.sectors) ? raw.sectors.filter((s) => typeof s === "string").slice(0, 40) : [];
  const themes = Array.isArray(raw.themes) ? raw.themes.filter((s) => typeof s === "string").slice(0, 40) : [];
  const num = (x) => (x === "" || x == null || !Number.isFinite(Number(x)) ? null : Number(x));
  return { universe, logic, conditions, sectors, themes, mcapMin: num(raw.mcapMin), mcapMax: num(raw.mcapMax) };
}

/** Plain-English rendering of one condition, e.g. "Close > 1.0× 50-day average". */
export function describeCondition(c) {
  const l = FIELD_BY_ID[c.left]?.label ?? c.left;
  const op = OP_BY_ID[c.op]?.label ?? c.op;
  if (c.right?.kind === "field") {
    const r = FIELD_BY_ID[c.right.field]?.label ?? c.right.field;
    const m = Number(c.right.mult ?? 1);
    return `${l} ${op} ${m !== 1 ? `${m}× ` : ""}${r}`;
  }
  const f = FIELD_BY_ID[c.left];
  const unit = f?.unit === "%" ? "%" : f?.unit === "×" ? "×" : f?.unit === "Cr" ? " Cr" : "";
  const prefix = f?.unit === "₹" ? "₹" : f?.unit === "stage" ? "Stage " : "";
  return `${l} ${op} ${prefix}${c.right?.value}${unit}`;
}
