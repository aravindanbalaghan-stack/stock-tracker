"use client";

// Journal → trading capital and how this month is going against it:
// the amount you trade with, profit booked in the month (partial exits
// included, after charges), that profit as a % of capital, and how much
// of the capital is in open positions right now.

import { useState } from "react";
import { realisedInMonth, openExposure } from "@/lib/journalStats";

const inr = (n) => `${n < 0 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
const tone = (n) => (n > 0 ? "var(--gain)" : n < 0 ? "var(--loss)" : "var(--text-muted)");
const field = { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" };

const thisMonth = () => new Date(Date.now() + 19800 * 1000).toISOString().slice(0, 7);
const shiftMonth = (ym, d) => {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + d, 1));
  return dt.toISOString().slice(0, 7);
};
const monthLabel = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

function Tile({ label, children, sub }) {
  return (
    <div className="rounded-[var(--radius)] border p-3 min-w-0" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="text-[10px] uppercase tracking-wide flex items-center justify-between gap-2" style={{ color: "var(--text-faint)" }}>
        {label}
      </div>
      <div className="font-mono text-lg mt-0.5">{children}</div>
      {sub && (
        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

export default function JournalCapital({ capital, onSaveCapital, enriched }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(null);
  const [month, setMonth] = useState(thisMonth);

  const m = realisedInMonth(enriched, month);
  const prev = realisedInMonth(enriched, shiftMonth(month, -1));
  const year = month.slice(0, 4);
  const ytd = Array.from({ length: Number(month.slice(5, 7)) }, (_, i) => realisedInMonth(enriched, `${year}-${String(i + 1).padStart(2, "0")}`).pnl).reduce((a, b) => a + b, 0);
  const exp = openExposure(enriched);
  const pct = (v) => (capital > 0 ? Math.round((v / capital) * 10000) / 100 : null);

  async function save() {
    setError(null);
    const v = Number(String(draft).replace(/[,₹\s]/g, ""));
    if (!(v > 0)) {
      setError("Enter the amount as a number");
      return;
    }
    try {
      await onSaveCapital(v);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    }
  }

  const monthNav = (
    <span className="inline-flex items-center gap-1 normal-case tracking-normal">
      <button type="button" onClick={() => setMonth((x) => shiftMonth(x, -1))} className="px-1 rounded hover:bg-[var(--hover)]" aria-label="Previous month">
        ‹
      </button>
      <span style={{ color: "var(--text-muted)" }}>{monthLabel(month)}</span>
      <button type="button" onClick={() => setMonth((x) => shiftMonth(x, 1))} disabled={month >= thisMonth()} className="px-1 rounded hover:bg-[var(--hover)] disabled:opacity-30" aria-label="Next month">
        ›
      </button>
    </span>
  );

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      <Tile
        label={
          <>
            <span>Trading capital</span>
            {!editing && (
              <button
                type="button"
                onClick={() => {
                  setDraft(capital ? String(capital) : "");
                  setEditing(true);
                }}
                className="normal-case tracking-normal underline"
                style={{ color: "var(--accent)" }}
              >
                {capital ? "Edit" : "Set"}
              </button>
            )}
          </>
        }
        sub={editing ? error : capital ? "what returns and exposure are measured against" : "the money you trade with"}
      >
        {editing ? (
          <span className="flex gap-1.5">
            <input
              autoFocus
              inputMode="decimal"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              placeholder="e.g. 500000"
              className="rounded px-2 py-1 text-sm border w-full min-w-0"
              style={field}
              aria-label="Trading capital in rupees"
            />
            <button type="button" onClick={save} className="text-xs px-2.5 rounded font-medium shrink-0" style={{ background: "var(--accent)", color: "var(--on-accent)" }}>
              Save
            </button>
          </span>
        ) : (
          <span style={{ color: capital ? "var(--text)" : "var(--text-faint)" }}>{capital ? inr(capital) : "Not set"}</span>
        )}
      </Tile>

      <Tile label={<><span>Profit</span>{monthNav}</>} sub={`${m.exits} exit${m.exits === 1 ? "" : "s"} across ${m.trades} trade${m.trades === 1 ? "" : "s"} · last month ${inr(prev.pnl)}`}>
        <span style={{ color: tone(m.pnl) }}>{m.pnl > 0 ? "+" : ""}{inr(m.pnl)}</span>
      </Tile>

      <Tile label={<><span>Return on capital</span>{monthNav}</>} sub={capital ? `${year} so far ${ytd >= 0 ? "+" : ""}${pct(ytd)}% (${inr(ytd)})` : "set your trading capital"}>
        <span style={{ color: tone(m.pnl) }}>{pct(m.pnl) == null ? "—" : `${pct(m.pnl) > 0 ? "+" : ""}${pct(m.pnl)}%`}</span>
      </Tile>

      <Tile label="Deployed now" sub={`${exp.trades} open position${exp.trades === 1 ? "" : "s"}${exp.risk ? ` · ${inr(exp.risk)} at risk to stops${capital ? ` (${pct(exp.risk)}%)` : ""}` : ""}`}>
        <span style={{ color: "var(--text)" }}>{inr(exp.amount)}</span>
        {capital > 0 && <span className="text-xs ml-1.5" style={{ color: pct(exp.amount) > 100 ? "var(--loss)" : "var(--text-muted)" }}>{pct(exp.amount)}% of capital</span>}
      </Tile>
    </div>
  );
}
