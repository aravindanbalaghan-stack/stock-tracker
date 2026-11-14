"use client";

import { useEffect, useMemo, useState } from "react";
import { ScreenHeader, SectionTitle, Panel, ErrorState, LoadingState } from "@/components/ui/Chrome";
import TableFrame from "@/components/ui/TableFrame";
import InfoNote from "@/components/InfoNote";
import SymbolLink from "@/components/SymbolLink";
import WatchlistAddButton from "@/components/WatchlistAddButton";
import { HorizonCards, SignalsTable } from "@/components/TrackRecord";
import { usePersistentState } from "@/lib/usePersistentState";
import { SECTOR_LIST } from "@/lib/sectors";
import {
  FIELDS,
  FIELD_GROUPS,
  FIELD_BY_ID,
  OPS,
  UNIVERSES,
  PRESETS,
  BLANK_CONDITION,
  describeCondition,
} from "@/lib/customFields";
import { fmt, fmtVolume, fmtTurnover, fmtCap, fmtSignedPct, toneOf } from "@/lib/format";

const DEFAULT_DEF = { ...PRESETS[0].def, sectors: [], themes: [], mcapMin: "", mcapMax: "" };

const input =
  "rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm bg-[var(--surface-2)] border-[var(--border)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]";

function FieldSelect({ value, onChange, label }) {
  return (
    <select className={input} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {FIELD_GROUPS.map((g) => (
        <optgroup key={g} label={g}>
          {FIELDS.filter((f) => f.group === g).map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function unitSuffix(fieldId) {
  const u = FIELD_BY_ID[fieldId]?.unit;
  return u === "%" ? "%" : u === "×" ? "×" : u === "Cr" ? "₹ Cr" : u === "₹" ? "₹" : u === "shares" ? "shares" : "";
}

function ConditionRow({ c, onChange, onRemove, index }) {
  const isStage = c.left === "stage";
  const setRight = (patch) => onChange({ ...c, right: { ...c.right, ...patch } });
  return (
    <div className="flex items-center gap-2 flex-wrap py-2 border-t first:border-t-0" style={{ borderColor: "var(--border)" }}>
      <span className="w-5 text-xs font-mono text-right" style={{ color: "var(--text-faint)" }}>
        {index + 1}
      </span>
      <FieldSelect
        value={c.left}
        label="What to test"
        onChange={(left) =>
          onChange({
            ...c,
            left,
            ...(left === "stage" ? { op: "eq", right: { kind: "value", value: 2 } } : {}),
          })
        }
      />
      <select className={input} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value })} aria-label="Comparison">
        {OPS.filter((o) => (isStage ? ["eq", "gt", "lt"].includes(o.id) : o.id !== "eq")).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {!isStage && (
        <select
          className={input}
          value={c.right.kind}
          onChange={(e) =>
            onChange({
              ...c,
              right: e.target.value === "field" ? { kind: "field", field: "sma50", mult: 1 } : { kind: "value", value: 0 },
            })
          }
          aria-label="Compare with"
        >
          <option value="value">a number</option>
          <option value="field">another measure</option>
        </select>
      )}
      {isStage ? (
        <select className={input} value={c.right.value} onChange={(e) => setRight({ value: Number(e.target.value) })} aria-label="Stage">
          {[1, 2, 3, 4].map((s) => (
            <option key={s} value={s}>
              Stage {s}
            </option>
          ))}
        </select>
      ) : c.right.kind === "field" ? (
        <>
          <input
            type="number"
            step="0.05"
            min="0.01"
            className={`${input} w-20 font-mono`}
            value={c.right.mult}
            onChange={(e) => setRight({ mult: e.target.value })}
            aria-label="Multiplier"
            title="Multiplier, e.g. 1.5 × average volume"
          />
          <span className="text-xs" style={{ color: "var(--text-faint)" }}>×</span>
          <FieldSelect value={c.right.field} onChange={(field) => setRight({ field })} label="Compare against" />
        </>
      ) : (
        <span className="inline-flex items-center gap-1">
          <input
            type="number"
            step="any"
            className={`${input} w-28 font-mono`}
            value={c.right.value}
            onChange={(e) => setRight({ value: e.target.value })}
            aria-label="Value"
          />
          <span className="text-xs" style={{ color: "var(--text-faint)" }}>{unitSuffix(c.left)}</span>
        </span>
      )}
      <button type="button" onClick={onRemove} className="ml-auto text-xs px-2 py-1 rounded hover:bg-[var(--surface-3)]" style={{ color: "var(--text-faint)" }} aria-label={`Remove condition ${index + 1}`}>
        Remove
      </button>
    </div>
  );
}

function valueCell(fieldId, v) {
  const u = FIELD_BY_ID[fieldId]?.unit;
  if (v == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  if (fieldId === "chg1" || fieldId.startsWith("ret") || fieldId.startsWith("from")) return <span style={{ color: toneOf(v) }}>{fmtSignedPct(v, 1)}</span>;
  if (u === "%") return `${fmt(v, 1)}%`;
  if (u === "×") return `${fmt(v, 2)}×`;
  if (u === "Cr") return fmtTurnover(v);
  if (u === "shares") return fmtVolume(v);
  if (u === "stage") return `Stage ${v}`;
  return fmt(v, u === "" ? 1 : 2);
}

export default function CustomScreenerTab({ onAddToWatchlist, watchlistSymbols }) {
  const [def, setDef] = usePersistentState("custom.draft", DEFAULT_DEF);
  const [name, setName] = usePersistentState("custom.name", PRESETS[0].name);
  const [savedId, setSavedId] = usePersistentState("custom.savedId", null);
  const [saved, setSaved] = useState([]);
  const [themes, setThemes] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const [run, setRun] = useState({ status: "idle", data: null, error: null });
  const [saveMsg, setSaveMsg] = useState(null);

  useEffect(() => {
    let live = true;
    fetch("/api/custom-screens")
      .then((r) => r.json())
      .then((j) => live && setSaved(j.screens ?? []))
      .catch(() => {});
    fetch("/api/stock-master?themes=1")
      .then((r) => r.json())
      .then((j) => live && setThemes((j.themes ?? []).map((t) => t.name ?? t)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const conditions = useMemo(() => def.conditions ?? [], [def]);
  const summary = useMemo(() => conditions.map(describeCondition).join(def.logic === "any" ? "  OR  " : "  AND  "), [conditions, def.logic]);

  async function execute(d = def) {
    setRun({ status: "running", data: null, error: null });
    try {
      const r = await fetch("/api/custom-screener", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition: d }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Couldn't run this screen");
      setRun({ status: "done", data: j, error: null });
    } catch (e) {
      setRun({ status: "error", data: null, error: e.message });
    }
  }

  function load(nextDef, nextName, id = null) {
    const d = { sectors: [], themes: [], mcapMin: "", mcapMax: "", ...nextDef };
    setDef(d);
    setName(nextName);
    setSavedId(id);
    execute(d);
  }

  async function save(asNew = false) {
    setSaveMsg(null);
    try {
      const r = await fetch("/api/custom-screens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: asNew ? null : savedId, name, def }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Couldn't save");
      setSaved(j.screens ?? []);
      setSavedId(j.saved?.id ?? null);
      setSaveMsg({ ok: true, text: "Saved to your account" });
    } catch (e) {
      setSaveMsg({ ok: false, text: e.message });
    }
  }

  async function remove(id) {
    const r = await fetch(`/api/custom-screens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setSaved(j.screens ?? []);
      if (id === savedId) setSavedId(null);
    }
  }

  const setCond = (k, c) => setDef({ ...def, conditions: conditions.map((x, i) => (i === k ? c : x)) });
  const toggleIn = (key, v) => {
    const cur = def[key] ?? [];
    setDef({ ...def, [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };

  const data = run.data;
  const extraCols = (data?.usedFields ?? []).filter((f) => !["close", "chg1", "volRatio", "deliv", "turnover", "stage"].includes(f.id));
  const chip = "px-2.5 py-1 rounded-full text-xs border transition-colors";

  return (
    <div>
      <ScreenHeader title="Build your own screener" meta="Pick conditions, see today's matches and how the same rules did over the past 6 months">
        <InfoNote label="How it works">
          Conditions are tested on split-adjusted NSE end-of-day data for every session in the past ~6 months, so each screen
          comes with a track record: every time a stock newly passed the rules, what it did 5, 10 and 20 sessions later,
          compared with the market. &ldquo;Prior&rdquo; highs and averages exclude the day being tested, and the weekly stage on a
          mid-week day is last week&apos;s, so the backtest never peeks ahead. Market cap, sector and theme filters use today&apos;s
          values. No costs or stops are included.
        </InfoNote>
      </ScreenHeader>

      <div className="space-y-4">
        {(saved.length > 0 || PRESETS.length > 0) && (
          <div className="space-y-2">
            {saved.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] uppercase tracking-wider w-20" style={{ color: "var(--text-faint)" }}>
                  Your screens
                </span>
                {saved.map((s) => (
                  <span key={s.id} className="inline-flex items-center rounded-full border" style={{ borderColor: s.id === savedId ? "var(--accent)" : "var(--border)" }}>
                    <button type="button" className="pl-2.5 pr-1.5 py-1 text-xs" style={{ color: "var(--text)" }} onClick={() => load(s.def, s.name, s.id)}>
                      {s.name}
                    </button>
                    <button type="button" className="pr-2 text-xs" style={{ color: "var(--text-faint)" }} onClick={() => remove(s.id)} aria-label={`Delete ${s.name}`} title="Delete">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider w-20" style={{ color: "var(--text-faint)" }}>
                Start from
              </span>
              {PRESETS.map((p) => (
                <button key={p.name} type="button" className={chip} style={{ borderColor: "var(--border)", color: "var(--text-muted)" }} onClick={() => load(p.def, p.name)}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <Panel>
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <input className={`${input} flex-1 min-w-[12rem]`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this screen" aria-label="Screen name" />
            <select className={input} value={def.universe} onChange={(e) => setDef({ ...def, universe: e.target.value })} aria-label="Universe">
              {UNIVERSES.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
            <select className={input} value={def.logic} onChange={(e) => setDef({ ...def, logic: e.target.value })} aria-label="Match">
              <option value="all">Match all conditions</option>
              <option value="any">Match any condition</option>
            </select>
          </div>

          <div>
            {conditions.map((c, k) => (
              <ConditionRow key={k} index={k} c={c} onChange={(n) => setCond(k, n)} onRemove={() => setDef({ ...def, conditions: conditions.filter((_, i) => i !== k) })} />
            ))}
          </div>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <button
              type="button"
              className="text-xs px-2.5 py-1.5 rounded-[var(--radius-sm)] border"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
              onClick={() => setDef({ ...def, conditions: [...conditions, { ...BLANK_CONDITION, right: { ...BLANK_CONDITION.right } }] })}
              disabled={conditions.length >= 12}
            >
              + Add condition
            </button>
            <button type="button" className="text-xs" style={{ color: "var(--text-muted)" }} onClick={() => setShowFilters((v) => !v)}>
              {showFilters ? "Hide" : "More"} filters (sector, theme, market cap)
              {(def.sectors?.length || def.themes?.length || def.mcapMin || def.mcapMax) ? " · on" : ""}
            </button>
          </div>

          {showFilters && (
            <div className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs w-24" style={{ color: "var(--text-muted)" }}>Market cap ₹ Cr</span>
                <input type="number" className={`${input} w-28 font-mono`} placeholder="min" value={def.mcapMin ?? ""} onChange={(e) => setDef({ ...def, mcapMin: e.target.value })} aria-label="Minimum market cap" />
                <span style={{ color: "var(--text-faint)" }}>–</span>
                <input type="number" className={`${input} w-28 font-mono`} placeholder="max" value={def.mcapMax ?? ""} onChange={(e) => setDef({ ...def, mcapMax: e.target.value })} aria-label="Maximum market cap" />
              </div>
              <div className="flex items-start gap-2 flex-wrap">
                <span className="text-xs w-24 pt-1" style={{ color: "var(--text-muted)" }}>Sectors</span>
                <div className="flex gap-1.5 flex-wrap flex-1">
                  {SECTOR_LIST.map((s) => {
                    const on = def.sectors?.includes(s.key);
                    return (
                      <button key={s.key} type="button" className={chip} style={{ borderColor: on ? "var(--accent)" : "var(--border)", color: on ? "var(--text)" : "var(--text-muted)" }} onClick={() => toggleIn("sectors", s.key)}>
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              {themes.length > 0 && (
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="text-xs w-24 pt-1" style={{ color: "var(--text-muted)" }}>Themes</span>
                  <div className="flex gap-1.5 flex-wrap flex-1">
                    {themes.map((t) => {
                      const on = def.themes?.includes(t);
                      return (
                        <button key={t} type="button" className={chip} style={{ borderColor: on ? "var(--accent)" : "var(--border)", color: on ? "var(--text)" : "var(--text-muted)" }} onClick={() => toggleIn("themes", t)}>
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 pt-3 border-t flex items-center gap-3 flex-wrap" style={{ borderColor: "var(--border)" }}>
            <p className="text-xs flex-1 min-w-[16rem] font-mono" style={{ color: "var(--text-muted)" }}>
              {summary || "No conditions yet"}
            </p>
            {saveMsg && (
              <span className="text-xs" style={{ color: saveMsg.ok ? "var(--gain)" : "var(--loss)" }}>
                {saveMsg.text}
              </span>
            )}
            <button type="button" className="text-xs px-3 py-1.5 rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }} onClick={() => save(false)}>
              {savedId ? "Save" : "Save screen"}
            </button>
            {savedId && (
              <button type="button" className="text-xs px-3 py-1.5 rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }} onClick={() => save(true)}>
                Save as new
              </button>
            )}
            <button
              type="button"
              className="text-sm font-medium px-4 py-1.5 rounded-[var(--radius-sm)]"
              style={{ background: "var(--accent)", color: "#1a1406" }}
              onClick={() => execute()}
              disabled={run.status === "running" || !conditions.length}
            >
              {run.status === "running" ? "Running…" : "Run screen"}
            </button>
          </div>
        </Panel>

        {run.status === "running" && <LoadingState>Testing every stock on every session of the past 6 months…</LoadingState>}
        {run.error && <ErrorState>{run.error}</ErrorState>}
        {data?.note && (
          <div className="rounded-[var(--radius)] border px-4 py-3 text-sm" style={{ borderColor: "var(--accent-dim)", background: "var(--accent-wash)", color: "var(--text)" }}>
            {data.note}
          </div>
        )}

        {data && (
          <>
            <div>
              <SectionTitle
                meta={
                  data.backtest
                    ? `${data.backtest.from} → ${data.backtest.to} · ${data.backtest.totalSignals} new entries · about ${fmt(data.backtest.avgPerDay, 1)} stocks pass on a typical day`
                    : null
                }
              >
                Track record of these rules
              </SectionTitle>
              {data.backtest && <HorizonCards stats={data.backtest.fresh} />}
              {data.backtest?.everyDay?.[10]?.n > 0 && (
                <p className="mt-2 text-xs" style={{ color: "var(--text-faint)" }}>
                  Counting every day a stock passed (not just its first day): 10-day win rate {fmt(data.backtest.everyDay[10].winRate, 0)}%, average{" "}
                  {fmtSignedPct(data.backtest.everyDay[10].avg)} across {data.backtest.everyDay[10].n} stock-days.
                </p>
              )}
            </div>

            <div>
              <SectionTitle meta={`${data.rows.length} of ${data.universeSize} stocks · ${data.asOf}`}>Today&apos;s matches</SectionTitle>
              {data.rows.length === 0 ? (
                <Panel>
                  <p className="text-sm py-4 text-center" style={{ color: "var(--text-muted)" }}>
                    No stock passes every condition today. Check the track record above for how often it fires.
                  </p>
                </Panel>
              ) : (
                <Panel flush>
                  <TableFrame name="custom-screener" exportName={name || "custom-screen"}>
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                          <th className="py-2 px-3">Symbol</th>
                          <th className="py-2 px-2 text-right">Close</th>
                          <th className="py-2 px-2 text-right">Chg</th>
                          <th className="py-2 px-2 text-right">Vol ×20d</th>
                          <th className="py-2 px-2 text-right">Deliv %</th>
                          <th className="py-2 px-2 text-right">Turnover</th>
                          <th className="py-2 px-2 text-right">Mkt cap</th>
                          <th className="py-2 px-2 text-right">Stage</th>
                          {extraCols.map((f) => (
                            <th key={f.id} className="py-2 px-2 text-right">{f.label}</th>
                          ))}
                          <th className="py-2 px-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {data.rows.map((r) => (
                          <tr key={r.symbol} className="border-t" style={{ borderColor: "var(--border)" }}>
                            <td className="py-1.5 px-3">
                              <SymbolLink symbol={r.symbol} className="text-sm" />
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono text-xs">{fmt(r.close)}</td>
                            <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: toneOf(r.chg1) }}>{fmtSignedPct(r.chg1, 1)}</td>
                            <td className="py-1.5 px-2 text-right font-mono text-xs">{r.volRatio != null ? `${fmt(r.volRatio, 2)}×` : "—"}</td>
                            <td className="py-1.5 px-2 text-right font-mono text-xs">{r.deliv != null ? `${fmt(r.deliv, 1)}%` : "—"}</td>
                            <td className="py-1.5 px-2 text-right font-mono text-xs">{fmtTurnover(r.turnover)}</td>
                            <td className="py-1.5 px-2 text-right font-mono text-xs">{fmtCap(r.marketCapCr)}</td>
                            <td className="py-1.5 px-2 text-right font-mono text-xs">{r.stage != null ? r.stage : "—"}</td>
                            {extraCols.map((f) => (
                              <td key={f.id} className="py-1.5 px-2 text-right font-mono text-xs">{valueCell(f.id, r[f.id])}</td>
                            ))}
                            <td className="py-1.5 px-3 text-right">
                              <WatchlistAddButton symbol={r.symbol} inWatchlist={watchlistSymbols?.includes(r.symbol)} onAdd={onAddToWatchlist} source={`Custom: ${name}`} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableFrame>
                </Panel>
              )}
            </div>

            {data.backtest?.signals?.length > 0 && (
              <div>
                <SectionTitle meta={`newest first · ${data.backtest.open} still open`}>Every new entry in the backtest</SectionTitle>
                <Panel flush>
                  <SignalsTable name="custom-screener-signals" signals={data.backtest.signals} />
                </Panel>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
