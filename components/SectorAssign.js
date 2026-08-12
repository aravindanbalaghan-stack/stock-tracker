"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Shows the sectors a stock belongs to, and lets you assign one when it
// belongs to none. Writes through /api/sector-overrides, so an assignment
// made here applies everywhere the app resolves sectors.

export default function SectorAssign({ symbol, sectors, onAssigned, compact = false }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!open || options) return;
    (async () => {
      try {
        const res = await fetch("/api/sector-overrides");
        const json = await res.json();
        setOptions(json.sectors ?? []);
      } catch {
        setOptions([]);
      }
    })();
  }, [open, options]);

  async function assign(sectorKey) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sector-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector: sectorKey, symbol }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Couldn't assign");
      setOpen(false);
      onAssigned?.(symbol, sectorKey);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Sector data unavailable (KV not configured, say) — don't imply the
  // stock has no sector when we simply couldn't check.
  if (sectors === null || sectors === undefined) {
    return (
      <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
        —
      </span>
    );
  }

  if (sectors.length > 0) {
    return (
      <div className="flex flex-wrap gap-1">
        {sectors.map((s) => (
          <Link
            key={s.key}
            href={`/sector/${encodeURIComponent(s.key)}`}
            className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap hover:underline"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {s.name}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="relative">
      {!open ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
          title="This stock isn't in any sector yet — assign one"
        >
          + Sector
        </button>
      ) : (
        <div
          className="absolute z-30 mt-1 rounded-[var(--radius-sm)] border shadow-xl"
          style={{ background: "var(--surface-2)", borderColor: "var(--border-strong)", minWidth: "12rem" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-2 py-1.5 border-b" style={{ borderColor: "var(--border)" }}>
            <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
              Assign {symbol}
            </span>
            <button type="button" onClick={() => setOpen(false)} style={{ color: "var(--text-muted)" }}>
              ×
            </button>
          </div>
          <div className="max-h-60 overflow-auto">
            {options === null && (
              <p className="px-2 py-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                Loading…
              </p>
            )}
            {options?.map((o) => (
              <button
                key={o.key}
                type="button"
                disabled={busy}
                onClick={() => assign(o.key)}
                className="w-full text-left px-2 py-1.5 text-xs hover:bg-white/5 disabled:opacity-50"
                style={{ color: "var(--text)" }}
              >
                {o.name}
                <span className="ml-1.5 text-[10px]" style={{ color: "var(--text-faint)" }}>
                  {o.count}
                </span>
              </button>
            ))}
          </div>
          {msg && (
            <p className="px-2 py-1.5 text-[10px]" style={{ color: "var(--loss)" }}>
              {msg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
