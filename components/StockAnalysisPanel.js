"use client";

// Stock page → Your analysis: every idea you've written on this stock in
// the Analysis tab, with how it played out, and a quick form to add one to
// today's analysis.

import { useEffect, useState } from "react";
import Link from "next/link";
import { SectionTitle, Panel } from "@/components/ui/Chrome";

const TONE = {
  "Target hit": "var(--gain)",
  "Stop hit": "var(--loss)",
  Open: "var(--accent)",
  "Time exit": "var(--tier-low)",
};
const field = { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" };

export default function StockAnalysisPanel({ symbol, price }) {
  const [loaded, setLoaded] = useState({ key: null, ideas: [], studies: [] });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ direction: "Long", entry: "", stop: "", target: "", setup: "", thesis: "" });
  const [msg, setMsg] = useState(null);
  const ideas = loaded.key === symbol ? loaded.ideas : [];
  const studies = loaded.key === symbol ? loaded.studies : [];

  const load = () =>
    fetch(`/api/analysis?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setLoaded({ key: symbol, ideas: j?.ideas ?? [], studies: j?.studies ?? [] }))
      .catch(() => {});
  useEffect(() => {
    Promise.resolve().then(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  async function add() {
    setMsg(null);
    const res = await fetch("/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: { symbol, ...form } }),
    });
    if (res.ok) {
      setMsg("Added to today's analysis.");
      setOpen(false);
      setForm({ direction: "Long", entry: "", stop: "", target: "", setup: "", thesis: "" });
      load();
    } else {
      setMsg("Couldn't add it — are you signed in?");
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <SectionTitle
        meta={
          <span className="flex items-center gap-3">
            <button type="button" onClick={() => setOpen((v) => !v)} className="hover:underline" style={{ color: "var(--accent)" }}>
              {open ? "Cancel" : "+ Add to today's analysis"}
            </button>
            <Link href="/?tab=analysis" className="hover:underline" style={{ color: "var(--text-faint)" }}>
              Analysis tab
            </Link>
          </span>
        }
      >
        Your analysis
      </SectionTitle>
      <Panel>
        {open && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
            <select value={form.direction} onChange={set("direction")} className="rounded px-2 py-1.5 text-sm border" style={field}>
              <option>Long</option>
              <option>Short</option>
            </select>
            <input type="number" value={form.entry} onChange={set("entry")} placeholder={price ? `Trigger (now ${price})` : "Trigger"} className="rounded px-2 py-1.5 text-sm border font-mono" style={field} />
            <input type="number" value={form.stop} onChange={set("stop")} placeholder="Stop" className="rounded px-2 py-1.5 text-sm border font-mono" style={field} />
            <input type="number" value={form.target} onChange={set("target")} placeholder="Target" className="rounded px-2 py-1.5 text-sm border font-mono" style={field} />
            <input value={form.setup} onChange={set("setup")} placeholder="Setup" className="rounded px-2 py-1.5 text-sm border" style={field} />
            <button type="button" onClick={add} className="rounded px-3 py-1.5 text-xs font-medium" style={{ background: "var(--accent)", color: "var(--bg)" }}>
              Add idea
            </button>
            <input value={form.thesis} onChange={set("thesis")} placeholder="Why — one line" className="col-span-2 md:col-span-6 rounded px-2 py-1.5 text-sm border" style={field} />
          </div>
        )}
        {msg && (
          <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
            {msg}
          </p>
        )}
        {studies.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>
              Technical studies
            </p>
            <ul className="flex flex-col">
              {[...studies].reverse().map((st) => (
                <li key={st.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 border-b last:border-b-0 text-xs" style={{ borderColor: "var(--border)" }}>
                  <span className="font-mono" style={{ color: "var(--text-faint)" }}>
                    {st.date}
                  </span>
                  <span style={{ color: st.verdict === "Bullish" ? "var(--gain)" : st.verdict === "Bearish" ? "var(--loss)" : "var(--accent)" }}>{st.verdict || "—"}</span>
                  <span style={{ color: "var(--text-muted)" }}>
                    W {st.timeframes?.Weekly?.trend || "—"} · D {st.timeframes?.Daily?.trend || "—"}
                    {st.stage ? ` · Stage ${st.stage}` : ""}
                  </span>
                  {st.patterns?.length > 0 && <span style={{ color: "var(--text-muted)" }}>{st.patterns.join(", ")}</span>}
                  {st.verdictGrade?.correct != null && (
                    <span style={{ color: st.verdictGrade.correct ? "var(--gain)" : "var(--loss)" }}>
                      {st.verdictGrade.correct ? "✓ right" : "✗ wrong"}
                      {st.verdictGrade.move10 != null ? ` (${st.verdictGrade.move10 >= 0 ? "+" : ""}${st.verdictGrade.move10}% in 10)` : ""}
                    </span>
                  )}
                  {st.notes && (
                    <span className="basis-full line-clamp-2" style={{ color: "var(--text-muted)" }}>
                      {st.notes}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {ideas.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-faint)" }}>
            {studies.length ? "No trade ideas on" : "You haven't written an idea or study on"} {symbol} yet.
          </p>
        ) : (
          <ul className="flex flex-col">
            {[...ideas].reverse().map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 border-b last:border-b-0 text-xs" style={{ borderColor: "var(--border)" }}>
                <span className="font-mono" style={{ color: "var(--text-faint)" }}>
                  {i.date}
                </span>
                <span style={{ color: i.direction === "Long" ? "var(--gain)" : "var(--loss)" }}>{i.direction}</span>
                <span className="font-mono" style={{ color: "var(--text-muted)" }}>
                  {i.entry ?? "mkt"}
                  {i.stop ? ` · SL ${i.stop}` : ""}
                  {i.target ? ` · T ${i.target}` : ""}
                </span>
                {i.setup && <span style={{ color: "var(--text-muted)" }}>{i.setup}</span>}
                <span style={{ color: TONE[i.outcome?.status] ?? "var(--text-faint)" }}>
                  {i.outcome?.status ?? ""}
                  {i.outcome?.returnPct != null ? ` ${i.outcome.returnPct >= 0 ? "+" : ""}${i.outcome.returnPct}%` : ""}
                </span>
                {i.thesis && (
                  <span className="basis-full" style={{ color: "var(--text-muted)" }}>
                    {i.thesis}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
