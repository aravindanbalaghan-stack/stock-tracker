"use client";

// Lookback — what the Shakeout screen and the Odds-ranked picks showed on
// any of the last 10 trading sessions, and how those stocks have moved
// since.
//
// The two halves come from different places, on purpose:
//   - Shakeout is RE-RUN for the chosen date (/api/screeners with date=),
//     with every input truncated to that session. So it's available for
//     every day, whether or not anyone opened the screen back then.
//   - Picks are READ from the log written each day the Home tab computed
//     them (lib/picks.js). They're ranked off weekly bars, so re-running a
//     mid-week date would quietly give that week's FINAL ranking instead of
//     what was actually shown. A day with no log says so.

import { useEffect, useState } from "react";
import { useSortableRows } from "@/lib/useSortableRows";
import SortableTh from "@/components/SortableTh";
import SymbolLink from "@/components/SymbolLink";
import WatchlistAddButton from "@/components/WatchlistAddButton";
import InfoNote from "@/components/InfoNote";
import { ScreenHeader, SectionTitle, ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";
import { formatDayLabel } from "@/lib/periodLabel";
import { usePersistentState } from "@/lib/usePersistentState";

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}

function SinceCell({ pct }) {
  if (pct == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const up = pct >= 0;
  return (
    <span
      className="font-mono text-xs px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{ color: up ? "var(--gain)" : "var(--loss)", background: up ? "var(--gain-dim)" : "var(--loss-dim)" }}
    >
      {up ? "+" : ""}
      {fmt(pct, 1)}%
    </span>
  );
}

function avg(list) {
  const v = list.map((r) => r.sincePct).filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function shortDay(d) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------

function ShakeoutTable({ date, latestDate, onAddToWatchlist, watchlistSymbols }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // No reset needed — the parent keys this component by date, so a new
    // date mounts a fresh instance.
    let cancelled = false;
    (async () => {
      try {
        // The latest session is a plain run (no date=), same as the
        // Shakeout tab itself; anything older is an as-of re-run.
        const qs = new URLSearchParams({ screen: "shakeout" });
        if (date !== latestDate) qs.set("date", date);
        const res = await fetch(`/api/screeners?${qs.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't run Shakeout for this date");
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, latestDate]);

  const { sorted, sort, onSort } = useSortableRows(data?.rows, "skSort", "desc");
  const isPast = !!data?.sinceLatestDate;
  const avgSince = data?.rows ? avg(data.rows) : null;

  return (
    <section className="mb-8">
      <SectionTitle
        meta={
          data
            ? `${data.rows.length} match${data.rows.length === 1 ? "" : "es"} on ${formatDayLabel(data.asOf)}${
                isPast && avgSince != null ? ` · average ${avgSince >= 0 ? "+" : ""}${fmt(avgSince, 1)}% since` : ""
              }`
            : null
        }
      >
        Shakeout
      </SectionTitle>

      {error ? (
        <ErrorState>{error}</ErrorState>
      ) : !data ? (
        <LoadingState>Re-running Shakeout as of {formatDayLabel(date)} — this takes a moment the first time.</LoadingState>
      ) : data.rows.length === 0 ? (
        <EmptyState>No stock qualified for Shakeout on {formatDayLabel(data.asOf)}.</EmptyState>
      ) : (
        <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="table-scroll">
            <table className="w-full border-collapse table-sticky">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                  <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" className="pl-4" />
                  <SortableTh label="Status" sortKey="skSort" sort={sort} onSort={onSort} align="left" />
                  <SortableTh label="Level" sortKey="skLevel" sort={sort} onSort={onSort} />
                  <SortableTh label="Reclaimed" sortKey="skReclaimDate" sort={sort} onSort={onSort} />
                  <SortableTh label="Evidence" sortKey="skStrength" sort={sort} onSort={onSort} />
                  <SortableTh label={isPast ? "Close then" : "Close"} sortKey="close" sort={sort} onSort={onSort} />
                  {isPast && <SortableTh label="Close now" sortKey="closeNow" sort={sort} onSort={onSort} />}
                  {isPast && (
                    <SortableTh
                      label="Since"
                      sortKey="sincePct"
                      sort={sort}
                      onSort={onSort}
                      title={`Move from the close on ${data.asOf} to the close on ${data.sinceLatestDate}`}
                    />
                  )}
                  <SortableTh label="Stop" sortKey="skStop" sort={sort} onSort={onSort} />
                  <th className="py-2 pl-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const stopHit = isPast && r.closeNow != null && r.skStop != null && r.closeNow < r.skStop;
                  return (
                    <tr key={r.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                      <td className="py-2.5 pl-4 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs w-5" style={{ color: "var(--accent)" }}>
                            {i + 1}
                          </span>
                          <SymbolLink symbol={r.symbol} className="text-sm" />
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-left text-xs whitespace-nowrap" title={r.reason}>
                        <span
                          className="px-1.5 py-0.5 rounded"
                          style={
                            r.skGrade === "A"
                              ? { color: "var(--gain)", background: "var(--gain-dim)" }
                              : { color: r.skGrade === "Watch" ? "var(--tier-mid)" : "var(--text-muted)", background: "var(--surface-2)" }
                          }
                        >
                          {r.skGrade === "Watch" ? "Watch — not reclaimed" : `${r.skGrade} · Reclaimed`}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                        ₹{fmt(r.skLevel)}
                        <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                          {r.skLevelType}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                        {r.skReclaimDate ?? "—"}
                      </td>
                      <td
                        className="py-2.5 px-2 text-right font-mono text-xs"
                        style={{ color: "var(--accent)" }}
                        title={r.skChecks?.map((c) => `${c.pass ? "✓" : "✗"} ${c.label} — ${c.detail}`).join("\n")}
                      >
                        {r.skStrength}/{r.skStrengthOf}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>
                        ₹{fmt(r.close)}
                      </td>
                      {isPast && (
                        <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>
                          {r.closeNow == null ? "—" : `₹${fmt(r.closeNow)}`}
                        </td>
                      )}
                      {isPast && (
                        <td className="py-2.5 px-2 text-right">
                          <SinceCell pct={r.sincePct} />
                        </td>
                      )}
                      <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: stopHit ? "var(--loss)" : "var(--text-muted)" }}>
                        {r.skStop == null ? "—" : `₹${fmt(r.skStop)}`}
                        {stopHit && (
                          <span className="block text-[10px]" title="Today's close is below the shakeout low — the setup failed">
                            stop broken
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pl-2 pr-4 text-right">
                        <WatchlistAddButton
                          symbol={r.symbol}
                          inWatchlist={watchlistSymbols?.includes(r.symbol)}
                          onAdd={onAddToWatchlist}
                          source={`Lookback · Shakeout ${data.asOf}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------

const HORIZON_ORDER = ["short", "mid", "long"];

function PicksList({ hid, h, date, isPast, onAddToWatchlist, watchlistSymbols }) {
  const { sorted, sort, onSort } = useSortableRows(h.picks, "rank", "asc");
  return (
    <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="px-4 py-2.5 border-b flex items-baseline justify-between gap-2" style={{ borderColor: "var(--border)" }}>
        <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {h.label} <span className="text-xs font-normal" style={{ color: "var(--text-faint)" }}>· hold {h.hold}</span>
        </span>
        {isPast && h.avgSincePct != null && (
          <span className="text-xs" style={{ color: "var(--text-faint)" }}>
            avg <SinceCell pct={h.avgSincePct} />
          </span>
        )}
      </div>
      {!h.picks ? (
        <p className="px-4 py-3 text-xs" style={{ color: "var(--text-faint)" }}>
          Not recorded for this session.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                <SortableTh label="#" sortKey="rank" sort={sort} onSort={onSort} align="left" className="pl-4" />
                <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" />
                <SortableTh label={isPast ? "Then" : "Close"} sortKey="priceThen" sort={sort} onSort={onSort} />
                {isPast && <SortableTh label="Now" sortKey="closeNow" sort={sort} onSort={onSort} />}
                {isPast && <SortableTh label="Since" sortKey="sincePct" sort={sort} onSort={onSort} />}
                <th className="py-2 pl-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2 pl-4 pr-2 text-xs" style={{ color: "var(--accent)" }}>
                    {p.rank}
                  </td>
                  <td className="py-2 px-2">
                    <SymbolLink symbol={p.symbol} className="text-sm" />
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                    {p.priceThen == null ? "—" : `₹${fmt(p.priceThen)}`}
                  </td>
                  {isPast && (
                    <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text)" }}>
                      {p.closeNow == null ? "—" : `₹${fmt(p.closeNow)}`}
                    </td>
                  )}
                  {isPast && (
                    <td className="py-2 px-2 text-right">
                      <SinceCell pct={p.sincePct} />
                    </td>
                  )}
                  <td className="py-2 pl-2 pr-3 text-right">
                    <WatchlistAddButton
                      symbol={p.symbol}
                      inWatchlist={watchlistSymbols?.includes(p.symbol)}
                      onAdd={onAddToWatchlist}
                      source={`Lookback · ${h.label} pick ${date}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PicksSectionForDate({ data, onAddToWatchlist, watchlistSymbols }) {
  const isPast = data.date !== data.latestDate;
  return (
    <section>
      <SectionTitle meta={data.recorded ? `as logged on ${formatDayLabel(data.date)}` : null}>Odds-ranked picks</SectionTitle>
      {!data.kvAvailable ? (
        <EmptyState>Picks history needs the KV store, which isn&apos;t configured on this deployment.</EmptyState>
      ) : !data.recorded ? (
        <EmptyState>
          No picks were recorded on {formatDayLabel(data.date)}. Picks are logged the first time the Home tab computes them each
          day, so a session where nobody opened Home has no record. Days with a record are marked ✓ in the date list.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {HORIZON_ORDER.map((hid) => (
            <PicksList
              key={hid}
              hid={hid}
              h={data.horizons[hid]}
              date={data.date}
              isPast={isPast}
              onAddToWatchlist={onAddToWatchlist}
              watchlistSymbols={watchlistSymbols}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------

export default function LookbackTab({ onAddToWatchlist, watchlistSymbols }) {
  // Empty = latest session. Persisted so a refresh keeps the chosen day.
  const [date, setDate] = usePersistentState("lookback.date", "");
  // Results are stored with the date they belong to, so switching dates
  // shows the loading state straight away without resetting state in the
  // effect body.
  const [loaded, setLoaded] = useState({ key: null, picks: null, error: null });
  const picks = loaded.key === date ? loaded.picks : null;
  const error = loaded.key === date ? loaded.error : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ section: "picks-history" });
        if (date) qs.set("date", date);
        const res = await fetch(`/api/home?${qs.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't load picks history");
        if (!cancelled) setLoaded({ key: date, picks: json, error: null });
      } catch (err) {
        if (!cancelled) setLoaded({ key: date, picks: null, error: err.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  // The API resolves "" (and any date outside the window) to a real session.
  const effective = picks?.date ?? null;
  const days = picks?.tradingDays ?? [];
  const idx = effective ? days.indexOf(effective) : -1;

  const picker = (
    <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-faint)" }}>
      <button
        type="button"
        className="px-2 py-1 rounded border disabled:opacity-30"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        disabled={idx === -1 || idx >= days.length - 1}
        onClick={() => setDate(days[idx + 1])}
        title="Previous session"
        aria-label="Previous session"
      >
        ←
      </button>
      <label className="flex items-center gap-1.5">
        Date
        <select
          value={effective ?? ""}
          onChange={(e) => setDate(e.target.value === days[0] ? "" : e.target.value)}
          disabled={!days.length}
          className="rounded-[var(--radius-sm)] px-2 py-1 text-sm border"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        >
          {days.map((d, i) => (
            <option key={d} value={d}>
              {shortDay(d)}
              {i === 0 ? " (latest)" : ""}
              {picks?.recordedDates?.includes(d) ? " · picks ✓" : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="px-2 py-1 rounded border disabled:opacity-30"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        disabled={idx <= 0}
        onClick={() => setDate(idx - 1 === 0 ? "" : days[idx - 1])}
        title="Next session"
        aria-label="Next session"
      >
        →
      </button>
    </div>
  );

  return (
    <div>
      <ScreenHeader
        title="Lookback"
        meta={
          effective
            ? effective === picks.latestDate
              ? `Latest session · ${formatDayLabel(effective)}`
              : `${formatDayLabel(effective)} · moves measured to the close on ${formatDayLabel(picks.latestDate)}`
            : "Last 10 trading sessions"
        }
        actions={picker}
      />

      <div className="mb-4">
        <InfoNote label="How this works">
          Pick any of the last 10 trading sessions to see what Shakeout and the Odds-ranked picks showed that day, and how each
          stock has moved since. Shakeout is re-run for the chosen date using only data available on that day, so every session
          is available. Picks are read from the daily log the Home tab writes, so a session where Home wasn&apos;t opened has no
          record. &ldquo;Stop broken&rdquo; marks a Shakeout stock that has since closed below its shakeout low.
        </InfoNote>
      </div>

      {error && !picks ? (
        <ErrorState>{error}</ErrorState>
      ) : !picks ? (
        <LoadingState>Loading the last 10 sessions…</LoadingState>
      ) : (
        <>
          <ShakeoutTable
            key={effective}
            date={effective}
            latestDate={picks.latestDate}
            onAddToWatchlist={onAddToWatchlist}
            watchlistSymbols={watchlistSymbols}
          />
          <PicksSectionForDate data={picks} onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />
        </>
      )}
    </div>
  );
}
