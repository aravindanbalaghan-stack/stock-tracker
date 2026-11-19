// Trade checklist — the points you want true before taking a trade, and the
// quality grade a trade earns from how many of them it ticked.
//
// Each trade keeps its own copy of the points as they were when it was
// logged, so editing your checklist later never rewrites the grade of an old
// trade. Pure functions: used by the form, the stats and the server.

export const DEFAULT_CHECKLIST = [
  "Stock is in Stage 2 (above a rising 30-week MA)",
  "Market trend supports buying",
  "Sector / theme is strong",
  "Breakout or pivot on above-average volume",
  "Delivery % shows accumulation",
  "Entry near the pivot — not extended",
  "Stop-loss decided before entry",
  "Reward : risk at least 2 : 1",
  "Position size within my risk limit",
  "No results or big event in the next few days",
];

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

/** Template: [{id, text}] — ids are stable so renames keep stats together. */
export function normaliseTemplate(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const text = clean(typeof raw === "string" ? raw : raw?.text);
    if (!text) continue;
    let id = clean(typeof raw === "object" && raw?.id ? raw.id : slug(text), 60);
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    out.push({ id, text });
    if (out.length >= 40) break;
  }
  return out;
}

export const defaultTemplate = () => normaliseTemplate(DEFAULT_CHECKLIST);

/** A trade's checklist: [{id, text, done}]. */
export function normaliseTradeChecklist(list) {
  return normaliseTemplate(list).map((p, i) => ({ ...p, done: !!(Array.isArray(list) && (list[i]?.done === true || list[i]?.done === "true")) }));
}

/** Fresh, unticked checklist for a new trade. */
export const checklistFrom = (template) => (template ?? []).map((p) => ({ id: p.id, text: p.text, done: false }));

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
