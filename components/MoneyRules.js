"use client";

import { useState } from "react";
import { Panel, SectionTitle } from "@/components/ui/Chrome";

// Your money-management rules, saved to your account. Used by Portfolio
// analytics (limit checks) and the Position sizer (share counts).

const FIELDS = [
  { key: "capital", label: "Trading capital", unit: "₹", step: 1000, hint: "Everything you've set aside for stocks, including cash not yet invested. Leave blank to use your portfolio's value." },
  { key: "riskPct", label: "Risk per trade", unit: "% of capital", step: 0.1, hint: "What you're willing to lose if a trade hits its stop. 0.5–1% is the usual professional range; 2% is the common ceiling." },
  { key: "maxPositionPct", label: "Max in one stock", unit: "%", step: 1, hint: "Caps the share count even when the stop is tight." },
  { key: "maxSectorPct", label: "Max in one sector", unit: "%", step: 1, hint: "Stocks in one sector tend to fall together." },
  { key: "maxOpenRiskPct", label: "Max total open risk", unit: "% of capital", step: 0.5, hint: "The sum of what every holding would lose at its stop. 6% is a common ceiling (Elder's rule)." },
];

const input =
  "w-full rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm font-mono bg-[var(--surface-2)] border-[var(--border)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]";

export default function MoneyRules({ initial, onSaved, compact = false }) {
  const [form, setForm] = useState(() => ({ ...initial, capital: initial.capital ?? "" }));
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/portfolio-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Couldn't save");
      setMsg({ ok: true, text: "Saved" });
      onSaved?.(j.settings);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <SectionTitle meta="Saved to your account">Your money-management rules</SectionTitle>
      <div className={`grid gap-3 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-5"}`}>
        {FIELDS.map((f) => (
          <label key={f.key} className="block" title={f.hint}>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {f.label} <span style={{ color: "var(--text-faint)" }}>({f.unit})</span>
            </span>
            <input
              type="number"
              step={f.step}
              min="0"
              className={`${input} mt-1`}
              value={form[f.key] ?? ""}
              placeholder={f.key === "capital" ? "portfolio value" : undefined}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
          <input type="checkbox" checked={!!form.breadthAdjust} onChange={(e) => setForm({ ...form, breadthAdjust: e.target.checked })} />
          Size down when market breadth is weak (Mixed ¾, Risk-off ½)
        </label>
        <span className="flex-1" />
        {msg && (
          <span className="text-xs" style={{ color: msg.ok ? "var(--gain)" : "var(--loss)" }} role="status">
            {msg.text}
          </span>
        )}
        <button type="button" onClick={save} disabled={busy} className="text-sm font-medium px-4 py-1.5 rounded-[var(--radius-sm)]" style={{ background: "var(--accent)", color: "var(--on-accent)" }}>
          {busy ? "Saving…" : "Save rules"}
        </button>
      </div>
    </Panel>
  );
}
