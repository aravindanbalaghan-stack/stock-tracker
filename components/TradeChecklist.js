"use client";

// Journal checklist UI: the grade badge, the tick-list inside the trade
// form, and the dialog where you edit the checklist itself.

import { useState } from "react";
import { GRADES, gradeOf, scoreChecklist, SCOPES } from "@/lib/tradeChecklist";

const field = { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" };
const inputCls = "rounded px-2 py-1.5 text-sm outline-none border w-full";

export function QualityBadge({ quality, compact = false }) {
  if (!quality)
    return (
      <span className="text-[10px]" style={{ color: "var(--text-faint)" }} title="Not scored against your checklist — open the trade and click Score it now">
        not scored
      </span>
    );
  const g = gradeOf(quality.pct);
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-mono whitespace-nowrap"
      style={{ borderColor: g.tone, color: g.tone }}
      title={`${g.label} — ${quality.done} of ${quality.total} checklist points (${quality.pct}%)`}
    >
      <b>{g.id}</b>
      {!compact && <span>{quality.done}/{quality.total}</span>}
    </span>
  );
}

export const gradeScale = () => GRADES.map((g) => `${g.id} ${g.min ? `≥${g.min}%` : `<${GRADES[GRADES.length - 2].min}%`}`).join(" · ");

/**
 * The tick-list inside the trade form. `value` is the trade's own checklist
 * ([{id, text, done}]) or null when it hasn't been scored.
 */
