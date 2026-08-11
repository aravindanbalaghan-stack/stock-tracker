"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Chrome";

function fmtCap(cr) {
  if (cr == null) return "—";
  if (cr >= 100000) return `₹${(cr / 100000).toFixed(2)}L Cr`;
  return `₹${cr.toLocaleString("en-IN")} Cr`;
}

export default function SectorSyncPanel({ sectorKey, onApplied }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [minCap, setMinCap] = useState(500);
  const [sources, setSources] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  async function runPreview() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const qs = new URLSearchParams({ key: sectorKey, minCap: String(minCap) });
      if (sources.trim()) qs.set("sources", sources.trim());
      const res = await fetch(`/api/sector-sync?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Comparison failed");
      setPreview(json);
      // Nothing pre-selected: this writes to shared state, so it should be
      // a deliberate choice rather than an accepted default.
      setSelected(new Set());
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    if (selected.size === 0) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/sector-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector: sectorKey, symbols: [...selected] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Couldn't apply the additions");
      setResult(json);
      setPreview(null);
      setSelected(new Set());
      onApplied?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  }

  function toggle(symbol) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }

  return (
    <Panel>
      <div className="flex items-end gap-3 flex-wrap mb-3">
        <label className="flex flex-col text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
          Min market cap (₹ Cr)
          <input
            type="number"
            step="100"
            min="0"
            value={minCap}
            onChange={(e) => setMinCap(Number(e.target.value) || 0)}
            className="mt-1 w-28 rounded-[var(--radius-sm)] px-2 py-1 text-sm border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
            title="Zerodha's lists run down to sub-₹10 Cr shells that barely trade. This floor keeps sector aggregates meaningful."
          />
        </label>
        <label className="flex flex-col text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
          Source sector(s), optional
          <input
            value={sources}
            onChange={(e) => setSources(e.target.value)}
            placeholder="e.g. financial-services"
            className="mt-1 w-56 rounded-[var(--radius-sm)] px-2 py-1 text-sm border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
            title="Leave blank to use the default mapping. Comma-separate to pull from several."
          />
        </label>
        <button
          type="button"
          onClick={runPreview}
          disabled={loading}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          style={{ background: "var(--accent)", color: "var(--surface)" }}
        >
          {loading ? "Comparing…" : "Compare with Zerodha"}
        </button>
      </div>

      {error && (
        <p className="text-xs mb-3" style={{ color: "var(--loss)" }}>
          {error}
        </p>
      )}

      {result && (
        <p className="text-xs mb-3" style={{ color: "var(--gain)" }}>
          Added {result.addedCount} stock{result.addedCount === 1 ? "" : "s"} to this sector.
          {result.skipped?.length > 0 && ` ${result.skipped.length} skipped (already present).`}
        </p>
      )}

      {preview?.needsSourceChoice && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {preview.message} This app splits some sectors more finely than Zerodha does — Banking, PSU
          Banks, Insurance and Capital Markets all sit inside their single &quot;financial-services&quot;
          bucket, and Pharma and Healthcare Services inside &quot;healthcare&quot;. Enter one of those
          slugs above and review the suggestions rather than importing them wholesale.
        </p>
      )}

      {preview && !preview.needsSourceChoice && (
        <>
          <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
            Compared against Zerodha&apos;s <strong>{preview.sources.join(", ")}</strong> —{" "}
            {preview.candidateCount} NSE-listed companies above {fmtCap(preview.minMarketCapCr)}.{" "}
            {preview.alreadyPresent} already in this sector, <strong>{preview.missing.length} missing</strong>.
          </p>
          <p className="text-[11px] mb-3" style={{ color: "var(--text-faint)" }}>
            Excluded from the comparison: {preview.rejected.bseOnly} BSE-only listings (this app runs on
            NSE bhavcopy, so they&apos;d never carry data), {preview.rejected.belowCap} below the market-cap
            floor
            {preview.rejected.notOnNse > 0 && `, ${preview.rejected.notOnNse} not trading in the NSE EQ series`}
            {preview.rejected.unparsed > 0 && `, ${preview.rejected.unparsed} with no readable market cap`}.
            {preview.failedSlugs?.length > 0 && ` Couldn't fetch: ${preview.failedSlugs.join(", ")}.`}
          </p>

          {preview.missing.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--gain)" }}>
              Nothing missing — this sector already covers every qualifying stock Zerodha lists.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setSelected(new Set(preview.missing.map((m) => m.symbol)))}
                  className="text-[11px] px-2 py-0.5 rounded border"
                  style={{ borderColor: "var(--border)", color: "var(--accent)" }}
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-[11px] px-2 py-0.5 rounded border"
                  style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                >
                  Clear
                </button>
                <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                  {selected.size} selected
                </span>
              </div>

              <div
                className="rounded-[var(--radius-sm)] border overflow-auto mb-3"
                style={{ borderColor: "var(--border)", maxHeight: "20rem" }}
              >
                {preview.missing.map((m) => (
                  <label
                    key={m.symbol}
                    className="flex items-center gap-2.5 px-3 py-1.5 border-b last:border-b-0 cursor-pointer hover:bg-white/5"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(m.symbol)}
                      onChange={() => toggle(m.symbol)}
                    />
                    <span className="font-mono text-sm w-32 shrink-0" style={{ color: "var(--text)" }}>
                      {m.symbol}
                    </span>
                    <span className="text-xs flex-1 truncate" style={{ color: "var(--text-muted)" }}>
                      {m.name}
                    </span>
                    <span className="font-mono text-[11px] shrink-0" style={{ color: "var(--text-faint)" }}>
                      {fmtCap(m.marketCapCr)}
                    </span>
                  </label>
                ))}
              </div>

              <button
                type="button"
                onClick={apply}
                disabled={applying || selected.size === 0}
                className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                style={{ background: "var(--accent)", color: "var(--surface)" }}
              >
                {applying ? "Adding…" : `Add ${selected.size} to ${preview.name}`}
              </button>
            </>
          )}
        </>
      )}

      <p className="text-[11px] mt-3" style={{ color: "var(--text-faint)" }}>
        Source: Zerodha&apos;s public sector pages. Their buckets are broader than this app&apos;s — their
        Chemicals sector alone lists 459 companies against roughly 26 here — so this compares and proposes
        rather than importing wholesale. Nothing is written until you select and confirm.
      </p>
    </Panel>
  );
}
