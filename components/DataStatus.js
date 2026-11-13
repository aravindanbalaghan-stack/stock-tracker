"use client";

// Header badge: has tonight's precompute run for the latest session?
// Click for details and a "Prepare now" button (lib/precompute.js).

import { useEffect, useRef, useState } from "react";

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
}
function fmtDay(d) {
  return d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "—";
}

export default function DataStatus() {
  const [s, setS] = useState(null);
  const [open, setOpen] = useState(false);
  const [kicked, setKicked] = useState(false);
  const ref = useRef(null);

  const load = () =>
    fetch("/api/precompute-status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setS)
      .catch(() => {});

  useEffect(() => {
    Promise.resolve().then(load);
    const id = setInterval(load, s?.running ? 5000 : 60000);
    return () => clearInterval(id);
  }, [s?.running]);

  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!s) return null;
  const ready = !s.running && s.runSession === s.session && s.finishedAt;
  const color = s.running ? "var(--accent)" : ready ? (s.failed.length ? "var(--tier-mid)" : "var(--gain)") : "var(--text-faint)";
  const label = s.running ? `Preparing ${s.done}/${s.total}` : ready ? `Data ready · ${fmtDay(s.session)}` : `Not prepared for ${fmtDay(s.session)}`;

  async function runNow() {
    setKicked(true);
    // Fire and poll — the job keeps going on the server.
    fetch("/api/cron/precompute").catch(() => {});
    setTimeout(load, 2500);
  }

  return (
    <span className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5" title="Precomputed data status">
        <span className={`w-1.5 h-1.5 rounded-full ${s.running ? "animate-pulse" : ""}`} style={{ background: color }} />
        <span style={{ color: "var(--text-faint)" }}>{label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-40 w-80 rounded-lg border p-3 shadow-xl text-xs" style={{ background: "var(--surface)", borderColor: "var(--border-strong)", color: "var(--text-muted)" }}>
          <p className="mb-2 leading-relaxed">
            Every evening after NSE publishes its files, Panel prepares every screener, delivery view, the picks and Trading Suggestions
            for the latest session, so tabs open instantly. Showing data for <b style={{ color: "var(--text)" }}>{fmtDay(s.session)}</b>.
          </p>
          <p>Last run: {fmtTime(s.startedAt)}{s.finishedAt ? ` → ${fmtTime(s.finishedAt)}` : s.running ? " (running)" : ""}</p>
          <p>
            Prepared {s.done} of {s.total}
            {s.failed.length > 0 && <span style={{ color: "var(--tier-mid)" }}> · {s.failed.length} failed (they&apos;ll compute on first open): {s.failed.slice(0, 4).join(", ")}{s.failed.length > 4 ? "…" : ""}</span>}
          </p>
          {!s.cronConfigured && (
            <p className="mt-2" style={{ color: "var(--tier-mid)" }}>
              The nightly schedule isn&apos;t active yet: add a <code>CRON_SECRET</code> environment variable in Vercel (see README → &quot;Instant
              tabs&quot;). Until then use Prepare now, or each view prepares itself the first time it&apos;s opened.
            </p>
          )}
          <button
            type="button"
            onClick={runNow}
            disabled={s.running || kicked}
            className="mt-3 text-xs px-3 py-1.5 rounded font-medium disabled:opacity-40"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            {s.running ? "Preparing…" : kicked ? "Started" : "Prepare now"}
          </button>
        </div>
      )}
    </span>
  );
}
