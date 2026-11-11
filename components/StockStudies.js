"use client";

// Analysis → Stock studies: technical analysis of individual stocks, as
// many as you like per day. Each study walks the usual top-down routine —
// timeframes, structure, levels, indicators, volume, verdict, plan — with
// Panel's own readings one click away, a quality checklist, and a grade
// once the market has moved (lib/analysis.js → gradeStudy).

import { useMemo, useState } from "react";
import SymbolLink from "@/components/SymbolLink";
import { Panel, SectionTitle } from "@/components/ui/Chrome";

const TIMEFRAMES = ["Monthly", "Weekly", "Daily", "Intraday"];
const TRENDS = ["Up", "Sideways", "Down"];
const VERDICTS = ["Bullish", "Bearish", "Neutral", "Wait"];
const PATTERNS = [
  "Base breakout", "Trendline breakout", "Breakout retest", "Pullback to MA", "Cup & handle", "VCP", "Flag", "Pennant",
  "Ascending triangle", "Symmetrical triangle", "Descending triangle", "Range / rectangle", "Double bottom", "Inverse H&S",
  "Rounding bottom", "Double top", "Head & shoulders", "Rising wedge", "Falling wedge", "Gap up", "Breakdown",
];
const CANDLES = ["Hammer", "Bullish engulfing", "Morning star", "Inside bar", "NR7", "Doji", "Marubozu", "Shooting star", "Bearish engulfing", "Evening star", "Hanging man"];
const TONE = { Up: "var(--gain)", Down: "var(--loss)", Sideways: "var(--accent)", Bullish: "var(--gain)", Bearish: "var(--loss)", Neutral: "var(--accent)", Wait: "var(--text-muted)" };
const field = { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" };
const inputCls = "rounded px-2 py-1.5 text-sm outline-none border w-full";
const signed = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n}%`);

// What each plan status means — shown under the status.
const PLAN_EXPLAIN = {
  Waiting: "The plan hasn't started: price hasn't reached your trigger yet (or there's been no trading session since the study). It's checked again every time you open Analysis.",
  "Not triggered": "Price never reached your trigger within the horizon, so the plan never started.",
  Open: "Triggered and still running — neither stop nor target hit yet.",
  "Target hit": "Triggered, then reached the target before the stop.",
  "Stop hit": "Triggered, then hit the stop first (if both happened on the same day, the stop is assumed first).",
  "Time exit": "Triggered, but neither stop nor target was hit within the horizon — closed at the last session's price.",
};

export function blankStudy(symbol) {
  return {
    id: crypto.randomUUID(),
    symbol: symbol.trim().toUpperCase(),
    timeframes: {},
    stage: null,
    patterns: [],
    candle: "",
    supports: [],
    resistances: [],
    indicators: "",
    volume: "",
    relativeStrength: "",
    verdict: "",
    conviction: 3,
    horizonDays: 10,
    plan: { direction: "Long", entry: "", stop: "", target: "" },
    checklist: {},
    notes: "",
    chartUrl: "",
    auto: null,
    createdAt: new Date().toISOString(),
  };
}

function L({ label, children, className = "" }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Seg({ options, value, onChange, small }) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(value === o ? "" : o)}
          className={`flex-1 rounded border ${small ? "text-[11px] py-0.5 px-1.5" : "text-xs py-1.5"}`}
          style={value === o ? { borderColor: TONE[o] ?? "var(--accent)", color: TONE[o] ?? "var(--accent)", background: "var(--surface-3)" } : { borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function AutoReadings({ a, onUse, loading, onLoad, symbol }) {
  if (!a) {
    return (
      <button type="button" onClick={onLoad} disabled={loading} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
        {loading ? `Reading ${symbol}…` : "Auto-fill Panel's readings"}
      </button>
    );
  }
  if (!a.available) return <p className="text-xs" style={{ color: "var(--text-faint)" }}>Not enough price history for {symbol}.</p>;
  const yn = (b) => (b == null ? "—" : b ? "above" : "below");
  return (
    <div className="rounded-[var(--radius-sm)] p-3 text-xs" style={{ background: "var(--surface-2)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <span style={{ color: "var(--text)" }}>
          Panel&apos;s readings · {a.asOf} · close ₹{a.close}
        </span>
        <span className="flex gap-2">
          <button type="button" onClick={onLoad} disabled={loading} className="text-[11px] hover:underline" style={{ color: "var(--text-faint)" }}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" onClick={onUse} className="text-[11px] px-2 py-0.5 rounded font-medium" style={{ background: "var(--accent)", color: "var(--bg)" }} title="Fill empty fields of the study from these readings">
            Use these
          </button>
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1" style={{ color: "var(--text-muted)" }}>
        <span>
          Trend M/W/D:{" "}
          {["Monthly", "Weekly", "Daily"].map((t, i) => (
            <span key={t} style={{ color: TONE[a.trends[t]] ?? "var(--text-faint)" }}>
              {i ? " / " : ""}
              {a.trends[t] || "—"}
            </span>
          ))}
        </span>
        <span>Weinstein stage: <b style={{ color: "var(--text)" }}>{a.stage ?? "—"}</b></span>
        <span>20 / 50 / 200 DMA: {yn(a.ma.above20)} / {yn(a.ma.above50)} / {yn(a.ma.above200)}</span>
        <span>RSI d / w: <b style={{ color: "var(--text)" }}>{a.rsiDaily ?? "—"}</b> / {a.rsiWeekly ?? "—"}</span>
        <span>MACD: {a.macd}</span>
        <span>From 52w high / low: {signed(a.fromHigh52Pct)} / {signed(a.fromLow52Pct)}</span>
        <span>ATR: {a.atrPct ?? "—"}% · vol {a.volVs20 ?? "—"}× 20d</span>
        <span>Delivery: {a.deliveryPct ?? "—"}% (20d {a.delivery20Pct ?? "—"}%)</span>
        <span>RS vs NIFTY (3m): <b style={{ color: a.rs3mVsNifty >= 0 ? "var(--gain)" : "var(--loss)" }}>{signed(a.rs3mVsNifty)}</b></span>
        <span>Swing supports: {a.supports.join(", ") || "—"}</span>
        <span>Swing resistances: {a.resistances.join(", ") || "—"}</span>
      </div>
      {a.screens?.length > 0 && (
        <p className="mt-1.5" style={{ color: "var(--text-muted)" }}>
          On Panel&apos;s screens: <span style={{ color: "var(--gain)" }}>{a.screens.join(" · ")}</span>
        </p>
      )}
    </div>
  );
}

function qualityChecks(st, events, date) {
  const p = st.plan ?? {};
  const entry = Number(p.entry) || st.auto?.close || null;
  const risk = entry && p.stop !== "" && p.stop != null ? Math.abs(entry - Number(p.stop)) : null;
  const reward = entry && p.target !== "" && p.target != null ? Math.abs(Number(p.target) - entry) : null;
  const rr = risk && reward ? reward / risk : null;
  const dir = st.verdict === "Bearish" ? "Down" : st.verdict === "Bullish" ? "Up" : null;
  const higher = st.timeframes?.Weekly?.trend || st.auto?.trends?.Weekly;
  const horizonEnd = new Date(`${date}T00:00:00Z`);
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + Math.ceil((st.horizonDays ?? 10) * 1.45));
  const evs = (events?.[st.symbol] ?? []).filter((e) => e.date >= date && e.date <= horizonEnd.toISOString().slice(0, 10));
  return [
    { id: "Higher timeframe agrees", hint: dir && higher ? (higher === dir ? "Weekly trend agrees" : `Weekly trend is ${higher}`) : null, auto: dir && higher ? higher === dir : null },
    { id: "Volume / delivery confirms", hint: st.auto?.volVs20 != null ? `${st.auto.volVs20}× volume, ${st.auto.deliveryPct ?? "—"}% delivery` : null, auto: null },
    { id: "Clear stop level", hint: p.stop ? `Stop ${p.stop}` : "No stop set", auto: p.stop !== "" && p.stop != null },
    { id: "Reward at least 2× risk", hint: rr != null ? `R:R ${rr.toFixed(1)}` : "Set entry, stop and target", auto: rr != null ? rr >= 2 : null },
    { id: "No result / event inside the horizon", hint: evs.length ? `${evs[0].type} on ${evs[0].date}` : "None announced", auto: evs.length === 0 },
    { id: "Relative strength supports the view", hint: st.auto?.rs3mVsNifty != null ? `RS ${signed(st.auto.rs3mVsNifty)} vs NIFTY` : null, auto: st.auto?.rs3mVsNifty != null && dir ? (dir === "Up" ? st.auto.rs3mVsNifty > 0 : st.auto.rs3mVsNifty < 0) : null },
  ];
}

function StudyEditor({ st, date, update, remove, history, events, onAddIdea, onLogTrade, onAddToWatchlist, watchlistSymbols }) {
  const [loading, setLoading] = useState(false);
  const set = (k, v) => update({ ...st, [k]: v });
  const setPlan = (k, v) => update({ ...st, plan: { ...st.plan, [k]: v } });
  const setTf = (tf, k, v) => update({ ...st, timeframes: { ...st.timeframes, [tf]: { ...(st.timeframes?.[tf] ?? {}), [k]: v } } });

  async function loadAuto() {
    setLoading(true);
    try {
      const res = await fetch(`/api/analysis?technicals=${encodeURIComponent(st.symbol)}&date=${date}`);
      const j = await res.json();
      if (res.ok) update({ ...st, auto: j });
    } finally {
      setLoading(false);
    }
  }

  function useAuto() {
    const a = st.auto;
    if (!a?.available) return;
    const tfs = { ...st.timeframes };
    for (const t of ["Monthly", "Weekly", "Daily"]) if (!tfs[t]?.trend && a.trends[t]) tfs[t] = { ...(tfs[t] ?? {}), trend: a.trends[t] };
    const ma = `${a.ma.above20 ? "above" : "below"} 20 DMA, ${a.ma.above50 ? "above" : "below"} 50 DMA, ${a.ma.above200 ? "above" : "below"} 200 DMA`;
    update({
      ...st,
      timeframes: tfs,
      stage: st.stage ?? a.stage,
      supports: st.supports?.length ? st.supports : a.supports,
      resistances: st.resistances?.length ? st.resistances : a.resistances,
      indicators: st.indicators || `RSI ${a.rsiDaily} daily / ${a.rsiWeekly} weekly · MACD ${a.macd.toLowerCase()} · ${ma} · ATR ${a.atrPct}%`,
      volume: st.volume || `Volume ${a.volVs20}× 20-day average · delivery ${a.deliveryPct ?? "—"}% (20-day ${a.delivery20Pct ?? "—"}%)`,
      relativeStrength: st.relativeStrength || `${signed(a.rs3mVsNifty)} vs NIFTY over 3 months · ${signed(a.fromHigh52Pct)} from 52-week high`,
    });
  }

  const checks = qualityChecks(st, events, date);
  const g = st.verdictGrade;
  const plan = st.plan ?? {};
  const prev = history.filter((h) => h.symbol === st.symbol && h.date < date).slice(0, 5);
  const listVal = (arr) => (Array.isArray(arr) ? arr.join(", ") : arr ?? "");
  const listSet = (k) => (e) => set(k, e.target.value.split(/[,;\s]+/).filter(Boolean));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SymbolLink symbol={st.symbol} className="text-lg" />
          {st.verdict && (
            <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ color: TONE[st.verdict], background: "var(--surface-2)" }}>
              {st.verdict}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {st.chartUrl && (
            <a href={st.chartUrl} target="_blank" rel="noreferrer" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
              Open chart ↗
            </a>
          )}
          <button type="button" onClick={remove} className="text-xs px-2 py-1 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
            Remove study
          </button>
        </div>
      </div>

      {(g || st.planOutcome) && (
        <div className="rounded-[var(--radius-sm)] px-3 py-2 text-xs flex flex-col gap-1" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
          {g && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>Since the study (₹{g.priceAtStudy}): <b style={{ color: g.moveSince >= 0 ? "var(--gain)" : "var(--loss)" }}>{signed(g.moveSince)}</b></span>
              <span>5 / 10 / 20 sessions: {signed(g.move5)} / {signed(g.move10)} / {signed(g.move20)}</span>
              {g.correct != null ? (
                <span style={{ color: g.correct ? "var(--gain)" : "var(--loss)" }}>{g.correct ? "✓ Verdict right" : "✗ Verdict wrong"} at {st.horizonDays} sessions</span>
              ) : (
                st.verdict && st.verdict !== "Wait" && <span>Verdict graded after {st.horizonDays} sessions</span>
              )}
            </div>
          )}
          {st.planOutcome && (
            <div>
              <span style={{ color: "var(--text)" }}>Plan: {st.planOutcome.status}</span>
              {st.planOutcome.returnPct != null ? ` ${signed(st.planOutcome.returnPct)}` : ""}
              <span className="block text-[11px]" style={{ color: "var(--text-faint)" }}>
                {PLAN_EXPLAIN[st.planOutcome.status]}
                {st.planOutcome.note ? ` ${st.planOutcome.note}.` : ""}
              </span>
            </div>
          )}
        </div>
      )}

      <AutoReadings a={st.auto} onLoad={loadAuto} onUse={useAuto} loading={loading} symbol={st.symbol} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>1 · TOP-DOWN TREND</p>
          {TIMEFRAMES.map((tf) => (
            <div key={tf} className="grid grid-cols-[5rem_1fr] items-center gap-2">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{tf}</span>
              <div className="flex flex-col gap-1">
                <Seg options={TRENDS} value={st.timeframes?.[tf]?.trend ?? ""} onChange={(v) => setTf(tf, "trend", v)} small />
                <input value={st.timeframes?.[tf]?.note ?? ""} onChange={(e) => setTf(tf, "note", e.target.value)} placeholder={`${tf} note (structure, key observation)`} className={inputCls} style={{ ...field, fontSize: 12, padding: "3px 8px" }} />
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>2 · STRUCTURE & LEVELS</p>
          <L label="Weinstein stage">
            <Seg options={["1", "2", "3", "4"]} value={st.stage ? String(st.stage) : ""} onChange={(v) => set("stage", v ? Number(v) : null)} small />
          </L>
          <L label="Patterns">
            <div className="flex flex-wrap gap-1">
              {PATTERNS.map((p) => {
                const on = st.patterns?.includes(p);
                return (
                  <button key={p} type="button" onClick={() => set("patterns", on ? st.patterns.filter((x) => x !== p) : [...(st.patterns ?? []), p])} className="text-[10px] px-1.5 py-0.5 rounded-full border" style={on ? { borderColor: "var(--accent)", color: "var(--accent)", background: "var(--surface-3)" } : { borderColor: "var(--border)", color: "var(--text-muted)" }}>
                    {p}
                  </button>
                );
              })}
            </div>
          </L>
          <div className="grid grid-cols-2 gap-2">
            <L label="Candle signal">
              <input list="study-candles" value={st.candle} onChange={(e) => set("candle", e.target.value)} className={inputCls} style={field} />
              <datalist id="study-candles">{CANDLES.map((c) => <option key={c} value={c} />)}</datalist>
            </L>
            <L label="Chart link">
              <input value={st.chartUrl} onChange={(e) => set("chartUrl", e.target.value)} placeholder="TradingView URL" className={inputCls} style={field} />
            </L>
            <L label="Supports">
              <input defaultValue={listVal(st.supports)} key={`s-${st.id}-${listVal(st.supports)}`} onBlur={listSet("supports")} placeholder="e.g. 3950, 3880" className={`${inputCls} font-mono`} style={field} />
            </L>
            <L label="Resistances">
              <input defaultValue={listVal(st.resistances)} key={`r-${st.id}-${listVal(st.resistances)}`} onBlur={listSet("resistances")} placeholder="e.g. 4120, 4250" className={`${inputCls} font-mono`} style={field} />
            </L>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <L label="3 · Indicators">
          <textarea rows={3} value={st.indicators} onChange={(e) => set("indicators", e.target.value)} className={inputCls} style={field} placeholder="RSI, MACD, MAs, divergences…" />
        </L>
        <L label="Volume & delivery">
          <textarea rows={3} value={st.volume} onChange={(e) => set("volume", e.target.value)} className={inputCls} style={field} placeholder="Volume on up vs down days, delivery trend…" />
        </L>
        <L label="Relative strength">
          <textarea rows={3} value={st.relativeStrength} onChange={(e) => set("relativeStrength", e.target.value)} className={inputCls} style={field} placeholder="vs NIFTY, vs its sector…" />
        </L>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>4 · VERDICT</p>
          <Seg options={VERDICTS} value={st.verdict} onChange={(v) => set("verdict", v)} />
          <div className="grid grid-cols-2 gap-3">
            <L label={`Conviction · ${st.conviction}/5`}>
              <input type="range" min="1" max="5" value={st.conviction} onChange={(e) => set("conviction", Number(e.target.value))} />
            </L>
            <L label="Horizon (sessions)">
              <input type="number" min="1" max="60" value={st.horizonDays} onChange={(e) => set("horizonDays", Number(e.target.value) || 10)} className={`${inputCls} font-mono`} style={field} />
            </L>
          </div>
          <p className="text-[11px] font-semibold mt-1" style={{ color: "var(--text-muted)" }}>5 · PLAN (optional)</p>
          <div className="grid grid-cols-4 gap-2">
            <select value={plan.direction} onChange={(e) => setPlan("direction", e.target.value)} className={inputCls} style={field}>
              <option>Long</option>
              <option>Short</option>
            </select>
            <input type="number" value={plan.entry ?? ""} onChange={(e) => setPlan("entry", e.target.value)} placeholder="Trigger" className={`${inputCls} font-mono`} style={field} />
            <input type="number" value={plan.stop ?? ""} onChange={(e) => setPlan("stop", e.target.value)} placeholder="Stop" className={`${inputCls} font-mono`} style={field} />
            <input type="number" value={plan.target ?? ""} onChange={(e) => setPlan("target", e.target.value)} placeholder="Target" className={`${inputCls} font-mono`} style={field} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onAddIdea(st)} className="text-[11px] px-2 py-1 rounded border" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
              Add to today&apos;s ideas
            </button>
            <button type="button" onClick={() => onLogTrade(st)} className="text-[11px] px-2 py-1 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
              Log trade
            </button>
            {onAddToWatchlist && !watchlistSymbols.includes(st.symbol) && (
              <button type="button" onClick={() => onAddToWatchlist(st.symbol, `Analysis study ${date}`)} className="text-[11px] px-2 py-1 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                + Watch
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>QUALITY CHECK</p>
          {checks.map((c) => (
            <label key={c.id} className="flex items-start gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={!!st.checklist?.[c.id]} onChange={(e) => set("checklist", { ...st.checklist, [c.id]: e.target.checked })} className="mt-0.5" />
              <span>
                <span style={{ color: "var(--text)" }}>{c.id}</span>
                {c.hint && (
                  <span className="block text-[10px]" style={{ color: c.auto === true ? "var(--gain)" : c.auto === false ? "var(--loss)" : "var(--text-faint)" }}>
                    {c.auto === true ? "✓ " : c.auto === false ? "✗ " : ""}
                    {c.hint}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </div>

      <L label="Notes — the full read, in your words">
        <textarea rows={4} value={st.notes} onChange={(e) => set("notes", e.target.value)} className={inputCls} style={field} />
      </L>

      {prev.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--text-muted)" }}>EARLIER STUDIES OF {st.symbol}</p>
          <ul className="text-xs flex flex-col gap-1">
            {prev.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-3" style={{ color: "var(--text-muted)" }}>
                <span className="font-mono">{h.date}</span>
                <span style={{ color: TONE[h.verdict] ?? "var(--text-faint)" }}>{h.verdict || "—"}</span>
                <span>{(h.patterns ?? []).join(", ")}</span>
                {h.verdictGrade?.correct != null && <span style={{ color: h.verdictGrade.correct ? "var(--gain)" : "var(--loss)" }}>{h.verdictGrade.correct ? "✓" : "✗"} {signed(h.verdictGrade.move10)} in 10</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function StockStudies({ date, studies, setStudies, entries, events, onOpen, selectedId, setSelectedId, onAddIdea, onLogTrade, onAddToWatchlist, watchlistSymbols = [] }) {
  const [newSym, setNewSym] = useState("");
  const [filter, setFilter] = useState("");
  const selected = studies.find((s) => s.id === selectedId) ?? studies[0] ?? null;

  const history = useMemo(
    () => (entries ?? []).flatMap((e) => (e.studies ?? []).map((st) => ({ ...st, date: e.date }))).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [entries]
  );
  const shownHistory = history.filter((h) => !filter || h.symbol.includes(filter.trim().toUpperCase()));

  function add() {
    const sym = newSym.trim().toUpperCase();
    if (!sym) return;
    const st = blankStudy(sym);
    setStudies([...studies, st]);
    setSelectedId(st.id);
    setNewSym("");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionTitle meta="Technical analysis of individual stocks — as many as you like for this day">Stock studies</SectionTitle>
        <Panel>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {studies.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                className="text-xs px-2.5 py-1 rounded border font-mono"
                style={selected?.id === s.id ? { borderColor: "var(--accent)", color: "var(--text)", background: "var(--surface-3)" } : { borderColor: "var(--border)", color: "var(--text-muted)" }}
              >
                {s.symbol}
                {s.verdict && <span style={{ color: TONE[s.verdict] }}> · {s.verdict[0]}</span>}
                {s.verdictGrade?.correct != null && <span style={{ color: s.verdictGrade.correct ? "var(--gain)" : "var(--loss)" }}> {s.verdictGrade.correct ? "✓" : "✗"}</span>}
              </button>
            ))}
            <span className="flex items-center gap-1.5">
              <input
                value={newSym}
                onChange={(e) => setNewSym(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && add()}
                placeholder="Symbol"
                className="rounded px-2 py-1 text-xs border w-28 font-mono"
                style={field}
              />
              <button type="button" onClick={add} disabled={!newSym.trim()} className="text-xs px-2.5 py-1 rounded font-medium disabled:opacity-40" style={{ background: "var(--accent)", color: "var(--bg)" }}>
                + New study
              </button>
            </span>
          </div>
          {selected ? (
            <StudyEditor
              key={selected.id}
              st={selected}
              date={date}
              update={(next) => setStudies(studies.map((s) => (s.id === next.id ? next : s)))}
              remove={() => setStudies(studies.filter((s) => s.id !== selected.id))}
              history={history}
              events={events}
              onAddIdea={onAddIdea}
              onLogTrade={onLogTrade}
              onAddToWatchlist={onAddToWatchlist}
              watchlistSymbols={watchlistSymbols}
            />
          ) : (
            <p className="text-xs" style={{ color: "var(--text-faint)" }}>
              No stocks studied on this day yet. Type a symbol and click + New study — then press <b>Auto-fill Panel&apos;s readings</b> to start from Panel&apos;s trend, stage, RSI, levels and delivery.
            </p>
          )}
        </Panel>
      </div>

      {history.length > 0 && (
        <div>
          <SectionTitle
            meta={
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by symbol" className="rounded px-2 py-0.5 text-xs border w-36" style={field} />
            }
          >
            All studies
          </SectionTitle>
          <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="table-scroll">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left border-b" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
                    {["Date", "Symbol", "Verdict", "Conv.", "W / D trend", "Patterns", "10 sessions", "Result", "Plan"].map((h) => (
                      <th key={h} className={`py-2 px-2 font-medium ${h === "Date" ? "pl-4" : ""}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shownHistory.slice(0, 200).map((h) => (
                    <tr key={`${h.date}-${h.id}`} onClick={() => onOpen(h.date, h.id)} className="border-b last:border-b-0 cursor-pointer hover:bg-white/[0.02]" style={{ borderColor: "var(--border)" }}>
                      <td className="py-2 pl-4 pr-2 font-mono" style={{ color: "var(--text-muted)" }}>{h.date}</td>
                      <td className="py-2 px-2 font-mono" style={{ color: "var(--text)" }}>{h.symbol}</td>
                      <td className="py-2 px-2" style={{ color: TONE[h.verdict] ?? "var(--text-faint)" }}>{h.verdict || "—"}</td>
                      <td className="py-2 px-2 font-mono">{h.conviction}</td>
                      <td className="py-2 px-2">
                        <span style={{ color: TONE[h.timeframes?.Weekly?.trend] ?? "var(--text-faint)" }}>{h.timeframes?.Weekly?.trend || "—"}</span> /{" "}
                        <span style={{ color: TONE[h.timeframes?.Daily?.trend] ?? "var(--text-faint)" }}>{h.timeframes?.Daily?.trend || "—"}</span>
                      </td>
                      <td className="py-2 px-2 max-w-[14rem] truncate" style={{ color: "var(--text-muted)" }}>{(h.patterns ?? []).join(", ") || "—"}</td>
                      <td className="py-2 px-2 font-mono" style={{ color: h.verdictGrade?.move10 >= 0 ? "var(--gain)" : h.verdictGrade?.move10 < 0 ? "var(--loss)" : "var(--text-faint)" }}>
                        {signed(h.verdictGrade?.move10 ?? null)}
                      </td>
                      <td className="py-2 px-2">{h.verdictGrade?.correct == null ? "—" : h.verdictGrade.correct ? <span style={{ color: "var(--gain)" }}>✓ right</span> : <span style={{ color: "var(--loss)" }}>✗ wrong</span>}</td>
                      <td className="py-2 px-2" style={{ color: "var(--text-muted)" }}>{h.planOutcome?.status ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
