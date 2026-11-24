"use client";

// Journal → add / edit a trade: the trade and its fills (first buy, adds,
// partial and full exits), the checklist, and the review — the part that
// actually makes a journal useful.

import { useState } from "react";
import { EMOTIONS, MISTAKES, enrich } from "@/lib/journalStats";
import { ChecklistSection } from "@/components/TradeChecklist";
import { checklistFrom, scoreChecklist, instrumentOf, reshapeChecklist, appliesTo } from "@/lib/tradeChecklist";
import { legsOf, positionOf } from "@/lib/tradeLegs";
import TradeScreenshots from "@/components/TradeScreenshots";

const today = () => new Date(Date.now() + 19800 * 1000).toISOString().slice(0, 10);
const inr = (n, d = 0) => `₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: d })}`;
const blankLeg = (kind, qty = "") => ({ id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, kind, date: today(), qty, price: "" });

const SEGMENTS = ["Equity – delivery", "Equity – intraday", "Futures", "Options"];
const TIMEFRAMES = ["Intraday", "Swing (days)", "Positional (weeks+)"];
const SETUP_SUGGESTIONS = [
  "Trendline breakout",
  "Pocket pivot",
  "Shakeout",
  "IPO base",
  "Personal learning",
  "Odds-ranked pick",
  "Trading Suggestion",
  "Breakout",
  "Pullback to MA",
  "Gap up",
  "Reversal",
];