export function ChecklistSection({ value, onChange, template, onAddToTemplate, onManage, instrument = "stock" }) {
  const [draft, setDraft] = useState("");
  const [saveToTemplate, setSaveToTemplate] = useState(true);
  const [msg, setMsg] = useState(null);
  const score = scoreChecklist(value);
  const g = score?.grade;

  if (!value?.length) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-dashed px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          This trade hasn&apos;t been scored against your checklist.
        </span>
        <button
          type="button"
          onClick={() => onChange((template ?? []).map((p) => ({ ...p, done: false })))}
          className="text-xs px-2.5 py-1 rounded border shrink-0"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          Score it now
        </button>
      </div>
    );
  }

  const toggle = (i) => onChange(value.map((p, k) => (k === i ? { ...p, done: !p.done } : p)));
  const remove = (i) => onChange(value.filter((_, k) => k !== i));

  async function add() {
    const text = draft.replace(/\s+/g, " ").trim();
    if (!text) return;
    if (value.some((p) => p.text.toLowerCase() === text.toLowerCase())) {
      setMsg("That point is already on the list.");
      return;
    }
    const id = `custom-${Date.now().toString(36)}`;
    let point = { id, text };
    setMsg(null);
    if (saveToTemplate && onAddToTemplate) {
      try {
        point = (await onAddToTemplate(text, instrument)) ?? point;
      } catch (err) {
        setMsg(`Added to this trade only — ${err.message}`);
      }
    }
    onChange([...value, { ...point, done: true }]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-display leading-none" style={{ color: g.tone }}>
            {g.id}
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            <b style={{ color: "var(--text)" }}>{g.label}</b> · {score.done} of {score.total} points ({score.pct}%)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono" style={{ color: "var(--text-faint)" }} title="Grade = share of points ticked">
            {gradeScale()}
          </span>
          {onManage && (
            <button type="button" onClick={onManage} className="text-[11px] underline" style={{ color: "var(--accent)" }}>
              Edit checklist
            </button>
          )}
        </div>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }} aria-hidden>
        <div className="h-full rounded-full transition-all" style={{ width: `${score.pct}%`, background: g.tone }} />
      </div>
      <ul className="grid gap-1 md:grid-cols-2">
        {value.map((p, i) => (
          <li key={p.id} className="group flex items-start gap-2 rounded px-2 py-1.5 hover:bg-[var(--hover-soft)]">
            <input type="checkbox" id={`ck-${p.id}`} checked={p.done} onChange={() => toggle(i)} className="mt-0.5 shrink-0" />
            <label htmlFor={`ck-${p.id}`} className="text-xs leading-snug flex-1 cursor-pointer" style={{ color: p.done ? "var(--text)" : "var(--text-muted)" }}>
              {p.text}
            </label>
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-[11px] opacity-0 group-hover:opacity-100 focus:opacity-100"
              style={{ color: "var(--text-faint)" }}
              aria-label={`Drop "${p.text}" from this trade`}
              title="Not relevant to this trade — drop it from this trade's score"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add another point that mattered for this trade…"
          className={`${inputCls} flex-1 min-w-[12rem]`}
          style={field}
        />
        <label className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <input type="checkbox" checked={saveToTemplate} onChange={(e) => setSaveToTemplate(e.target.checked)} />
          Keep it for future {instrument === "index" ? "index" : "stock"} trades
        </label>
        <button type="button" onClick={add} disabled={!draft.trim()} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
          + Add point
        </button>
      </div>
      {msg && <span className="text-[11px]" style={{ color: "var(--tier-mid)" }}>{msg}</span>}
    </div>
  );
}

/** Dialog to edit the checklist itself — applies to trades logged from now on. */
export function ChecklistManager({ points, onSave, onClose }) {
  const [list, setList] = useState(() => points.map((p) => ({ ...p })));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const move = (i, d) =>
    setList((l) => {
      const j = i + d;
      if (j < 0 || j >= l.length) return l;
      const c = [...l];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  const add = () => {
    const text = draft.replace(/\s+/g, " ").trim();
    if (!text) return;
    setList((l) => [...l, { id: `custom-${Date.now().toString(36)}`, text, scope: newScope }]);
    setDraft("");
  };
  const [newScope, setNewScope] = useState("both");
  const [show, setShow] = useState("all");
  const count = (id) => list.filter((p) => (p.scope ?? "both") === "both" || (p.scope ?? "both") === id).length;

  async function save() {
    setError(null);
    const cleaned = list.map((p) => ({ ...p, text: p.text.trim() })).filter((p) => p.text);
    if (!cleaned.length) {
      setError("Keep at least one point");
      return;
    }
    setBusy(true);
    try {
      await onSave(cleaned);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: "var(--scrim)" }} onClick={onClose}>
      <div className="min-h-full flex justify-center px-3 py-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Trade checklist"
          className="w-full max-w-xl my-auto rounded-lg border p-4 flex flex-col gap-3"
          style={{ background: "var(--surface)", borderColor: "var(--border-strong)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div>
            <h3 className="font-display text-lg" style={{ color: "var(--text)" }}>
              Trade checklist
            </h3>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Every new trade starts with the points for what it is — a stock, or an index like NIFTY / BANK NIFTY. Its quality
              grade is the share you tick — {gradeScale()}. Each trade keeps its own copy, so changing this list doesn&apos;t change
              the grades of trades already logged.
            </p>
            <div className="flex items-center gap-1.5 mt-2 text-[11px]" role="group" aria-label="Show points for">
              {[
                ["all", `All ${list.length}`],
                ["stock", `Stock trades see ${count("stock")}`],
                ["index", `Index trades see ${count("index")}`],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setShow(id)}
                  aria-pressed={show === id}
                  className="px-2 py-0.5 rounded-full border"
                  style={show === id ? { borderColor: "var(--accent)", color: "var(--accent)" } : { borderColor: "var(--border)", color: "var(--text-muted)" }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ol className="flex flex-col gap-1">
            {list.map((p, i) =>
              show !== "all" && (p.scope ?? "both") !== "both" && p.scope !== show ? null : (
              <li key={p.id} className="flex items-center gap-1.5">
                <span className="w-5 text-right text-[11px] font-mono shrink-0" style={{ color: "var(--text-faint)" }}>
                  {i + 1}
                </span>
                <input
                  value={p.text}
                  onChange={(e) => setList((l) => l.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))}
                  className={inputCls}
                  style={field}
                  aria-label={`Point ${i + 1}`}
                />
                <select
                  value={p.scope ?? "both"}
                  onChange={(e) => setList((l) => l.map((x, k) => (k === i ? { ...x, scope: e.target.value } : x)))}
                  className="rounded px-1.5 py-1.5 text-xs border shrink-0 w-[5.5rem]"
                  style={field}
                  aria-label={`Point ${i + 1} applies to`}
                  title="Which trades this point appears on"
                >
                  {SCOPES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-xs px-1.5 py-1 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }} aria-label="Move up">
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} className="text-xs px-1.5 py-1 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }} aria-label="Move down">
                  ↓
                </button>
                <button type="button" onClick={() => setList((l) => l.filter((_, k) => k !== i))} className="text-xs px-1.5 py-1 rounded border" style={{ borderColor: "var(--border)", color: "var(--loss)" }} aria-label={`Remove point ${i + 1}`}>
                  ✕
                </button>
              </li>
              )
            )}
          </ol>
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="New point, e.g. Relative strength at a new high"
              className={inputCls}
              style={field}
            />
            <select value={newScope} onChange={(e) => setNewScope(e.target.value)} className="rounded px-1.5 py-1.5 text-xs border shrink-0 w-[5.5rem]" style={field} aria-label="New point applies to">
              {SCOPES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button type="button" onClick={add} disabled={!draft.trim()} className="text-xs px-3 py-1.5 rounded border shrink-0" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
              + Add
            </button>
          </div>
          {error && <span className="text-xs" style={{ color: "var(--loss)" }}>{error}</span>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
              Cancel
            </button>
            <button type="button" onClick={save} disabled={busy} className="text-xs px-4 py-1.5 rounded font-medium" style={{ background: "var(--accent)", color: "var(--on-accent)" }}>
              {busy ? "Saving…" : `Save ${list.length} points`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
