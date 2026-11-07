"use client";

// Holdings → Edit: add shares (averages the price in), sell shares (keeps
// the average, reduces quantity), or correct the figures directly.

import { useState } from "react";

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}

const MODES = [
  { id: "buy", label: "Add shares" },
  { id: "sell", label: "Sell shares" },
  { id: "edit", label: "Correct figures" },
];

const field = { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" };

function Input({ label, ...props }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        {label}
      </span>
      <input {...props} className="rounded px-2 py-1.5 text-sm font-mono outline-none border w-full" style={field} />
    </label>
  );
}

export default function EditHoldingDialog({ holding, currentPrice, onSave, onRemove, onClose }) {
  const today = new Date().toISOString().slice(0, 10);
  const [mode, setMode] = useState("buy");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState(currentPrice != null ? String(Math.round(currentPrice * 100) / 100) : "");
  const [date, setDate] = useState(today);
  const [editQty, setEditQty] = useState(String(holding.quantity));
  const [editAvg, setEditAvg] = useState(holding.avgPrice != null ? String(holding.avgPrice) : "");
  const [editDate, setEditDate] = useState(holding.buyDate ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const q = Number(qty);
  const p = price === "" ? null : Number(price);
  const oldQty = holding.quantity;
  const oldAvg = holding.avgPrice;

  // Preview of the position after this change.
  let preview = null;
  if (mode === "buy" && q > 0) {
    const newQty = oldQty + q;
    const newAvg = oldAvg != null && p != null ? (oldQty * oldAvg + q * p) / newQty : (oldAvg ?? p);
    preview = { quantity: newQty, avgPrice: newAvg != null ? Math.round(newAvg * 100) / 100 : null };
  } else if (mode === "sell" && q > 0) {
    preview = { quantity: oldQty - q, avgPrice: oldAvg, realised: p != null && oldAvg != null ? (p - oldAvg) * q : null };
  } else if (mode === "edit") {
    preview = { quantity: Number(editQty), avgPrice: editAvg === "" ? null : Number(editAvg) };
  }

  async function save() {
    setError(null);
    try {
      if (mode === "buy") {
        if (!(q > 0)) throw new Error("Enter how many shares you added");
        if (p == null || !(p > 0)) throw new Error("Enter the price you paid");
      } else if (mode === "sell") {
        if (!(q > 0)) throw new Error("Enter how many shares you sold");
        if (q > oldQty) throw new Error(`You only hold ${oldQty}`);
      } else {
        if (!(Number(editQty) > 0)) throw new Error("Quantity must be greater than 0");
      }
      setBusy(true);
      if (mode === "sell" && q === oldQty) {
        if (!window.confirm(`That sells your whole ${holding.symbol} position. Remove it from Holdings?`)) {
          setBusy(false);
          return;
        }
        await onRemove(holding.symbol);
        onClose();
        return;
      }
      const patch =
        mode === "edit"
          ? { quantity: Number(editQty), avgPrice: editAvg === "" ? null : Number(editAvg), buyDate: editDate || null }
          : { quantity: preview.quantity, avgPrice: preview.avgPrice };
      await onSave(holding.symbol, {
        ...patch,
        historyEntry:
          mode === "edit"
            ? { type: "edit", quantity: Number(editQty), price: editAvg === "" ? null : Number(editAvg), date: today }
            : { type: mode, quantity: q, price: p, date },
      });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div className="min-h-full flex justify-center px-4 py-6">
      <div
        className="w-full max-w-sm my-auto rounded-lg border p-4 flex flex-col gap-3"
        style={{ background: "var(--surface)", borderColor: "var(--border-strong)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-lg" style={{ color: "var(--text)" }}>
            {holding.symbol}
          </h3>
          <span className="text-xs font-mono" style={{ color: "var(--text-faint)" }}>
            {fmt(oldQty, 0)} × {oldAvg == null ? "—" : `₹${fmt(oldAvg)}`}
          </span>
        </div>

        <div className="flex rounded-[var(--radius-sm)] border p-0.5 gap-0.5" style={{ borderColor: "var(--border)" }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className="flex-1 py-1.5 text-xs font-medium rounded-[4px]"
              style={{ background: mode === m.id ? "var(--surface-3)" : "transparent", color: mode === m.id ? "var(--text)" : "var(--text-muted)" }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode !== "edit" ? (
          <div className="grid grid-cols-3 gap-2">
            <Input label={mode === "buy" ? "Qty added" : "Qty sold"} type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
            <Input label={mode === "buy" ? "Buy price ₹" : "Sell price ₹"} type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Input label="Quantity" type="number" min="1" step="1" value={editQty} onChange={(e) => setEditQty(e.target.value)} />
            <Input label="Avg price ₹" type="number" min="0" step="0.01" value={editAvg} onChange={(e) => setEditAvg(e.target.value)} />
            <Input label="Buy date" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
          </div>
        )}

        {preview && Number.isFinite(preview.quantity) && (
          <div className="rounded-[var(--radius-sm)] px-3 py-2 text-xs" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
            After this: <span className="font-mono" style={{ color: "var(--text)" }}>{fmt(preview.quantity, 0)}</span> shares at{" "}
            <span className="font-mono" style={{ color: "var(--text)" }}>{preview.avgPrice == null ? "—" : `₹${fmt(preview.avgPrice)}`}</span> avg
            {preview.realised != null && (
              <>
                {" "}
                · realised{" "}
                <span className="font-mono" style={{ color: preview.realised >= 0 ? "var(--gain)" : "var(--loss)" }}>
                  {preview.realised >= 0 ? "+" : ""}₹{fmt(preview.realised, 0)}
                </span>
              </>
            )}
            {mode === "buy" && <span className="block mt-0.5" style={{ color: "var(--text-faint)" }}>The average price is recalculated from both buys.</span>}
          </div>
        )}

        {holding.history?.length > 0 && (
          <details>
            <summary className="text-xs cursor-pointer" style={{ color: "var(--accent)" }}>
              History ({holding.history.length})
            </summary>
            <ul className="mt-1 text-[11px] font-mono max-h-32 overflow-y-auto" style={{ color: "var(--text-muted)" }}>
              {[...holding.history].reverse().map((h, i) => (
                <li key={i}>
                  {h.date ?? h.at?.slice(0, 10)} · {h.type} {h.quantity ?? ""} {h.price != null ? `@ ₹${fmt(h.price)}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}

        {error && (
          <span className="text-xs" style={{ color: "var(--loss)" }}>
            {error}
          </span>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={busy} className="text-xs px-3 py-1.5 rounded font-medium" style={{ background: "var(--accent)", color: "var(--bg)" }}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