const field = { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" };

function F({ label, hint, children, wide }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? "col-span-2 md:col-span-3" : ""}`}>
      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        {label}
        {hint && <span className="normal-case tracking-normal"> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}
const inputCls = "rounded px-2 py-1.5 text-sm outline-none border w-full";

function Readout({ label, value, sub, tone }) {
  return (
    <div className="rounded-[var(--radius-sm)] px-2.5 py-2" style={{ background: "var(--surface-2)" }}>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        {label}
      </p>
      <p className="font-mono text-sm mt-0.5" style={{ color: tone ?? "var(--text)" }}>
        {value}
      </p>
      {sub && (
        <p className="text-[10px] mt-0.5 leading-snug" style={{ color: "var(--text-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function Chips({ options, value, onChange, tone }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className="text-[11px] px-2 py-0.5 rounded-full border"
            style={on ? { borderColor: tone, color: tone, background: "var(--surface-3)" } : { borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function blankTrade() {
  return {
    symbol: "",
    segment: SEGMENTS[0],
    side: "Long",
    entryDate: new Date().toISOString().slice(0, 10),
    quantity: "",
    entryPrice: "",
    stopLoss: "",
    target: "",
    exitDate: "",
    exitPrice: "",
    fees: "",
    setup: "",
    timeframe: TIMEFRAMES[1],
    confidence: 3,
    followedPlan: null,
    emotions: [],
    mistakes: [],
    entryReason: "",
    exitReason: "",
    lessons: "",
    screenshotUrl: "",
  };
}

export default function TradeForm({ initial, onSave, onDelete, onClose, template, onAddToTemplate, onManageChecklist, capital }) {
  const [t, setT] = useState(() => ({
    ...blankTrade(),
    ...initial,
    // nulls from a draft would otherwise blank the inputs' controlled values
    ...Object.fromEntries(Object.entries(initial ?? {}).filter(([, v]) => v === null).map(([k]) => [k, ""])),
    emotions: initial?.emotions ?? [],
    mistakes: initial?.mistakes ?? [],
    quickNotes: initial?.quickNotes ?? [],
    // New trades (and notes being completed) start with your checklist;
    // existing trades keep theirs, or stay unscored until you choose to.
    checklist: initial?.checklist?.length ? initial.checklist : null,
    instrument: initial?.instrument ?? "",
    paper: initial?.paper === true, // unticked for every new trade
    screenshots: initial?.screenshots ?? [],
    // Fills as strings for the inputs. A draft or an old single-entry trade
    // starts from its entry / exit fields.
    legs: (() => {
      const l = legsOf(initial ?? {});
      if (l.length) return l.map((x) => ({ ...x, qty: String(x.qty), price: String(x.price) }));
      return [{ ...blankLeg("entry", initial?.quantity ? String(initial.quantity) : ""), price: initial?.entryPrice ? String(initial.entryPrice) : "", date: initial?.entryDate || today() }];
    })(),
  }));
  const [newNote, setNewNote] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setT((p) => ({ ...p, [k]: e?.target ? e.target.value : e }));

  const n = (v) => (v === "" || v == null ? null : Number(v));
  // New trades (and notes being completed) start from your checklist —
  // derived at render, so it still appears if the checklist finished
  // loading after the form opened (that used to leave the trade unscored).
  const isNew = !initial?.id || !!initial?.draft;
  // Stock or index: picked explicitly, or read from the symbol (NIFTY, BANKNIFTY…).
  const instrument = instrumentOf({ instrument: t.instrument, symbol: t.symbol });
  const forThis = (template ?? []).filter((p) => appliesTo(p, instrument));
  let checklist = t.checklist;
  if (isNew) {
    if (!checklist) checklist = forThis.length ? checklistFrom(template, instrument) : null;
    else if (t.checklistKind && t.checklistKind !== instrument) checklist = reshapeChecklist(checklist, template, instrument);
  }
  const quality = scoreChecklist(checklist);

  const legs = t.legs.map((l) => ({ ...l, qty: n(l.qty), price: n(l.price) })).filter((l) => l.qty > 0 && l.price > 0 && l.date);
  const pos = positionOf(legs, t.side);
  const preview = enrich({ ...t, draft: false, legs, quantity: pos.entered, entryPrice: pos.entryAvg ?? 0, stopLoss: n(t.stopLoss), target: n(t.target), fees: n(t.fees) ?? 0 });
  const setLeg = (i, k) => (e) => setT((p) => ({ ...p, legs: p.legs.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)) }));
  const addLeg = (kind) => setT((p) => ({ ...p, legs: [...p.legs, blankLeg(kind, kind === "exit" && pos.openQty ? String(pos.openQty) : "")] }));
  const dropLeg = (i) => setT((p) => ({ ...p, legs: p.legs.filter((_, j) => j !== i) }));

  // Exposure against the trading capital.
  const deployed = pos.openQty ? pos.openQty * pos.openAvg : 0;
  const stop = n(t.stopLoss);
  const dir = t.side === "Short" ? -1 : 1;
  const atRisk = pos.openQty && stop != null ? Math.max(0, (pos.openAvg - stop) * dir) * pos.openQty : null;
  // Paper trades use no real capital, so nothing is shown as a % of it.
  const pctOf = (v) => (!t.paper && capital > 0 && v != null ? Math.round((v / capital) * 1000) / 10 : null);

  async function save() {
    setError(null);
    if (!t.symbol.trim()) {
      setError("Add the symbol");
      return;
    }
    if (!legs.some((l) => l.kind === "entry")) {
      setError("Add at least one buy (for a short, the first sell) with its quantity and price");
      return;
    }
    if (t.legs.some((l) => (l.qty !== "" || l.price !== "") && !(n(l.qty) > 0 && n(l.price) > 0 && l.date))) {
      setError("Each fill needs a date, quantity and price — or remove the empty row");
      return;
    }
    if (pos.error) {
      setError(pos.error);
      return;
    }
    setBusy(true);
    try {
      await onSave({
        ...t,
        legs,
        instrument,
        paper: !!t.paper,
        screenshots: t.screenshots,
        symbol: t.symbol.trim().toUpperCase(),
        // Saving the full form completes a draft.
        draft: false,
        checklist,
        quickNotes: newNote.trim() ? [...t.quickNotes, { at: new Date().toISOString(), text: newNote.trim() }] : t.quickNotes,
      });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    // Scrolls as a whole when the form is taller than the window. The inner
    // min-h-full wrapper centres it when it fits, and `my-auto` (not
    // items-center) means a tall form starts at the top instead of being
    // pushed above the viewport where it can't be scrolled to.
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: "var(--scrim)" }} onClick={onClose}>
      <div className="min-h-full flex justify-center px-3 py-6">
      <div role="dialog" aria-modal="true" aria-label="Trade" className="w-full max-w-3xl my-auto rounded-lg border p-4 flex flex-col gap-4" style={{ background: "var(--surface)", borderColor: "var(--border-strong)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h3 className="font-display text-lg" style={{ color: "var(--text)" }}>
              {initial?.draft ? `Complete ${initial.symbol || "trade"}` : initial?.id ? `Edit ${initial.symbol}` : "New trade"}
            </h3>
            <label
              className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border cursor-pointer"
              style={t.paper ? { borderColor: "var(--tier-mid)", color: "var(--tier-mid)" } : { borderColor: "var(--border)", color: "var(--text-muted)" }}
              title="Practice trade: its result is tracked on its own and never counted in your real P&L, returns or capital"
            >
              <input type="checkbox" checked={t.paper} onChange={(e) => setT((p) => ({ ...p, paper: e.target.checked }))} />
              Paper trade
            </label>
          </div>
          <span className="text-xs font-mono" style={{ color: preview.netPnl == null ? "var(--text-faint)" : t.paper ? "var(--text-muted)" : preview.netPnl >= 0 ? "var(--gain)" : "var(--loss)" }}>
            {t.paper && (preview.netPnl != null || preview.realisedPnl != null) ? "paper " : ""}
            {preview.netPnl != null
              ? `${preview.netPnl >= 0 ? "+" : "−"}${inr(preview.netPnl)}`
              : preview.realisedPnl != null
              ? `booked ${preview.realisedPnl >= 0 ? "+" : "−"}${inr(preview.realisedPnl)} · ${pos.openQty} open`
              : "open"}
            {preview.rMultiple != null ? ` · ${preview.rMultiple}R` : ""}
            {preview.plannedRR != null ? ` · planned ${preview.plannedRR}:1` : ""}
            {quality ? <span style={{ color: quality.grade.tone }}>{` · quality ${quality.grade.id}`}</span> : ""}
          </span>
        </div>

        <section>
          <p className="text-[11px] font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
            SCREENSHOTS <span className="font-normal">— charts at entry, exit, anything worth seeing again</span>
          </p>
          <TradeScreenshots shots={t.screenshots} onChange={(screenshots) => setT((p) => ({ ...p, screenshots }))} />
        </section>

        {(t.quickNotes.length > 0 || initial?.id) && (
          <section className="rounded-[var(--radius-sm)] p-3" style={{ background: "var(--surface-2)" }}>
            <p className="text-[11px] font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>
              {initial?.draft ? "YOUR NOTE — the fields below were filled from it; check and complete them" : "NOTES"}
            </p>
            {t.quickNotes.map((n, i) => (
              <p key={i} className="text-xs leading-relaxed mb-1 whitespace-pre-wrap" style={{ color: "var(--text)" }}>
                <span className="font-mono text-[10px] mr-1.5" style={{ color: "var(--text-faint)" }}>
                  {n.at ? new Date(n.at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : ""}
                </span>
                {n.text}
              </p>
            ))}
            <textarea
              rows={1}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add a note (saved with a timestamp)…"
              className={`${inputCls} mt-1`}
              style={field}
            />
          </section>
        )}

        <section>
          <p className="text-[11px] font-semibold mb-2" style={{ color: "var(--text-muted)" }}>THE TRADE</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
            <F label="Symbol"><input value={t.symbol} onChange={set("symbol")} className={`${inputCls} font-mono uppercase`} style={field} autoFocus placeholder="TCS" /></F>
            <F label="Segment">
              <select value={t.segment} onChange={set("segment")} className={inputCls} style={field}>{SEGMENTS.map((s) => <option key={s}>{s}</option>)}</select>
            </F>
            <F label="Side">
              <select value={t.side} onChange={set("side")} className={inputCls} style={field}><option>Long</option><option>Short</option></select>
            </F>
            <F label="Trading" hint={t.instrument ? "chosen" : "auto from symbol"}>
              <div className="flex rounded border overflow-hidden" style={{ borderColor: "var(--border)" }} role="group" aria-label="Stock or index trade">
                {[["stock", "Stock"], ["index", "Index"]].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={instrument === id}
                    onClick={() => setT((p) => ({ ...p, instrument: id }))}
                    className="flex-1 text-xs py-1.5"
                    style={instrument === id ? { background: "var(--accent)", color: "var(--on-accent)" } : { background: "var(--surface-2)", color: "var(--text-muted)" }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </F>
            <F label="Stop-loss ₹" hint="for R"><input type="number" step="0.05" value={t.stopLoss} onChange={set("stopLoss")} className={`${inputCls} font-mono`} style={field} /></F>
            <F label="Target ₹"><input type="number" step="0.05" value={t.target} onChange={set("target")} className={`${inputCls} font-mono`} style={field} /></F>
            <F label="Charges ₹" hint="all fills, brokerage, STT…"><input type="number" step="0.01" value={t.fees} onChange={set("fees")} className={`${inputCls} font-mono`} style={field} /></F>
          </div>
        </section>

        <section>
          <p className="text-[11px] font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
            FILLS <span className="font-normal">— the first {t.side === "Short" ? "sell" : "buy"}, any adds (averaging), and partial or full exits</span>
          </p>
          <div className="flex flex-col gap-1.5">
            {t.legs.map((l, i) => (
              <div key={l.id} className="grid grid-cols-[6.5rem_1fr_1fr_1fr_auto] gap-1.5 items-center">
                <select value={l.kind} onChange={setLeg(i, "kind")} className={`${inputCls} text-xs`} style={{ ...field, color: l.kind === "exit" ? "var(--loss)" : "var(--gain)" }} aria-label={`Fill ${i + 1} type`}>
                  <option value="entry">{t.side === "Short" ? (i === 0 ? "Sell" : "Add (sell)") : i === 0 ? "Buy" : "Add (buy)"}</option>
                  <option value="exit">{t.side === "Short" ? "Exit (buy)" : "Exit (sell)"}</option>
                </select>
                <input type="date" value={l.date} onChange={setLeg(i, "date")} className={inputCls} style={field} aria-label={`Fill ${i + 1} date`} />
                <input type="number" min="1" value={l.qty} onChange={setLeg(i, "qty")} className={`${inputCls} font-mono`} style={field} placeholder="Qty" aria-label={`Fill ${i + 1} quantity`} />
                <input type="number" step="0.05" value={l.price} onChange={setLeg(i, "price")} className={`${inputCls} font-mono`} style={field} placeholder="Price ₹" aria-label={`Fill ${i + 1} price`} />
                <button type="button" onClick={() => dropLeg(i)} disabled={t.legs.length === 1} className="text-xs px-2 py-1.5 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }} aria-label={`Remove fill ${i + 1}`}>
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <button type="button" onClick={() => addLeg("entry")} className="text-xs px-2.5 py-1 rounded border" style={{ borderColor: "var(--gain)", color: "var(--gain)" }}>
              + Add to position
            </button>
            <button type="button" onClick={() => addLeg("exit")} disabled={!pos.openQty} className="text-xs px-2.5 py-1 rounded border" style={{ borderColor: "var(--loss)", color: "var(--loss)", opacity: pos.openQty ? 1 : 0.5 }}>
              + Exit (part or all)
            </button>
          </div>

          {pos.entered > 0 && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              <Readout
                label="Position"
                value={pos.openQty ? `${pos.openQty.toLocaleString("en-IN")} @ ${inr(pos.openAvg, 2)}` : "Closed"}
                sub={`${pos.entered.toLocaleString("en-IN")} bought${pos.adds ? ` in ${pos.adds + 1} fills` : ""}${pos.exited ? ` · ${pos.exited.toLocaleString("en-IN")} exited @ ${inr(pos.exitAvg, 2)}` : ""}`}
              />
              <Readout
                label="Capital deployed"
                value={pos.openQty ? inr(deployed) : "₹0"}
                sub={t.paper ? "paper — no real money in it" : capital > 0 ? `${pctOf(deployed)}% of your ₹${capital.toLocaleString("en-IN")}` : "set your trading capital in Journal to see the %"}
                tone={pctOf(deployed) > 25 ? "var(--tier-mid)" : undefined}
              />
              <Readout
                label="At risk to stop"
                value={atRisk != null ? inr(atRisk) : "—"}
                sub={atRisk != null ? (t.paper ? "if this were real" : capital > 0 ? `${pctOf(atRisk)}% of capital` : "of capital: set it in Journal") : "add a stop-loss"}
                tone={pctOf(atRisk) > 2 ? "var(--loss)" : atRisk != null ? "var(--gain)" : undefined}
              />
              <Readout
                label="Booked so far"
                value={preview.realisedPnl != null ? `${preview.realisedPnl >= 0 ? "+" : "−"}${inr(preview.realisedPnl)}` : "—"}
                sub={t.paper && pos.exited ? "paper — not counted in your profit" : preview.realisedPnl != null && capital > 0 && !t.paper ? `${pctOf(preview.realisedPnl)}% of capital` : pos.exited ? "after charges" : "nothing exited yet"}
                tone={preview.realisedPnl > 0 ? "var(--gain)" : preview.realisedPnl < 0 ? "var(--loss)" : undefined}
              />
            </div>
          )}
          {pos.error && <p className="text-xs mt-2" style={{ color: "var(--loss)" }}>{pos.error}</p>}
        </section>

        <section>
          <p className="text-[11px] font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
            CHECKLIST <span className="font-normal">— tick what was true when you took the trade</span>
          </p>
          <ChecklistSection
            value={checklist}
            onChange={(checklist) => setT((p) => ({ ...p, checklist, checklistKind: instrument }))}
            template={forThis}
            instrument={instrument}
            onAddToTemplate={onAddToTemplate}
            onManage={onManageChecklist}
          />
        </section>

        <section>
          <p className="text-[11px] font-semibold mb-2" style={{ color: "var(--text-muted)" }}>REVIEW</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
            <F label="Setup">
              <input list="journal-setups" value={t.setup} onChange={set("setup")} className={inputCls} style={field} placeholder="e.g. Pocket pivot" />
              <datalist id="journal-setups">{SETUP_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
            </F>
            <F label="Timeframe">
              <select value={t.timeframe} onChange={set("timeframe")} className={inputCls} style={field}>{TIMEFRAMES.map((s) => <option key={s}>{s}</option>)}</select>
            </F>
            <F label="Confidence" hint={`${t.confidence}/5`}>
              <input type="range" min="1" max="5" value={t.confidence} onChange={(e) => setT((p) => ({ ...p, confidence: Number(e.target.value) }))} />
            </F>
            <F label="Followed my plan?" wide>
              <div className="flex gap-1.5">
                {[["Yes", true], ["No", false], ["Not sure", null]].map(([l, v]) => (
                  <button key={l} type="button" onClick={() => setT((p) => ({ ...p, followedPlan: v }))} className="text-xs px-3 py-1 rounded border"
                    style={t.followedPlan === v ? { borderColor: "var(--accent)", color: "var(--accent)", background: "var(--surface-3)" } : { borderColor: "var(--border)", color: "var(--text-muted)" }}>
                    {l}
                  </button>
                ))}
              </div>
            </F>
            <F label="How I felt" wide><Chips options={EMOTIONS} value={t.emotions} onChange={set("emotions")} tone="var(--tier-low)" /></F>
            <F label="Mistakes" wide><Chips options={MISTAKES} value={t.mistakes} onChange={set("mistakes")} tone="var(--loss)" /></F>
            <F label="Why I entered" wide><textarea rows={2} value={t.entryReason} onChange={set("entryReason")} className={inputCls} style={field} placeholder="The setup, the trigger, what I expected" /></F>
            <F label="Why I exited" wide><textarea rows={2} value={t.exitReason} onChange={set("exitReason")} className={inputCls} style={field} placeholder="Hit stop / target / rule / feeling" /></F>
            <F label="Lesson" wide><textarea rows={2} value={t.lessons} onChange={set("lessons")} className={inputCls} style={field} placeholder="One thing to repeat or avoid next time" /></F>
            <F label="Chart link" wide><input value={t.screenshotUrl} onChange={set("screenshotUrl")} className={inputCls} style={field} placeholder="TradingView / screenshot URL (optional)" /></F>
          </div>
        </section>

        {error && <span className="text-xs" style={{ color: "var(--loss)" }}>{error}</span>}

        <div className="flex justify-between gap-2">
          <span>
            {initial?.id && onDelete && (
              <button type="button" onClick={async () => { if (window.confirm("Delete this trade?")) { await onDelete(initial.id); onClose(); } }} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "var(--loss)", color: "var(--loss)" }}>
                Delete
              </button>
            )}
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={onClose} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>Cancel</button>
            <button type="button" onClick={save} disabled={busy} className="text-xs px-4 py-1.5 rounded font-medium" style={{ background: "var(--accent)", color: "var(--on-accent)" }}>{busy ? "Saving…" : "Save trade"}</button>
          </span>
        </div>
      </div>
      </div>
    </div>
  );
}
