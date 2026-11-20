// Trade checklist — the points you want true before taking a trade, and the
// quality grade a trade earns from how many of them it ticked.
//
// Each trade keeps its own copy of the points as they were when it was
// logged, so editing your checklist later never rewrites the grade of an old
// trade. Pure functions: used by the form, the stats and the server.

// Each point applies to stock trades, index trades (NIFTY, BANK NIFTY …)
// or both; a trade only shows — and is only graded on — the points for
// what it is.
export const SCOPES = [
  { id: "both", label: "Both" },
  { id: "stock", label: "Stocks" },
  { id: "index", label: "Indices" },
];
const SCOPE_IDS = SCOPES.map((s) => s.id);

export const DEFAULT_CHECKLIST = [
  { text: "Stock is in Stage 2 (above a rising 30-week MA)", scope: "stock" },
  { text: "Market trend supports the direction", scope: "both" },
  { text: "Sector / theme is strong", scope: "stock" },
  { text: "Breakout or pivot on above-average volume", scope: "stock" },
  { text: "Delivery % shows accumulation", scope: "stock" },
  { text: "Entry near the pivot — not extended", scope: "both" },
  { text: "Stop-loss decided before entry", scope: "both" },
  { text: "Reward : risk at least 2 : 1", scope: "both" },
  { text: "Position size within my risk limit", scope: "both" },
  { text: "No results or big event in the next few days", scope: "stock" },
  { text: "Index at a key level (support / resistance / VWAP)", scope: "index" },
  { text: "Global cues and SGX / GIFT Nifty agree", scope: "index" },
  { text: "Option chain / OI supports the view", scope: "index" },
  { text: "Not trading in the first 15 minutes or into expiry blindly", scope: "index" },
];

// Index underlyings — a trade in any of these (spot, futures or options)
// is an index trade.
const INDEX_RE = /^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|NIFTYNXT50|NIFTYIT|SENSEX|BANKEX|SENSEX50)(\b|\d|$)/i;
export const isIndexSymbol = (symbol) => INDEX_RE.test(String(symbol ?? "").trim().replace(/\s+/g, ""));

/** "index" | "stock" — an explicit choice wins, otherwise read from the symbol. */
export const instrumentOf = (t) => (t?.instrument === "index" || t?.instrument === "stock" ? t.instrument : isIndexSymbol(t?.symbol) ? "index" : "stock");

export const appliesTo = (point, instrument) => !point.scope || point.scope === "both" || point.scope === instrument;

// Share of points ticked → grade. Equal weight per point.
export const GRADES = [
  { id: "A+", min: 90, label: "Textbook", tone: "var(--gain)" },
  { id: "A", min: 75, label: "High quality", tone: "var(--gain)" },
  { id: "B", min: 60, label: "Decent", tone: "var(--accent)" },
  { id: "C", min: 40, label: "Weak", tone: "var(--tier-mid)" },
  { id: "D", min: 0, label: "Low quality", tone: "var(--loss)" },
];
export const GRADE_ORDER = Object.fromEntries(GRADES.map((g, i) => [g.id, i]));

export function gradeOf(pct) {
  if (pct == null) return null;
  return GRADES.find((g) => pct >= g.min) ?? GRADES[GRADES.length - 1];
}

const clean = (s, max = 160) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "point";

/** Template: [{id, text, scope}] — ids are stable so renames keep stats together. */
export function normaliseTemplate(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const text = clean(typeof raw === "string" ? raw : raw?.text);
    if (!text) continue;
    let id = clean(typeof raw === "object" && raw?.id ? raw.id : slug(text), 60);
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    const scope = typeof raw === "object" && SCOPE_IDS.includes(raw?.scope) ? raw.scope : "both";
    out.push({ id, text, scope });
    if (out.length >= 40) break;
  }
  return out;
}

export const defaultTemplate = () => normaliseTemplate(DEFAULT_CHECKLIST);

/** A trade's checklist: [{id, text, scope, done}]. */
export function normaliseTradeChecklist(list) {
  const rows = (Array.isArray(list) ? list : []).filter((r) => clean(typeof r === "string" ? r : r?.text));
  return normaliseTemplate(rows).map((p, i) => ({ ...p, done: rows[i]?.done === true || rows[i]?.done === "true" }));
}

/** Fresh, unticked checklist for a new trade — only the points for its instrument. */
export const checklistFrom = (template, instrument = "stock") =>
  (template ?? []).filter((p) => appliesTo(p, instrument)).map((p) => ({ id: p.id, text: p.text, scope: p.scope ?? "both", done: false }));

/**
 * When a new trade switches between stock and index: the points for the new
 * instrument, keeping ticks on points that apply to both and any point added
 * for this trade only.
 */
export function reshapeChecklist(current, template, instrument) {
  const prev = new Map((current ?? []).map((p) => [p.id, p]));
  const inTemplate = new Set((template ?? []).map((p) => p.id));
  const base = checklistFrom(template, instrument).map((p) => ({ ...p, done: prev.get(p.id)?.done ?? false }));
  const extras = (current ?? []).filter((p) => !inTemplate.has(p.id) && appliesTo(p, instrument));
  return [...base, ...extras];
}

/** { done, total, pct, grade } — null when the trade has no checklist. */
export function scoreChecklist(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const done = list.filter((p) => p.done).length;
  const pct = Math.round((done / list.length) * 100);
  return { done, total: list.length, pct, grade: gradeOf(pct) };
}

/** From a CSV/Excel import: "a; b" ticked + "c; d" missed → a checklist. */
export function checklistFromStrings(doneStr, missedStr) {
  const split = (s) => String(s ?? "").split(/;\s*/).map((x) => clean(x)).filter(Boolean);
  const done = split(doneStr);
  const missed = split(missedStr);
  if (!done.length && !missed.length) return null;
  const list = [...done.map((text) => ({ text, done: true })), ...missed.map((text) => ({ text, done: false }))];
  return normaliseTemplate(list).map((p, i) => ({ ...p, done: list[i].done }));
}
