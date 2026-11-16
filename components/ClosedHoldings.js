"use client";

import { useEffect, useMemo, useState } from "react";
import { SectionTitle, Panel, ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";
import TableFrame from "@/components/ui/TableFrame";
import InfoNote from "@/components/InfoNote";
import SymbolLink from "@/components/SymbolLink";
import SellReasonFields from "@/components/SellReasonFields";
import { SELL_REASONS, PLAN_FOLLOWED } from "@/lib/sellReasons";
import { enrich, summarise, byReason, byKind, insights, fyOf, SOLD_EARLY_PCT } from "@/lib/salesStats";
import { fmt, fmtSignedPct, toneOf } from "@/lib/format";

// Holdings → Closed: every sale (whole position or part of it) with why
// you sold, how it worked out, and what the stock did afterwards.

const rupees = (v) => (v == null ? "—" : `${v < 0 ? "−" : ""}₹${fmt(Math.abs(v), 0)}`);
const signedRupees = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}₹${fmt(Math.abs(v), 0)}`);
const PLAN_LABEL = Object.fromEntries(PLAN_FOLLOWED.map((p) => [p.id, p.label]));
const field = "rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm bg-[var(--surface-2)] border-[var(--border)] text-[var(--text)]";
const TONE = { good: "var(--gain)", warn: "var(--tier-mid)", info: "var(--text-muted)" };

function Tile({ label, value, sub, tone, hint }) {
  return (
    <div className="rounded-[var(--radius)] border px-3.5 py-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }} title={hint}>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>{label}</div>
      <div className="font-mono text-lg font-semibold mt-1" style={{ color: tone ?? "var(--text)" }}>{value}</div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: "var(--text-faint)" }}>{sub}</div>}
    </div>
  );
}

function EditSale({ sale, onClose, onSaved }) {
  const [why, setWhy] = useState({ reason: sale.reason, followedPlan: sale.followedPlan, emotions: sale.emotions ?? [], note: sale.note ?? "" });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/holdings/sales", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sale.id, ...why }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Couldn't save");
      onSaved(j.sale);
      onClose();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: "var(--scrim)" }} onClick={onClose}>
      <div className="min-h-full flex justify-center px-4 py-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Why you sold ${sale.symbol}`}
          className="w-full max-w-lg my-auto rounded-lg border p-4 flex flex-col gap-3"
          style={{ background: "var(--surface)", borderColor: "var(--border-strong)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-display text-lg" style={{ color: "var(--text)" }}>{sale.symbol}</h3>
            <span className="text-xs font-mono" style={{ color: "var(--text-faint)" }}>
              sold {fmt(sale.quantity, 0)} @ ₹{fmt(sale.sellPrice)} on {sale.sellDate}
            </span>
          </div>
          <SellReasonFields value={why} onChange={setWhy} required={false} />
          {err && <span className="text-xs" style={{ color: "var(--loss)" }} role="alert">{err}</span>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>Cancel</button>
            <button type="button" onClick={save} disabled={busy} className="text-xs px-4 py-1.5 rounded font-medium" style={{ background: "var(--accent)", color: "var(--on-accent)" }}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ClosedHoldings() {
  const [state, setState] = useState({ sales: null, latest: {}, error: null });
  const [period, setPeriod] = useState("all");
  const [reason, setReason] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [scope, setScope] = useState("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [cutoff90] = useState(() => new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));

  useEffect(() => {
    let live = true;
    fetch("/api/holdings/sales")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "Couldn't load closed holdings");
        if (live) setState({ sales: j.sales ?? [], latest: j.latest ?? {}, error: null });
      })
      .catch((e) => live && setState({ sales: null, latest: {}, error: e.message }));
    return () => {
      live = false;
    };
  }, []);

  const all = useMemo(() => (state.sales ? enrich(state.sales, state.latest) : []), [state]);
  const fys = useMemo(() => [...new Set(all.map((s) => fyOf(s.sellDate)).filter(Boolean))].sort().reverse(), [all]);
  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return all.filter(
      (s) =>
        (period === "all" || (period === "90d" ? (s.sellDate ?? "") >= cutoff90 : fyOf(s.sellDate) === period)) &&
        (reason === "all" || (s.reason ?? "none") === reason) &&
        (outcome === "all" || (outcome === "win" ? s.pnlPct > 0 : outcome === "loss" ? s.pnlPct <= 0 : outcome === "early" ? s.soldEarly : true)) &&
        (scope === "all" || (scope === "full" ? s.full : !s.full)) &&
        (!q || s.symbol.includes(q))
    );
  }, [all, period, reason, outcome, scope, query, cutoff90]);
  const s = useMemo(() => summarise(rows), [rows]);
  const reasons = useMemo(() => byReason(rows), [rows]);
  const kinds = useMemo(() => byKind(rows), [rows]);
  const notes = useMemo(() => insights(rows), [rows]);

  if (state.error) return <ErrorState>{state.error}</ErrorState>;
  if (!state.sales) return <LoadingState>Loading your sales…</LoadingState>;
  if (!all.length) {
    return (
      <EmptyState>
        No sales yet. When you sell — part of a holding or all of it — use Edit → Sell shares on the Positions view. You&apos;ll be
        asked why, and every sale shows up here with how it worked out.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-5">
      <InfoNote label="How this works">
        Every sale is recorded when you use Edit → Sell shares: the quantity, your average buy price, the sell price, profit,
        how long you held, and why you sold. &ldquo;Since sale&rdquo; compares your sell price with the latest close, so you can
        see whether an exit was early or saved you money (it&apos;s blank when there&apos;s no price yet or a split makes the
        comparison meaningless). Profit is before brokerage and taxes. Partial sells use your average price at the time.
      </InfoNote>

      <div className="flex flex-wrap items-center gap-2">
        <select className={field} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
          <option value="all">All time</option>
          <option value="90d">Last 90 days</option>
          {fys.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <select className={field} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
          <option value="all">Every reason</option>
          {SELL_REASONS.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
          <option value="none">No reason recorded</option>
        </select>
        <select className={field} value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome">
          <option value="all">Winners and losers</option>
          <option value="win">Winners</option>
          <option value="loss">Losers</option>
          <option value="early">Rose {SOLD_EARLY_PCT}%+ after I sold</option>
        </select>
        <select className={field} value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Full or partial">
          <option value="all">Full and partial sales</option>
          <option value="full">Whole position sold</option>
          <option value="partial">Partial sales</option>
        </select>
        <input className={`${field} w-32 uppercase font-mono`} placeholder="Symbol" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter by symbol" />
        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
          {rows.length} of {all.length} sales
        </span>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
        <Tile label="Realised" value={signedRupees(s.realised)} tone={toneOf(s.realised)} sub={`${s.count} sales · ${s.full} full exits`} />
        <Tile label="Win rate" value={s.winRate != null ? `${fmt(s.winRate, 0)}%` : "—"} sub="sold above your average" />
        <Tile label="Avg winner" value={fmtSignedPct(s.avgWinPct, 1)} tone="var(--gain)" sub={s.avgHoldWin != null ? `held ${fmt(s.avgHoldWin, 0)} days` : null} />
        <Tile label="Avg loser" value={fmtSignedPct(s.avgLossPct, 1)} tone="var(--loss)" sub={s.avgHoldLoss != null ? `held ${fmt(s.avgHoldLoss, 0)} days` : null} />
        <Tile label="Payoff" value={s.payoff != null ? `${fmt(s.payoff, 2)}×` : "—"} hint="Average winner ÷ average loser. Above 1 means your wins are bigger than your losses." sub="avg win ÷ avg loss" />
        <Tile label="Followed plan" value={s.planFollowedPct != null ? `${fmt(s.planFollowedPct, 0)}%` : "—"} sub="of sales where you said" />
        <Tile
          label="Sold too early"
          value={s.withSince ? `${s.soldEarly}` : "—"}
          sub={s.withSince ? `rose ${SOLD_EARLY_PCT}%+ after · ${s.goodExits} fell ${SOLD_EARLY_PCT}%+` : "needs prices"}
          tone={s.soldEarly ? "var(--tier-mid)" : undefined}
        />
      </div>

      {notes.length > 0 && (
        <Panel>
          <SectionTitle meta="from the sales shown">What your selling says</SectionTitle>
          <ul className="space-y-1.5">
            {notes.map((n, k) => (
              <li key={k} className="text-sm flex gap-2">
                <span aria-hidden style={{ color: TONE[n.tone] }}>●</span>
                <span style={{ color: "var(--text)" }}>{n.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div>
          <SectionTitle meta="how each kind of exit worked out">Why you sold</SectionTitle>
          <Panel flush>
            <TableFrame name="closed-by-reason" tools={false}>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                    <th className="py-2 px-3">Reason</th>
                    <th className="py-2 px-2 text-right">Sales</th>
                    <th className="py-2 px-2 text-right">Win rate</th>
                    <th className="py-2 px-2 text-right">Avg</th>
                    <th className="py-2 px-2 text-right">Total</th>
                    <th className="py-2 px-3 text-right" title="What the stocks did after you sold, on average">Since sale</th>
                  </tr>
                </thead>
                <tbody>
                  {reasons.map((g) => (
                    <tr key={g.key} className="border-t cursor-pointer hover:bg-[var(--hover-soft)]" style={{ borderColor: "var(--border)" }} onClick={() => setReason(reason === g.key ? "all" : g.key)}>
                      <td className="py-1.5 px-3" style={{ color: g.key === "none" ? "var(--text-faint)" : "var(--text)" }}>{g.label}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-xs">{g.count}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-xs">{g.winRate != null ? `${fmt(g.winRate, 0)}%` : "—"}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: toneOf(g.avgPct) }}>{fmtSignedPct(g.avgPct, 1)}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: toneOf(g.totalPnl) }}>{signedRupees(g.totalPnl)}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-xs" style={{ color: toneOf(g.avgSincePct) }}>{fmtSignedPct(g.avgSincePct, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          </Panel>
        </div>
        <div>
          <SectionTitle meta="planned vs judgement vs emotion">By type of exit</SectionTitle>
          <Panel>
            <ul className="space-y-3">
              {kinds.map((g) => (
                <li key={g.key}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span style={{ color: "var(--text)" }}>{g.label}</span>
                    <span className="font-mono text-xs" style={{ color: toneOf(g.totalPnl) }}>{signedRupees(g.totalPnl)}</span>
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                    {g.count} sales · {g.winRate != null ? `${fmt(g.winRate, 0)}% winners` : "—"} · avg {fmtSignedPct(g.avgPct, 1)}
                    {g.avgSincePct != null && ` · then ${fmtSignedPct(g.avgSincePct, 1)}`}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <div>
        <SectionTitle meta="newest first · Edit to add or change why">Every sale</SectionTitle>
        <Panel flush>
          <TableFrame name="closed-sales" exportName="closed-holdings">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-2">Sold on</th>
                  <th className="py-2 px-2 text-right">Qty</th>
                  <th className="py-2 px-2 text-right">Bought at</th>
                  <th className="py-2 px-2 text-right">Sold at</th>
                  <th className="py-2 px-2 text-right">P&amp;L</th>
                  <th className="py-2 px-2 text-right">P&amp;L %</th>
                  <th className="py-2 px-2 text-right">Held</th>
                  <th className="py-2 px-2">Why</th>
                  <th className="py-2 px-2">Plan</th>
                  <th className="py-2 px-2">Feeling</th>
                  <th className="py-2 px-2">Notes</th>
                  <th className="py-2 px-2 text-right" title="Latest close vs your sell price">Since sale</th>
                  <th className="py-2 px-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
                    <td className="py-1.5 px-3">
                      <SymbolLink symbol={r.symbol} className="text-sm" />
                      <div className="text-[10px]" style={{ color: "var(--text-faint)" }}>{r.full ? "whole position" : `part · ${fmt(r.remaining, 0)} left`}</div>
                    </td>
                    <td className="py-1.5 px-2 font-mono text-xs" style={{ color: "var(--text-muted)" }}>{r.sellDate}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs">{fmt(r.quantity, 0)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs">{r.buyPrice != null ? `₹${fmt(r.buyPrice)}` : "—"}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs">{r.sellPrice != null ? `₹${fmt(r.sellPrice)}` : "—"}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: toneOf(r.pnl) }}>{rupees(r.pnl)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: toneOf(r.pnlPct) }}>{fmtSignedPct(r.pnlPct, 1)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>{r.holdDays != null ? `${r.holdDays}d` : "—"}</td>
                    <td className="py-1.5 px-2 text-xs max-w-[12rem]" style={{ color: r.reason ? "var(--text)" : "var(--text-faint)" }}>{r.reason ? r.reasonLabel : "not recorded"}</td>
                    <td className="py-1.5 px-2 text-xs" style={{ color: r.followedPlan === "no" ? "var(--tier-mid)" : "var(--text-muted)" }}>{PLAN_LABEL[r.followedPlan] ?? "—"}</td>
                    <td className="py-1.5 px-2 text-xs" style={{ color: "var(--text-muted)" }}>{r.emotions?.length ? r.emotions.join(", ") : "—"}</td>
                    <td className="py-1.5 px-2 text-xs max-w-[16rem]" style={{ color: "var(--text-muted)" }}>{r.note || "—"}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: r.soldEarly ? "var(--tier-mid)" : toneOf(r.sincePct) }} title={r.latestClose ? `Latest close ₹${fmt(r.latestClose)}` : undefined}>
                      {fmtSignedPct(r.sincePct, 1)}
                    </td>
                    <td className="py-1.5 px-3 text-right whitespace-nowrap">
                      <button type="button" className="text-xs px-2 py-0.5 rounded border" style={{ borderColor: "var(--border)", color: "var(--accent)" }} onClick={() => setEditing(r)} aria-label={`Edit why you sold ${r.symbol}`}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        </Panel>
      </div>

      {editing && (
        <EditSale
          sale={editing}
          onClose={() => setEditing(null)}
          onSaved={(sale) => setState((st) => ({ ...st, sales: st.sales.map((x) => (x.id === sale.id ? sale : x)) }))}
        />
      )}
    </div>
  );
}
