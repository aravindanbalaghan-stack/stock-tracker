"use client";

// Trading Suggestions — Stock F&O and BANKNIFTY sections. Logic and the
// honesty rules behind it live in lib/tradingSuggestions.js.

import { Fragment, useCallback, useEffect, useState } from "react";
import { ScreenHeader, SectionTitle, ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";
import SymbolLink from "@/components/SymbolLink";
import WatchlistAddButton from "@/components/WatchlistAddButton";
import InfoNote from "@/components/InfoNote";
import { formatDayLabel } from "@/lib/periodLabel";
import { usePersistentState } from "@/lib/usePersistentState";

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}
function signed(v, d = 2) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${fmt(v, d)}%`;
}
const tone = (v) => (v == null ? "var(--text-faint)" : v > 0 ? "var(--gain)" : "var(--loss)");

function useSection(section, date, bar) {
  // Results are keyed by the request so a date change shows the loading
  // state straight away without resetting state inside the effect.
  const key = `${section}|${date}|${bar}`;
  const [loaded, setLoaded] = useState({ key: null, data: null, error: null });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ section });
        if (date) qs.set("date", date);
        qs.set("bar", String(bar));
        const res = await fetch(`/api/trading-suggestions?${qs.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't build suggestions");
        if (!cancelled) setLoaded({ key, data: json, error: null });
      } catch (err) {
        if (!cancelled) setLoaded({ key, data: null, error: err.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [section, date, bar, key]);
  return loaded.key === key ? loaded : { data: null, error: null };
}

function SideBadge({ side }) {
  const long = side === "long";
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide"
      style={{ color: long ? "var(--gain)" : "var(--loss)", background: long ? "var(--gain-dim)" : "var(--loss-dim)" }}
    >
      {long ? "Long" : "Short"}
    </span>
  );
}

function StatLine({ label, s, highlight }) {
  if (!s) {
    return (
      <div className="text-xs" style={{ color: "var(--text-faint)" }}>
        {label}: no closed trades yet
      </div>
    );
  }
  const below = highlight && s.winRatePct < 80;
  return (
    <div className="text-xs flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: "var(--text-muted)" }}>
      <span style={{ color: "var(--text)" }}>{label}</span>
      <span>
        <span className="font-mono" style={{ color: below ? "var(--tier-mid)" : "var(--gain)" }}>
          {fmt(s.winRatePct, 1)}%
        </span>{" "}
        won of {s.trades.toLocaleString("en-IN")} trades
      </span>
      <span>
        avg <span style={{ color: tone(s.avgRetPct) }}>{signed(s.avgRetPct)}</span>
      </span>
      <span>
        avg win <span style={{ color: "var(--gain)" }}>{signed(s.avgWinPct)}</span> · avg loss{" "}
        <span style={{ color: "var(--loss)" }}>{signed(s.avgLossPct)}</span>
      </span>
      <span>
        worst <span style={{ color: "var(--loss)" }}>{signed(s.worstPct)}</span>
      </span>
      {s.profitFactor != null && <span>profit factor {fmt(s.profitFactor, 2)}</span>}
    </div>
  );
}

