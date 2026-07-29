"use client";

import { useEffect, useState } from "react";
import { useSortableRows } from "@/lib/useSortableRows";
import SortableTh from "@/components/SortableTh";
import WatchlistAddButton from "@/components/WatchlistAddButton";
import InfoNote from "@/components/InfoNote";
import { SCREENS } from "@/lib/screens";
import { ScreenHeader, ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";
import { DebutHeaderCells, DebutCells } from "@/components/DebutCells";

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtVolume(n) {
  if (n === null || n === undefined) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  return n.toLocaleString("en-IN");
}

function fmtCap(cr) {
  if (cr == null) return "—";
  if (cr >= 100000) return `₹${(cr / 100000).toFixed(2)}L Cr`;
  return `₹${fmt(cr, 0)} Cr`;
}

// Same delivery-% shading as the Delivery screens, so the colour means the
// same thing everywhere in the app.
function deliveryTier(pct) {
  if (pct == null) return null;
  if (pct > 80) return { color: "var(--tier-high)", bg: "var(--tier-high-dim)" };
  if (pct >= 70) return { color: "var(--tier-mid)", bg: "var(--tier-mid-dim)" };
  if (pct >= 60) return { color: "var(--tier-low)", bg: "var(--tier-low-dim)" };
  return null;
}

function DeliveryPctCell({ pct }) {
  const tier = deliveryTier(pct);
  if (pct == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  if (!tier) {
    return (
      <span className="font-mono text-sm" style={{ color: "var(--text-muted)" }}>
        {fmt(pct)}%
      </span>
    );
  }
  return (
    <span className="font-mono text-sm px-1.5 py-0.5 rounded" style={{ color: tier.color, background: tier.bg }}>
      {fmt(pct)}%
    </span>
  );
}

// Whether the stock finished the session above or below where it opened —
// direction stated in words (that's the question being asked) with the
// size of the move alongside it.
function VsOpenCell({ pct }) {
  if (pct == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const above = pct >= 0;
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-xs font-medium" style={{ color: above ? "var(--gain)" : "var(--loss)" }}>
        {above ? "▲ Above" : "▼ Below"}
      </span>
      <span className="font-mono text-[11px]" style={{ color: "var(--text-faint)" }}>
        {above ? "+" : ""}
        {fmt(pct)}%
      </span>
    </span>
  );
}

export default function ScreenerTab({ screen, onAddToWatchlist, watchlistSymbols, onOpenDetail }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/screeners?screen=${encodeURIComponent(screen)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't run this screen");
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen]);

  const showListedOn = screen === "ipo-base";
  const showMarketCap = screen === "pocket-pivot";

  const { sorted, sort, onSort } = useSortableRows(data?.rows, "volumeRatio", "desc");
  const def = SCREENS[screen];

  if (error) return <ErrorState>{error}</ErrorState>;

  if (!data) {
    return (
      <LoadingState>
        Scanning every NSE stock for {def?.label ?? "this screen"} — the first run of the day pulls a
        month of exchange data, so it takes a moment.
      </LoadingState>
    );
  }

  return (
    <div>
      <ScreenHeader
        title={def.label}
        meta={`${data.resultCount} match${data.resultCount === 1 ? "" : "es"} from ${data.universeSize.toLocaleString("en-IN")} stocks · as of ${data.asOf}`}
      />

      <div className="mb-3">
        <InfoNote label={`What ${def.label} looks for`}>
          {def.description}{" "}
          {def.conditions.map((c, i) => (
            <span key={i}>
              {i === 0 ? "" : " · "}
              {c}
            </span>
          ))}
          {data.truncated && (
            <>
              {" "}
              <strong style={{ color: "var(--text-muted)" }}>
                {data.matchedBeforeEnrichment} stocks passed the first-stage filters, above the{" "}
                {data.shortlistCap} cap on how many get checked against the longer-horizon indicators —
                the most liquid ones were kept.
              </strong>
            </>
          )}
          {data.notes?.length > 0 && ` ${data.notes.join(" ")}`}
        </InfoNote>
      </div>

      {data.rows.length === 0 ? (
        <EmptyState>No stocks cleared this screen today.</EmptyState>
      ) : (
        <div
          className="rounded-[var(--radius)] border overflow-hidden"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div className="table-scroll">
            <table className="w-full border-collapse table-sticky">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                  <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" className="pl-4" />
                  <SortableTh label="Close" sortKey="close" sort={sort} onSort={onSort} />
                  <SortableTh label="Chg %" sortKey="changePercent" sort={sort} onSort={onSort} />
                  <SortableTh label="Deliv. %" sortKey="deliveryPct" sort={sort} onSort={onSort} />
                  <SortableTh label="Volume" sortKey="volume" sort={sort} onSort={onSort} />
                  <SortableTh
                    label="vs Avg Vol"
                    sortKey="volumeRatio"
                    sort={sort}
                    onSort={onSort}
                    title="Today's volume against the trailing 30-day average"
                  />
                  <SortableTh label="30WMA" sortKey="wma30" sort={sort} onSort={onSort} />
                  <DebutHeaderCells sort={sort} onSort={onSort} />
                  {showListedOn && <SortableTh label="Listed" sortKey="listedOn" sort={sort} onSort={onSort} />}
                  {showMarketCap && <SortableTh label="Market Cap" sortKey="marketCapCr" sort={sort} onSort={onSort} />}
                  <th className="py-2 pl-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const up = (r.changePercent ?? 0) >= 0;
                  return (
                    <tr key={r.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                      <td className="py-2.5 pl-4 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs w-5" style={{ color: "var(--accent)" }}>
                            {i + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => onOpenDetail?.(r.symbol)}
                            className="font-mono text-sm hover:underline"
                            style={{ color: "var(--text)" }}
                            title={`News and recent moves for ${r.symbol}`}
                          >
                            {r.symbol}
                          </button>
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>
                        ₹{fmt(r.close)}
                      </td>
                      <td
                        className="py-2.5 px-2 text-right font-mono text-sm"
                        style={{ color: up ? "var(--gain)" : "var(--loss)" }}
                      >
                        {r.changePercent == null ? "—" : `${up ? "+" : ""}${fmt(r.changePercent)}%`}
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <DeliveryPctCell pct={r.deliveryPct} />
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                        {fmtVolume(r.volume)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--accent)" }}>
                        {r.volumeRatio ? `${r.volumeRatio.toFixed(2)}×` : "—"}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                        {r.wma30 == null ? "—" : `₹${fmt(r.wma30)}`}
                      </td>
                      <DebutCells row={r} />
                      {showListedOn && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.listedOn ?? "—"}
                        </td>
                      )}
                      {showMarketCap && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {fmtCap(r.marketCapCr)}
                        </td>
                      )}
                      <td className="py-2.5 pl-2 pr-4 text-right">
                        <WatchlistAddButton
                          symbol={r.symbol}
                          inWatchlist={watchlistSymbols?.includes(r.symbol)}
                          onAdd={onAddToWatchlist}
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
    </div>
  );
}
