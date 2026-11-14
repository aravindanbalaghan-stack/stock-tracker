"use client";

// Journal — log every trade with its plan and a short review, and let the
// numbers show what's working: expectancy, R-multiples, losers vs winners,
// mistakes that cost money, setups that pay. Export it (CSV / Excel / JSON)
// or as an "AI review pack" to hand to an AI coach.

import { useEffect, useMemo, useRef, useState } from "react";
import { ScreenHeader, SectionTitle, Panel, ErrorState, LoadingState } from "@/components/ui/Chrome";
import TradeForm from "@/components/TradeForm";
import QuickCapture from "@/components/QuickCapture";
import { describeParse, parseQuickNote } from "@/lib/quickNote";
import SymbolLink from "@/components/SymbolLink";
import { enrich, computeStats, insights, exportRows, EXPORT_COLUMNS, aiReviewPack } from "@/lib/journalStats";
import { downloadTable, downloadText, parseTableFile } from "@/lib/tabularFile";
import { usePersistentState } from "@/lib/usePersistentState";
import TableFrame from "@/components/ui/TableFrame";

const inr = (n, d = 0) =>
  n == null ? "—" : `${n < 0 ? "−" : ""}₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d })}`;
const tone = (n) => (n == null ? "var(--text-faint)" : n > 0 ? "var(--gain)" : n < 0 ? "var(--loss)" : "var(--text-muted)");

const PERIODS = [
  { id: "all", label: "All time" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "ytd", label: "This year" },
];

function periodStart(id) {
  const d = new Date();
  if (id === "30") d.setDate(d.getDate() - 30);
  else if (id === "90") d.setDate(d.getDate() - 90);
  else if (id === "ytd") return `${d.getFullYear()}-01-01`;
  else return null;
  return d.toISOString().slice(0, 10);
}