function EvidencePanel({ data }) {
  const wf = data.walkForward;
  return (
    <div className="rounded-[var(--radius)] border p-3 mb-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <p className="text-[11px] uppercase tracking-wide mb-1.5" style={{ color: "var(--text-faint)" }}>
        Backtest since {data.dataFrom ? formatDayLabel(data.dataFrom) : "—"} · {data.symbolsTested} symbol
        {data.symbolsTested === 1 ? "" : "s"} · net of {data.rules.costPct}% costs per trade
      </p>
      <StatLine label="Following these suggestions (walk-forward)" s={wf} highlight />
      <div className="mt-1">
        <StatLine label="Every signal, no win-rate filter" s={data.unfiltered} />
      </div>
      {wf && wf.winRatePct < data.minWinPct && (
        <p className="text-xs mt-2" style={{ color: "var(--tier-mid)" }}>
          Out of sample, following only the suggestions that cleared the {data.minWinPct}% bar at the time won{" "}
          {fmt(wf.winRatePct, 1)}% — under {data.minWinPct}%. Past win rates on a stock don&apos;t fully carry forward; treat the per-stock figures as an upper bound.
        </p>
      )}
      {data.bars?.length > 0 && (
        <div className="mt-3 table-scroll">
          <table className="text-xs border-collapse">
            <thead>
              <tr style={{ color: "var(--text-faint)" }}>
                <th className="text-left pr-4 py-1 font-medium" title="Minimum past win rate a symbol+setup needed at the time of the signal">
                  Bar
                </th>
                <th className="text-right pr-4 py-1 font-medium">Trades</th>
                <th className="text-right pr-4 py-1 font-medium" title="Walk-forward — what following only signals that cleared this bar actually did">
                  Won
                </th>
                <th className="text-right pr-4 py-1 font-medium">Avg / trade</th>
                <th className="text-right pr-4 py-1 font-medium">Worst</th>
                <th className="text-right py-1 font-medium" title="Sessions in the last year with at least one suggestion at this bar">
                  Sessions with a suggestion
                </th>
              </tr>
            </thead>
            <tbody>
              {data.bars.map((b) => (
                <tr key={b.bar} style={{ color: b.bar === data.minWinPct ? "var(--text)" : "var(--text-muted)" }}>
                  <td className="pr-4 py-0.5">
                    {b.bar}%{b.bar === data.minWinPct ? " ◂" : ""}
                  </td>
                  <td className="text-right pr-4 py-0.5 font-mono">{b.stats?.trades?.toLocaleString("en-IN") ?? 0}</td>
                  <td className="text-right pr-4 py-0.5 font-mono">{b.stats ? `${fmt(b.stats.winRatePct, 1)}%` : "—"}</td>
                  <td className="text-right pr-4 py-0.5 font-mono" style={{ color: tone(b.stats?.avgRetPct) }}>
                    {signed(b.stats?.avgRetPct)}
                  </td>
                  <td className="text-right pr-4 py-0.5 font-mono" style={{ color: "var(--loss)" }}>
                    {signed(b.stats?.worstPct)}
                  </td>
                  <td className="text-right py-0.5 font-mono">
                    {b.sessionsWithSignal} / {b.sessionsInWindow}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className="mt-2">
        <summary className="text-xs cursor-pointer" style={{ color: "var(--accent)" }}>
          By setup
        </summary>
        <div className="mt-2 grid gap-2">
          {Object.entries(data.bySetup).map(([k, s]) => (
            <div key={k}>
              <p className="text-xs font-medium" style={{ color: "var(--text)" }}>
                {s.label} <span style={{ color: "var(--text-faint)" }}>— {s.source}</span>
              </p>
              <StatLine label="Walk-forward" s={s.walkForward} highlight />
              <StatLine label="Unfiltered" s={s.unfiltered} />
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function NearMisses({ data, isIndex }) {
  if (!data.signalsFired) {
    return (
      <EmptyState>
        No setup fired on {isIndex ? "BANKNIFTY" : "any F&O stock"} on {formatDayLabel(data.date)}
        {isIndex ? "" : ` (${data.symbolsTested} stocks checked)`}. If that wasn&apos;t a trading day, pick another date.
      </EmptyState>
    );
  }
  return (
    <div className="rounded-[var(--radius)] border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
        {data.signalsFired} signal{data.signalsFired === 1 ? "" : "s"} fired on {formatDayLabel(data.date)}, but none had a{" "}
        {data.minWinPct}%+ record over {data.rules.minPriorTrades}+ earlier trades. Closest:
      </p>
      <table className="text-xs border-collapse w-full">
        <tbody>
          {data.nearMisses.map((m) => (
            <tr key={`${m.symbol}|${m.setupLabel}`} style={{ color: "var(--text-muted)" }}>
              <td className="py-0.5 pr-3 whitespace-nowrap">
                <span style={{ color: "var(--text)" }}>{m.symbol}</span> <SideBadge side={m.side} />
              </td>
              <td className="py-0.5 pr-3 whitespace-nowrap">{m.setupLabel}</td>
              <td className="py-0.5 pr-3 whitespace-nowrap font-mono">
                {m.priorWinRate == null ? "—" : `${fmt(m.priorWinRate, 0)}% of ${m.priorTrades}`}
              </td>
              <td className="py-0.5 pr-3" style={{ color: "var(--tier-mid)" }}>
                {m.why}
              </td>
              <td className="py-0.5 text-right font-mono whitespace-nowrap" style={{ color: tone(m.outcomePct) }}>
                {m.status === "closed" ? `then ${signed(m.outcomePct)}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OutcomeCell({ r }) {
  if (r.status === "pending") {
    return (
      <span className="text-xs" style={{ color: "var(--accent)" }}>
        Enter at next open
        <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
          skip if it opens {r.side === "long" ? "below" : "above"} ₹{fmt(r.stop)}
        </span>
      </span>
    );
  }
  if (r.status === "open") {
    return (
      <span className="text-xs font-mono" style={{ color: tone(r.openRetPct) }}>
        Open {signed(r.openRetPct)}
        <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
          ₹{fmt(r.mark)} on {r.markDate}
        </span>
      </span>
    );
  }
  return (
    <span className="text-xs font-mono" style={{ color: tone(r.retPct) }}>
      {r.retPct > 0 ? "Won" : "Lost"} {signed(r.retPct)}
      <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
        {r.exitReason} · ₹{fmt(r.exit)} on {r.exitDate}
      </span>
    </span>
  );
}

function SuggestionTable({ rows, isIndex, onAddToWatchlist, watchlistSymbols }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="table-scroll">
        <table className="w-full border-collapse table-sticky">
          <thead>
            <tr className="text-left border-b text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
              <th className="py-2 pl-4 pr-2 font-medium">Symbol</th>
              <th className="py-2 px-2 font-medium">Setup</th>
              <th className="py-2 px-2 font-medium text-right">Signal close</th>
              <th className="py-2 px-2 font-medium text-right" title="Next session's open after the signal">
                Entry
              </th>
              <th
                className="py-2 px-2 font-medium text-right"
                title="Closing-basis stop: exit only if a session CLOSES beyond this. Intraday wicks through it don't count."
              >
                Stop (on close)
              </th>
              <th
                className="py-2 px-2 font-medium text-right"
                title="Exit on a close at or beyond this level — the setup's own exit rule, converted to a price for the next session"
              >
                Exit price
              </th>
              <th className="py-2 px-2 font-medium text-right" title="Entry moved by this symbol's average winning trade on this setup">
                Typical target
              </th>
              <th className="py-2 px-2 font-medium text-right" title="This symbol + setup, using only trades closed before the signal date">
                Past record
              </th>
              {!isIndex && <th className="py-2 px-2 font-medium text-right">Lot</th>}
              <th className="py-2 px-2 font-medium">Outcome</th>
              <th className="py-2 pl-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const id = `${r.symbol}|${r.setup}|${r.signalDate}`;
              const isOpen = open === id;
              return (
                <Fragment key={id}>
                  <tr
                    className="border-b align-top cursor-pointer"
                    style={{ borderColor: "var(--border)" }}
                    onClick={() => setOpen(isOpen ? null : id)}
                    title="Click for the reason"
                  >
                    <td className="py-2.5 pl-4 pr-2">
                      <span className="flex items-center gap-1.5">
                        {isIndex ? (
                          <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                            BANKNIFTY
                          </span>
                        ) : (
                          <SymbolLink symbol={r.symbol} className="text-sm" />
                        )}
                        <SideBadge side={r.side} />
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                      {r.setupLabel}
                      <span className="block text-[10px]" style={{ color: "var(--accent)" }}>
                        {isOpen ? "hide reason ▴" : "why? ▾"}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text)" }}>
                      ₹{fmt(r.signalClose)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {r.entry != null ? `₹${fmt(r.entry)}` : "next open"}
                      {r.entryDate && (
                        <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                          {r.entryDate}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--loss)" }}>
                      ₹{fmt(r.stop)}
                      <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                        {fmt(r.stopPct, 1)}% away
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--gain)" }}>
                      {r.side === "long" ? "≥ " : "≤ "}₹{fmt(r.exitTrigger)}
                      <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                        or after {r.maxHold} sessions
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {r.typicalTarget == null ? "—" : `₹${fmt(r.typicalTarget)}`}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs">
                      <span style={{ color: "var(--gain)" }}>{fmt(r.priorWinRate, 0)}%</span>
                      <span style={{ color: "var(--text-faint)" }}> of {r.priorTrades}</span>
                      <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                        avg {signed(r.priorAvgRetPct)} · worst {signed(r.priorWorstPct)}
                      </span>
                    </td>
                    {!isIndex && (
                      <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                        {r.lotSize ?? "—"}
                      </td>
                    )}
                    <td className="py-2.5 px-2">
                      <OutcomeCell r={r} />
                    </td>
                    <td className="py-2.5 pl-2 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                      {!isIndex && (
                        <WatchlistAddButton
                          symbol={r.symbol}
                          inWatchlist={watchlistSymbols?.includes(r.symbol)}
                          onAdd={onAddToWatchlist}
                          source={`Trading Suggestions · ${r.setupLabel}`}
                        />
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr style={{ background: "var(--surface-2)" }}>
                      <td colSpan={12} className="px-4 py-3 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                        <span style={{ color: "var(--text)" }}>Reason: </span>
                        {r.reason}
                        <span className="block mt-1" style={{ color: "var(--text-faint)" }}>
                          This setup&apos;s past losers averaged {signed(r.priorAvgLossPct)} against winners of{" "}
                          {signed(r.priorAvgWinPct)} — wins are frequent but small, so the stop matters. Set a price alert at the
                          stop rather than a resting stop-loss order, and act on the close.
                        </span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Section({ title, section, date, bar, onDates, onAddToWatchlist, watchlistSymbols }) {
  const { data, error } = useSection(section, date, bar);
  const isIndex = section === "banknifty";

  useEffect(() => {
    if (data) onDates(section, data);
  }, [data, section, onDates]);

  return (
    <section className="mb-10">
      <SectionTitle
        meta={
          data
            ? `${data.suggestions.length} suggestion${data.suggestions.length === 1 ? "" : "s"} on ${formatDayLabel(data.date)}${
                isIndex && data.lotSize ? ` · lot ${data.lotSize}` : ""
              }`
            : null
        }
      >
        {title}
      </SectionTitle>

      {error ? (
        <ErrorState>{error}</ErrorState>
      ) : !data ? (
        <LoadingState>
          {isIndex
            ? "Backtesting 10 years of BANKNIFTY…"
            : "Backtesting ~5 years of every F&O stock — the first load of the day takes up to a minute."}
        </LoadingState>
      ) : (
        <>
          {!isIndex && data.universeApproximate && (
            <p className="text-xs mb-2" style={{ color: "var(--tier-mid)" }}>
              {data.universeSource}.
            </p>
          )}
          <EvidencePanel data={data} />

          {data.suggestions.length === 0 ? (
            <NearMisses data={data} isIndex={isIndex} />
          ) : (
            <SuggestionTable
              rows={data.suggestions}
              isIndex={isIndex}
              onAddToWatchlist={onAddToWatchlist}
              watchlistSymbols={watchlistSymbols}
            />
          )}

          {data.openTrades.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>
                Still open from earlier suggestions — manage these exits
              </p>
              <SuggestionTable
                rows={data.openTrades}
                isIndex={isIndex}
                onAddToWatchlist={onAddToWatchlist}
                watchlistSymbols={watchlistSymbols}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function TradingSuggestionsTab({ onAddToWatchlist, watchlistSymbols }) {
  const [date, setDate] = usePersistentState("tradingSuggestions.date", "");
  const [bar, setBar] = usePersistentState("tradingSuggestions.bar", 80);
  const [meta, setMeta] = useState({});

  // Each section reports its latest date, browsable window and signal
  // dates; the picker uses the union so ← → jump between sessions that
  // had a suggestion in either section.
  const onDates = useCallback(
    (section, d) =>
      setMeta((m) =>
        m[section]?.latestDate === d.latestDate && m[section]?.signalDates?.length === d.signalDates.length
          ? m
          : { ...m, [section]: { latestDate: d.latestDate, windowStart: d.windowStart, signalDates: d.signalDates } }
      ),
    []
  );

  const latest = [meta.stocks?.latestDate, meta.banknifty?.latestDate].filter(Boolean).sort().pop() ?? "";
  const minDate = [meta.stocks?.windowStart, meta.banknifty?.windowStart].filter(Boolean).sort().pop() ?? "";
  const signalDates = [...new Set([...(meta.stocks?.signalDates ?? []), ...(meta.banknifty?.signalDates ?? [])])].sort();
  const current = date || latest;
  const prev = [...signalDates].reverse().find((d) => d < current);
  const next = signalDates.find((d) => d > current);

  const picker = (
    <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-faint)" }}>
      <button
        type="button"
        className="px-2 py-1 rounded border disabled:opacity-30"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        disabled={!prev}
        onClick={() => setDate(prev)}
        title="Previous session with a suggestion"
      >
        ←
      </button>
      <label className="flex items-center gap-1.5">
        Date
        <input
          type="date"
          value={current}
          min={minDate || undefined}
          max={latest || undefined}
          onChange={(e) => setDate(e.target.value === latest ? "" : e.target.value)}
          className="rounded-[var(--radius-sm)] px-2 py-1 text-sm border"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)", colorScheme: "dark" }}
        />
      </label>
      <button
        type="button"
        className="px-2 py-1 rounded border disabled:opacity-30"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        disabled={!next}
        onClick={() => setDate(next === latest ? "" : next)}
        title="Next session with a suggestion"
      >
        →
      </button>
      {date && (
        <button type="button" className="px-2 py-1 rounded border" style={{ borderColor: "var(--border)", color: "var(--accent)" }} onClick={() => setDate("")}>
          Latest
        </button>
      )}
      <select
        value=""
        onChange={(e) => e.target.value && setDate(e.target.value === latest ? "" : e.target.value)}
        disabled={!signalDates.length}
        className="rounded-[var(--radius-sm)] px-2 py-1 text-xs border"
        style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        title="Jump to a session that had at least one suggestion"
      >
        <option value="">{signalDates.length} sessions with suggestions…</option>
        {[...signalDates].reverse().map((d) => (
          <option key={d} value={d}>
            {formatDayLabel(d)}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1.5 ml-1">
        Min win rate
        <select
          value={bar}
          onChange={(e) => setBar(Number(e.target.value))}
          className="rounded-[var(--radius-sm)] px-2 py-1 text-xs border"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          title="Minimum past win rate (symbol + setup) for a signal to be shown. Compare the bars in the table under each section."
        >
          {[80, 75, 70, 65].map((b) => (
            <option key={b} value={b}>
              {b}%
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <div>
      <ScreenHeader
        title="Trading Suggestions"
        meta={
          current
            ? current === latest
              ? `Signals from the ${formatDayLabel(current)} close — for the next session`
              : `${formatDayLabel(current)} · showing how each suggestion played out`
            : "Short-term swing setups, filtered by each symbol's own track record"
        }
        actions={picker}
      />

      <div className="mb-5">
        <InfoNote label="How these are picked — and what they can't promise">
          Three published short-term setups (Connors &amp; Alvarez: RSI(2) pullback, Cumulative RSI(2), Double 7s) are backtested
          on every F&amp;O stock (~5 years) and BANKNIFTY (10 years), long in uptrends and short in downtrends. A signal is only
          shown if that symbol&apos;s own past trades on that setup — counting only trades that had closed before the signal date —
          won at least the chosen bar (80% by default) of at least 10 trades, net of costs. Entry is the next session&apos;s open; exits are on the close: the
          setup&apos;s exit price, a closing-basis stop, or 10 sessions. The stop sits 2 × ATR beyond the 5-session swing and away from round
          numbers, and only a close beyond it counts, so an intraday stop-hunt wick doesn&apos;t shake you out. The
          &ldquo;walk-forward&rdquo; line is what following only these filtered suggestions actually returned; that is the honest
          number, and it can come in under 80%. High-win-rate setups win small and lose bigger, so one loss can erase several
          wins — size every position so the stop is a loss you can take. This is a rule-based scan of past prices, not advice
          from a SEBI-registered adviser, and SEBI&apos;s own study found most individual F&amp;O traders lose money.
        </InfoNote>
      </div>

      <Section
        title="Stock F&O"
        section="stocks"
        date={date}
        bar={bar}
        onDates={onDates}
        onAddToWatchlist={onAddToWatchlist}
        watchlistSymbols={watchlistSymbols}
      />
      <Section
        title="BANKNIFTY"
        section="banknifty"
        date={date}
        bar={bar}
        onDates={onDates}
        onAddToWatchlist={onAddToWatchlist}
        watchlistSymbols={watchlistSymbols}
      />
    </div>
  );
}
