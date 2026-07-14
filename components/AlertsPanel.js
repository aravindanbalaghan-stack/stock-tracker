"use client";

import { useEffect, useState } from "react";

export default function AlertsPanel({ availableSymbols }) {
  const [alerts, setAlerts] = useState(null);
  const [error, setError] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [direction, setDirection] = useState("above");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  async function load() {
    try {
      const res = await fetch("/api/alerts");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load alerts");
      setAlerts(json.alerts);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setFormError(null);
    if (!symbol || !targetPrice || !phone) {
      setFormError("Fill in stock, target price, and phone number.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, targetPrice, direction, phone }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to create alert");
      setSymbol("");
      setTargetPrice("");
      setPhone("");
      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    try {
      await fetch(`/api/alerts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } catch {
      // best-effort — load() below on next mount will reconcile anyway
    }
  }

  if (error) {
    return (
      <div className="mb-6 rounded-md border px-4 py-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-muted)" }}>
        Price alerts aren&apos;t set up yet — {error}. See the README section &quot;SMS price alerts&quot; for setup steps.
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <h3 className="font-display text-sm" style={{ color: "var(--text)" }}>
          Price alerts (SMS)
        </h3>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="text-xs px-2.5 py-1 rounded border transition-colors"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          {formOpen ? "Cancel" : "+ New alert"}
        </button>
      </div>

      {formOpen && (
        <form onSubmit={handleCreate} className="px-4 py-3 border-b flex flex-wrap gap-2 items-end" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Stock</label>
            <input
              list="alert-symbols"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="TCS"
              className="rounded px-2 py-1.5 text-sm font-mono w-28 outline-none border"
              style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
            />
            <datalist id="alert-symbols">
              {availableSymbols.map((s) => (
                <option value={s} key={s} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Direction</label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="rounded px-2 py-1.5 text-sm outline-none border"
              style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
            >
              <option value="above">Reaches or goes above</option>
              <option value="below">Reaches or drops below</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Target price (₹)</label>
            <input
              type="number"
              step="0.01"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              placeholder="3500"
              className="rounded px-2 py-1.5 text-sm font-mono w-24 outline-none border"
              style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Phone (with +91)</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91XXXXXXXXXX"
              className="rounded px-2 py-1.5 text-sm font-mono w-36 outline-none border"
              style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="text-xs px-3 py-1.5 rounded"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            {submitting ? "Saving…" : "Create alert"}
          </button>

          {formError && (
            <div className="w-full text-xs mt-1" style={{ color: "var(--loss)" }}>{formError}</div>
          )}
        </form>
      )}

      <div>
        {!alerts ? (
          <div className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>Loading…</div>
        ) : alerts.length === 0 ? (
          <div className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>No alerts set yet.</div>
        ) : (
          alerts.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between px-4 py-2 border-b last:border-b-0 text-sm"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="font-mono" style={{ color: "var(--text)" }}>
                {a.symbol} {a.direction === "above" ? "≥" : "≤"} ₹{a.targetPrice}
              </span>
              <div className="flex items-center gap-3">
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded border"
                  style={{
                    borderColor: a.triggered ? "var(--accent)" : "var(--border)",
                    color: a.triggered ? "var(--accent)" : "var(--text-faint)",
                  }}
                >
                  {a.triggered ? "Sent" : "Active"}
                </span>
                <button
                  onClick={() => handleDelete(a.id)}
                  className="text-xs"
                  style={{ color: "var(--text-faint)" }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
