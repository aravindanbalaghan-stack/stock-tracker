"use client";

// Journal → add / edit a trade. Three short blocks: the trade, the exit
// (leave empty while it's open), and the review — the part that actually
// makes a journal useful.

import { useState } from "react";
import { EMOTIONS, MISTAKES, enrich } from "@/lib/journalStats";

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

export default function TradeForm({ initial, onSave, onDelete, onClose }) {
  const [t, setT] = useState(() => ({ ...blankTrade(), ...initial, emotions: initial?.emotions ?? [], mistakes: initial?.mistakes ?? [] }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setT((p) => ({ ...p, [k]: e?.target ? e.target.value : e }));

  const n = (v) => (v === "" || v == null ? null : Number(v));
  const preview = enrich({ ...t, quantity: n(t.quantity) ?? 0, entryPrice: n(t.entryPrice) ?? 0, stopLoss: n(t.stopLoss), target: n(t.target), exitPrice: n(t.exitPrice), fees: n(t.fees) ?? 0 });

  async function save() {
    setError(null);
    if (!t.symbol.trim() || !(n(t.quantity) > 0) || !(n(t.entryPrice) > 0)) {
      setError("Symbol, quantity and entry price are needed");
      return;
    }
    if (t.exitPrice !== "" && !t.exitDate) {
      setError("Add the exit date too");
      return;
    }
    setBusy(true);
    try {
      await onSave({ ...t, symbol: t.symbol.trim().toUpperCase() });
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
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div className="min-h-full flex justify-center px-3 py-6">
      <div className="w-full max-w-3xl my-auto rounded-lg border p-4 flex flex-col gap-4" style={{ background: "var(--surface)", borderColor: "var(--border-strong)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-lg" style={{ color: "var(--text)" }}>
            {initial?.id ? `Edit ${initial.symbol}` : "New trade"}
          </h3>
          <span className="text-xs font-mono" style={{ color: preview.netPnl == null ? "var(--text-faint)" : preview.netPnl >= 0 ? "var(--gain)" : "var(--loss)" }}>
            {preview.netPnl != null ? `${preview.netPnl >= 0 ? "+" : "−"}₹${Math.abs(preview.netPnl).toLocaleString("en-IN")}` : "open"}
            {preview.rMultiple != null ? ` · ${preview.rMultiple}R` : ""}
            {preview.plannedRR != null ? ` · planned ${preview.plannedRR}:1` : ""}
          </span>
        </div>

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
            <F label="Entry date"><input type="date" value={t.entryDate} onChange={set("entryDate")} className={inputCls} style={field} /></F>
            <F label="Quantity"><input type="number" min="1" value={t.quantity} onChange={set("quantity")} className={`${inputCls} font-mono`} style={field} /></F>
            <F label="Entry price ₹"><input type="number" step="0.05" value={t.entryPrice} onChange={set("entryPrice")} className={`${inputCls} font-mono`} style={field} /></F>
            <F label="Stop-loss ₹" hint="for R"><input type="number" step="0.05" value={t.stopLoss} onChange={set("stopLoss")} className={`${inputCls} font-mono`} style={field} /></F>
            <F label="Target ₹"><input type="number" step="0.05" value={t.target} onChange={set("target")} className={`${inputCls} font-mono`} style={field} /></F>
            <F label="Charges ₹" hint="brokerage, STT…"><input type="number" step="0.01" value={t.fees} onChange={set("fees")} className={`${inputCls} font-mono`} style={field} /></F>
          </div>
        </section>

        <section>
          <p className="text-[11px] font-semibold mb-2" style={{ color: "var(--text-muted)" }}>EXIT <span className="font-normal">— leave empty while the trade is open</span></p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
            <F label="Exit date"><input type="date" value={t.exitDate ?? ""} onChange={set("exitDate")} className={inputCls} style={field} /></F>
            <F label="Exit price ₹"><input type="number" step="0.05" value={t.exitPrice ?? ""} onChange={set("exitPrice")} className={`${inputCls} font-mono`} style={field} /></F>
          </div>
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
            <button type="button" onClick={save} disabled={busy} className="text-xs px-4 py-1.5 rounded font-medium" style={{ background: "var(--accent)", color: "var(--bg)" }}>{busy ? "Saving…" : "Save trade"}</button>
          </span>
        </div>
      </div>
      </div>
    </div>
  );
}
