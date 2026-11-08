"use client";

// Journal → "Write it down now": a plain-language box for the moment you
// trade. Save the note in seconds; Panel reads what it can (symbol, side,
// price, stop, target, setup, feelings) and keeps it as a draft under
// "Needs details" to complete later. An exit note for a stock you have an
// open trade in can close that trade straight away.

import { useMemo, useState } from "react";
import { parseQuickNote, describeParse } from "@/lib/quickNote";

const today = () => new Date().toISOString().slice(0, 10);

export default function QuickCapture({ trades, onSaveTrade }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const parsed = useMemo(() => (text.trim() ? parseQuickNote(text) : null), [text]);
  const chips = parsed ? describeParse(parsed) : [];
  const openMatch =
    parsed?.kind === "exit" && parsed.symbol
      ? trades.find((t) => !t.draft && t.exitPrice == null && t.symbol === parsed.symbol)
      : null;

  const note = () => ({ at: new Date().toISOString(), text: text.trim() });

  async function run(fn, done) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setText("");
      setMsg(done);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  const saveDraft = () =>
    run(
      () =>
        onSaveTrade({
          draft: true,
          entryDate: today(),
          quickNotes: [note()],
          symbol: parsed?.symbol ?? "",
          side: parsed?.side ?? "Long",
          quantity: parsed?.quantity ?? "",
          entryPrice: parsed?.entryPrice ?? "",
          stopLoss: parsed?.stopLoss ?? "",
          target: parsed?.target ?? "",
          segment: parsed?.segment,
          timeframe: parsed?.timeframe,
          setup: parsed?.setup ?? "",
          emotions: parsed?.emotions ?? [],
          entryReason: text.trim(),
        }),
      "Saved — it's under Needs details. Complete it whenever you're ready."
    );

  const closeOpenTrade = () =>
    run(
      () =>
        onSaveTrade({
          ...openMatch,
          exitDate: today(),
          exitPrice: parsed.exitPrice,
          exitReason: [openMatch.exitReason, text.trim()].filter(Boolean).join("\n"),
          emotions: [...new Set([...(openMatch.emotions ?? []), ...(parsed.emotions ?? [])])],
          quickNotes: [...(openMatch.quickNotes ?? []), note()],
        }),
      `Closed your ${openMatch.symbol} trade at ₹${parsed.exitPrice}. Open it from the table to add the lesson.`
    );

  const addNoteToOpen = () =>
    run(
      () => onSaveTrade({ ...openMatch, quickNotes: [...(openMatch.quickNotes ?? []), note()] }),
      `Note added to your open ${openMatch.symbol} trade.`
    );

  return (
    <div className="rounded-[var(--radius)] border p-3" style={{ borderColor: "var(--accent-dim)", background: "var(--surface)" }}>
      <label htmlFor="quick-note" className="text-xs font-semibold" style={{ color: "var(--text)" }}>
        Write it down now
        <span className="font-normal" style={{ color: "var(--text-faint)" }}>
          {" "}
          — in your own words, the moment you trade. Fill in the details later.
        </span>
      </label>
      <textarea
        id="quick-note"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim() && !busy) {
            e.preventDefault();
            openMatch && parsed.exitPrice != null ? closeOpenTrade() : saveDraft();
          }
        }}
        placeholder={`e.g. "Bought 50 TCS at 4012, SL 3950, target 4200 — pocket pivot off the 10 DMA, felt a bit of FOMO"\nor "Closed TCS at 4100, took profit near resistance"`}
        className="w-full mt-2 rounded px-3 py-2 text-sm outline-none border leading-relaxed"
        style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
        <div className="flex flex-wrap items-center gap-1.5 min-h-[1.5rem]">
          {chips.length > 0 ? (
            <>
              <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
                Understood:
              </span>
              {chips.map((c) => (
                <span key={c} className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
                  {c}
                </span>
              ))}
            </>
          ) : (
            <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
              Tip: on your phone, tap the keyboard&apos;s mic and just say it. Ctrl/⌘ + Enter saves.
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {openMatch && parsed.exitPrice != null ? (
            <>
              <button type="button" disabled={busy} onClick={addNoteToOpen} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                Just add as a note
              </button>
              <button type="button" disabled={busy} onClick={closeOpenTrade} className="text-xs px-3 py-1.5 rounded font-medium" style={{ background: "var(--accent)", color: "var(--bg)" }}>
                Close my {openMatch.symbol} trade at ₹{parsed.exitPrice}
              </button>
            </>
          ) : openMatch ? (
            <button type="button" disabled={busy || !text.trim()} onClick={addNoteToOpen} className="text-xs px-3 py-1.5 rounded font-medium" style={{ background: "var(--accent)", color: "var(--bg)" }}>
              Add note to open {openMatch.symbol} trade
            </button>
          ) : (
            <button type="button" disabled={busy || !text.trim()} onClick={saveDraft} className="text-xs px-3 py-1.5 rounded font-medium disabled:opacity-40" style={{ background: "var(--accent)", color: "var(--bg)" }}>
              {busy ? "Saving…" : "Save note"}
            </button>
          )}
        </div>
      </div>
      {msg && (
        <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
          {msg}
        </p>
      )}
    </div>
  );
}