function Metric({ label, value, sub, color }) {
  return (
    <div className="rounded-[var(--radius)] border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
        {label}
      </p>
      <p className="font-mono text-lg mt-0.5" style={{ color: color ?? "var(--text)" }}>
        {value}
      </p>
      {sub && (
        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-faint)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function EquityCurve({ curve }) {
  if (!curve?.length) return null;
  const W = 600;
  const H = 140;
  const vals = [0, ...curve.map((p) => p.equity)];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => (i / (vals.length - 1 || 1)) * W;
  const y = (v) => H - ((v - min) / span) * (H - 10) - 5;
  const path = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = vals[vals.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-36" preserveAspectRatio="none" role="img" aria-label="Equity curve">
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeDasharray="4 4" />
      <path d={path} fill="none" stroke={last >= 0 ? "var(--gain)" : "var(--loss)"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function GroupTable({ title, rows, empty }) {
  return (
    <div>
      <p className="text-[11px] font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>
        {title}
      </p>
      {!rows?.length ? (
        <p className="text-xs" style={{ color: "var(--text-faint)" }}>
          {empty}
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--text-faint)" }}>
              <th className="text-left font-medium py-1">&nbsp;</th>
              <th className="text-right font-medium py-1">Trades</th>
              <th className="text-right font-medium py-1">Win %</th>
              <th className="text-right font-medium py-1">Net</th>
              <th className="text-right font-medium py-1">Avg R</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.key} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-1 pr-2" style={{ color: "var(--text)" }}>
                  {g.key}
                </td>
                <td className="py-1 text-right font-mono" style={{ color: "var(--text-muted)" }}>
                  {g.trades}
                </td>
                <td className="py-1 text-right font-mono" style={{ color: "var(--text-muted)" }}>
                  {g.winRate}%
                </td>
                <td className="py-1 text-right font-mono" style={{ color: tone(g.netPnl) }}>
                  {inr(g.netPnl)}
                </td>
                <td className="py-1 text-right font-mono" style={{ color: tone(g.avgR) }}>
                  {g.avgR == null ? "—" : `${g.avgR}R`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function JournalTab() {
  const [trades, setTrades] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // trade object, {} for new
  const [period, setPeriod] = usePersistentState("journal.period", "all");
  const [statusFilter, setStatusFilter] = usePersistentState("journal.status", "all");
  const [marks, setMarks] = useState({});
  const [importMsg, setImportMsg] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    fetch("/api/journal")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "Couldn't load the journal");
        setTrades(j.trades);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Live prices for open trades, so unrealised P&L shows.
  const openSymbols = useMemo(
    () => [...new Set((trades ?? []).filter((t) => !t.draft && t.exitPrice == null && t.symbol).map((t) => t.symbol))].join(","),
    [trades]
  );
  useEffect(() => {
    if (!openSymbols) return;
    fetch(`/api/quote?symbols=${encodeURIComponent(openSymbols)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setMarks(Object.fromEntries((j?.results ?? []).filter((q) => q.price != null).map((q) => [q.symbol, q.price]))))
      .catch(() => {});
  }, [openSymbols]);

  const start = periodStart(period);
  const enriched = useMemo(() => (trades ?? []).map((t) => enrich(t, marks)), [trades, marks]);
  const inPeriod = enriched.filter((t) => !start || (t.exitDate ?? t.entryDate) >= start);
  const stats = useMemo(() => computeStats(inPeriod), [inPeriod]);
  const notes = insights(stats);
  const drafts = enriched.filter((t) => t.status === "Draft");
  const listed = inPeriod.filter((t) => t.status !== "Draft" && (statusFilter === "all" || t.status.toLowerCase() === statusFilter));
  const unrealised = enriched.filter((t) => t.status === "Open" && t.netPnl != null).reduce((a, t) => a + t.netPnl, 0);

  async function saveTrade(t) {
    const res = await fetch("/api/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trade: t }) });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error || "Couldn't save");
    setTrades(j.trades);
  }
  async function deleteTrade(id) {
    const res = await fetch(`/api/journal?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const j = await res.json();
    if (res.ok) setTrades(j.trades);
  }

  async function exportAs(format) {
    const rows = exportRows(inPeriod);
    const base = `panel-journal-${new Date().toISOString().slice(0, 10)}`;
    if (format === "ai") {
      downloadText(aiReviewPack(inPeriod, stats, { from: start ?? undefined }), `${base}-ai-review.md`, "text/markdown");
      return;
    }
    const summary = Object.entries(stats)
      .filter(([, v]) => typeof v !== "object")
      .map(([metric, value]) => ({ metric, value }));
    await downloadTable(rows, EXPORT_COLUMNS, {
      format,
      baseName: base,
      sheetName: "Trades",
      extraSheets: [
        { name: "Summary", rows: summary, columns: ["metric", "value"] },
        { name: "By setup", rows: stats.bySetup ?? [], columns: ["key", "trades", "winRate", "netPnl", "avgPnl", "avgR"] },
        { name: "By mistake", rows: stats.byMistake ?? [], columns: ["key", "trades", "winRate", "netPnl", "avgPnl", "avgR"] },
      ],
      jsonExtra: { exportedAt: new Date().toISOString(), summary: { ...stats, curve: undefined } },
    });
  }

  async function onImport(file) {
    setImportMsg(null);
    if (!file) return;
    try {
      const { rows } = await parseTableFile(file);
      const mode = window.confirm(`Import ${rows.length} trades from ${file.name}?\n\nOK = add/update (merge)\nCancel = stop`) ? "merge" : null;
      if (!mode) return;
      const res = await fetch("/api/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ import: rows, mode }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Import failed");
      setTrades(j.trades);
      setImportMsg(`Imported ${j.imported} trades${j.skipped ? ` · ${j.skipped} skipped (missing symbol, date, quantity or entry price)` : ""}.`);
    } catch (err) {
      setImportMsg(err.message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const sel = { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" };

  return (
    <div>
      <ScreenHeader
        title="Journal"
        meta={
          trades
            ? `${trades.filter((t) => !t.draft).length} trades logged · ${stats.closed ?? 0} closed in view${drafts.length ? ` · ${drafts.length} note${drafts.length === 1 ? "" : "s"} to complete` : ""}`
            : "Your trades, the plan behind them, and what the numbers say"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded px-2 py-1 text-xs border" style={sel}>
              {PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <select value="" onChange={(e) => e.target.value && exportAs(e.target.value)} className="rounded px-2 py-1 text-xs border" style={sel} disabled={!trades?.length}>
              <option value="">Export…</option>
              <option value="ai">AI review pack (.md)</option>
              <option value="xlsx">Excel</option>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
            <button type="button" onClick={() => fileRef.current?.click()} className="text-xs px-2.5 py-1 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
              Import
            </button>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.json" className="hidden" onChange={(e) => onImport(e.target.files?.[0])} />
            <button type="button" onClick={() => setEditing({})} className="text-xs px-3 py-1 rounded font-medium" style={{ background: "var(--accent)", color: "var(--bg)" }}>
              + New trade
            </button>
          </div>
        }
      />

      {importMsg && (
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          {importMsg}
        </p>
      )}
      {error && <ErrorState>{error}</ErrorState>}
      {!trades && !error && <LoadingState>Loading your journal…</LoadingState>}

      {trades && (
        <div className="mb-6 flex flex-col gap-3">
          <QuickCapture trades={trades} onSaveTrade={saveTrade} />
          {drafts.length > 0 && (
            <div>
              <SectionTitle meta="Notes saved in the moment — not counted in any stats until completed">
                Needs details ({drafts.length})
              </SectionTitle>
              <div className="grid gap-2 md:grid-cols-2">
                {drafts.map((d) => {
                  const first = d.quickNotes?.[0];
                  const chips = first ? describeParse(parseQuickNote(first.text)) : [];
                  return (
                    <div key={d.id} className="rounded-[var(--radius)] border p-3 flex flex-col gap-2" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                      <p className="text-[10px] font-mono" style={{ color: "var(--text-faint)" }}>
                        {first?.at ? new Date(first.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : d.entryDate}
                      </p>
                      <p className="text-sm leading-snug whitespace-pre-wrap" style={{ color: "var(--text)" }}>
                        {(d.quickNotes ?? []).map((n) => n.text).join("\n\n") || d.symbol}
                      </p>
                      {chips.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {chips.map((c) => (
                            <span key={c} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => window.confirm("Delete this note?") && deleteTrade(d.id)}
                          className="text-[11px] px-2 py-1 rounded border"
                          style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
                        >
                          Delete
                        </button>
                        <button type="button" onClick={() => setEditing(d)} className="text-[11px] px-2.5 py-1 rounded font-medium" style={{ background: "var(--accent)", color: "var(--bg)" }}>
                          Complete trade
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {trades && trades.filter((t) => !t.draft).length === 0 && drafts.length === 0 && (
        <Panel>
          <p className="text-sm mb-2" style={{ color: "var(--text)" }}>
            Log your first trade.
          </p>
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            The habit that matters: record the <b>stop-loss</b> at entry (so every trade gets an R-multiple), the <b>setup</b>, and
            after exit one honest line on what went right or wrong. After 20–30 trades the numbers here will show where your money
            is made and lost. Use <b>Export → AI review pack</b> to get coaching on it.
          </p>
        </Panel>
      )}

      {trades?.some((t) => !t.draft) && (
        <div className="flex flex-col gap-6">
          {/* Headline numbers */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
            <Metric label="Net P&L" value={inr(stats.netPnl)} color={tone(stats.netPnl)} sub={stats.fees ? `after ${inr(stats.fees)} charges` : null} />
            <Metric label="Win rate" value={stats.winRate != null ? `${stats.winRate}%` : "—"} sub={`${stats.closed ?? 0} closed`} />
            <Metric label="Expectancy" value={inr(stats.expectancy)} color={tone(stats.expectancy)} sub="per trade" />
            <Metric label="Avg R" value={stats.avgR != null ? `${stats.avgR}R` : "—"} color={tone(stats.avgR)} sub={stats.rCoverage != null ? `${stats.rCoverage}% have a stop` : null} />
            <Metric label="Avg win / loss" value={`${inr(stats.avgWin)} / ${inr(stats.avgLoss)}`} sub={stats.payoffRatio != null ? `payoff ${stats.payoffRatio}×` : null} />
            <Metric label="Profit factor" value={stats.profitFactor ?? "—"} color={stats.profitFactor >= 1 ? "var(--gain)" : stats.profitFactor != null ? "var(--loss)" : undefined} />
            <Metric label="Max drawdown" value={inr(stats.maxDrawdown)} color="var(--loss)" sub={stats.maxLossStreak ? `worst streak ${stats.maxLossStreak} losses` : null} />
            <Metric label="Open trades" value={stats.open ?? 0} sub={unrealised ? `${unrealised >= 0 ? "+" : "−"}${inr(Math.abs(unrealised)).slice(1)} unrealised` : null} color={tone(unrealised)} />
          </div>

          {notes.length > 0 && (
            <div>
              <SectionTitle>What the numbers say</SectionTitle>
              <Panel>
                <ul className="flex flex-col gap-1.5">
                  {notes.map((n, i) => (
                    <li key={i} className="text-xs flex gap-2">
                      <span style={{ color: n.tone === "good" ? "var(--gain)" : n.tone === "bad" ? "var(--loss)" : "var(--text-faint)" }}>
                        {n.tone === "good" ? "▲" : n.tone === "bad" ? "▼" : "•"}
                      </span>
                      <span style={{ color: "var(--text-muted)" }}>{n.text}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          )}

          {stats.curve?.length > 1 && (
            <div>
              <SectionTitle meta="Cumulative net P&L, by exit date">Equity curve</SectionTitle>
              <Panel>
                <EquityCurve curve={stats.curve} />
              </Panel>
            </div>
          )}

          {stats.closed > 0 && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Panel>
                <GroupTable title="By setup" rows={stats.bySetup} empty="Tag a setup on each trade." />
              </Panel>
              <Panel>
                <GroupTable title="Mistakes — what they cost" rows={stats.byMistake} empty="No mistakes tagged yet." />
              </Panel>
              <Panel>
                <GroupTable title="Plan discipline" rows={[...(stats.byPlan ?? []), ...(stats.cleanVsMistake ?? [])]} empty="Mark whether you followed your plan." />
              </Panel>
              <Panel>
                <GroupTable title="By emotion" rows={stats.byEmotion} empty="Tag how you felt." />
              </Panel>
              <Panel>
                <GroupTable title="By side & segment" rows={[...(stats.bySide ?? []), ...(stats.bySegment ?? [])]} empty="—" />
              </Panel>
              <Panel>
                <GroupTable title="By month" rows={[...(stats.monthly ?? [])].reverse()} empty="—" />
              </Panel>
            </div>
          )}

          {/* Trades */}
          <div>
            <SectionTitle
              meta={
                <span className="inline-flex gap-1">
                  {["all", "open", "closed"].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatusFilter(s)}
                      className="px-2 py-0.5 rounded text-[11px]"
                      style={{ background: statusFilter === s ? "var(--surface-3)" : "transparent", color: statusFilter === s ? "var(--text)" : "var(--text-muted)" }}
                    >
                      {s[0].toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </span>
              }
            >
              Trades
            </SectionTitle>
            <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <TableFrame name="journal">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="text-left border-b" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
                      {["Entry", "Symbol", "Side", "Qty", "Entry ₹", "Exit ₹", "Net P&L", "R", "Days", "Setup", "Review"].map((h) => (
                        <th key={h} className={`py-2 px-2 font-medium ${["Qty", "Entry ₹", "Exit ₹", "Net P&L", "R", "Days"].includes(h) ? "text-right" : ""} ${h === "Entry" ? "pl-4" : ""}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {listed.map((t) => (
                      <tr key={t.id} className="border-b last:border-b-0 cursor-pointer hover:bg-white/[0.02]" style={{ borderColor: "var(--border)" }} onClick={() => setEditing(t)}>
                        <td className="py-2 pl-4 pr-2 font-mono whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                          {t.entryDate}
                        </td>
                        <td className="py-2 px-2">
                          <SymbolLink symbol={t.symbol} className="text-xs" showEvents={false} />
                          <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                            {t.segment}
                          </span>
                        </td>
                        <td className="py-2 px-2" style={{ color: t.side === "Long" ? "var(--gain)" : "var(--loss)" }}>
                          {t.side}
                        </td>
                        <td className="py-2 px-2 text-right font-mono">{t.quantity}</td>
                        <td className="py-2 px-2 text-right font-mono">{t.entryPrice}</td>
                        <td className="py-2 px-2 text-right font-mono" style={{ color: t.status === "Open" ? "var(--text-faint)" : undefined }}>
                          {t.exitPrice ?? (t.markPrice != null ? `${t.markPrice} now` : "open")}
                        </td>
                        <td className="py-2 px-2 text-right font-mono" style={{ color: tone(t.netPnl) }}>
                          {inr(t.netPnl)}
                          {t.status === "Open" && t.netPnl != null && <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>unrealised</span>}
                        </td>
                        <td className="py-2 px-2 text-right font-mono" style={{ color: tone(t.rMultiple) }}>
                          {t.rMultiple == null ? "—" : `${t.rMultiple}R`}
                        </td>
                        <td className="py-2 px-2 text-right font-mono" style={{ color: "var(--text-muted)" }}>
                          {t.holdingDays ?? "—"}
                        </td>
                        <td className="py-2 px-2" style={{ color: "var(--text-muted)" }}>
                          {t.setup || "—"}
                        </td>
                        <td className="py-2 px-2">
                          <span className="flex flex-wrap gap-1">
                            {t.followedPlan === false && <span className="text-[10px] px-1 rounded" style={{ background: "var(--loss-dim)", color: "var(--loss)" }}>broke plan</span>}
                            {(t.mistakes ?? []).slice(0, 2).map((m) => (
                              <span key={m} className="text-[10px] px-1 rounded" style={{ background: "var(--surface-2)", color: "var(--loss)" }}>
                                {m}
                              </span>
                            ))}
                            {t.lessons && <span className="text-[10px]" title={t.lessons} style={{ color: "var(--accent)" }}>✎ lesson</span>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            </div>
          </div>
        </div>
      )}

      {editing && <TradeForm initial={editing.id ? editing : null} onSave={saveTrade} onDelete={deleteTrade} onClose={() => setEditing(null)} />}
    </div>
  );
}
