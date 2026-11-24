"use client";

// Screenshots on a journal trade.
//   • Add: the button (several at once), drag & drop, or paste (Ctrl/⌘+V)
//     straight from a chart. Each image is shrunk in the browser first.
//   • View: the first three as large tiles; a "+N more" tile opens the rest;
//     any tile opens the full-screen viewer (← → to move, Esc to close,
//     thumbnails along the bottom to jump to one).

import { useCallback, useEffect, useRef, useState } from "react";
import { compressImage } from "@/lib/imageCompress";

const MAX = 12;
const PREVIEW = 3;
export const shotUrl = (id) => `/api/journal/screenshots?id=${encodeURIComponent(id)}`;

function Viewer({ shots, index, onIndex, onClose }) {
  const n = shots.length;
  const go = useCallback((d) => onIndex((index + d + n) % n), [index, n, onIndex]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, onClose]);
  const s = shots[index];
  if (!s) return null;
  const btn = "absolute top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center text-xl";
  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col"
      style={{ background: "rgba(8,10,14,0.92)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Screenshot ${index + 1} of ${n}`}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="flex items-center justify-between px-4 py-2 text-xs" style={{ color: "#cbd2e0" }} onClick={(e) => e.stopPropagation()}>
        <span>
          {index + 1} / {n}
        </span>
        <span className="flex items-center gap-3">
          <a href={shotUrl(s.id)} target="_blank" rel="noreferrer" className="underline">
            Open full size
          </a>
          <button type="button" onClick={onClose} className="px-2 py-1 rounded border" style={{ borderColor: "#4a5368" }} aria-label="Close viewer">
            ✕ Close
          </button>
        </span>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-14" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shotUrl(s.id)} alt={`Screenshot ${index + 1}`} className="max-w-full max-h-full object-contain rounded" />
        {n > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} className={`${btn} left-3`} style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }} aria-label="Previous screenshot">
              ‹
            </button>
            <button type="button" onClick={() => go(1)} className={`${btn} right-3`} style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }} aria-label="Next screenshot">
              ›
            </button>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="flex gap-2 justify-center px-4 py-3 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
          {shots.map((x, i) => (
            <button
              key={x.id}
              type="button"
              onClick={() => onIndex(i)}
              className="shrink-0 rounded overflow-hidden border-2"
              style={{ borderColor: i === index ? "var(--accent)" : "transparent", opacity: i === index ? 1 : 0.6 }}
              aria-label={`Show screenshot ${i + 1}`}
              aria-current={i === index}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shotUrl(x.id)} alt="" className="h-14 w-20 object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ shot, i, onOpen, onRemove }) {
  return (
    <div className="group relative rounded-[var(--radius-sm)] overflow-hidden border aspect-[16/10]" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
      <button type="button" onClick={() => onOpen(i)} className="w-full h-full" aria-label={`View screenshot ${i + 1}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shotUrl(shot.id)} alt={`Screenshot ${i + 1}`} className="w-full h-full object-cover object-top" loading="lazy" />
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(shot.id)}
          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full text-xs opacity-0 group-hover:opacity-100 focus:opacity-100"
          style={{ background: "rgba(0,0,0,0.65)", color: "#fff" }}
          aria-label={`Remove screenshot ${i + 1}`}
          title="Remove (deleted when you save the trade)"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * `shots`: [{id, w, h}]. With `onChange` it's editable (add / remove);
 * without, it only shows them.
 */
export default function TradeScreenshots({ shots, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [pending, setPending] = useState([]); // [{key, name, state, error}]
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);
  const shotsRef = useRef(shots);
  useEffect(() => {
    shotsRef.current = shots;
  });
  const editable = !!onChange;

  const upload = useCallback(
    async (files) => {
      const images = [...files].filter((f) => f.type.startsWith("image/"));
      const room = MAX - shotsRef.current.length;
      if (!images.length || !editable) return;
      const take = images.slice(0, Math.max(0, room));
      const skipped = images.length - take.length;
      const jobs = take.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name || "pasted image", state: "Shrinking…" }));
      setPending((p) => [...p, ...jobs, ...(skipped > 0 ? [{ key: `skip-${Date.now()}`, name: "", state: "", error: `Up to ${MAX} screenshots per trade — ${skipped} not added` }] : [])]);
      for (let i = 0; i < take.length; i++) {
        const job = jobs[i];
        try {
          const img = await compressImage(take[i]);
          setPending((p) => p.map((x) => (x.key === job.key ? { ...x, state: "Uploading…" } : x)));
          const res = await fetch("/api/journal/screenshots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(img) });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j?.error || "Upload failed");
          const next = [...shotsRef.current, { id: j.id, w: j.w, h: j.h }];
          shotsRef.current = next;
          onChange(next);
          setPending((p) => p.filter((x) => x.key !== job.key));
        } catch (err) {
          setPending((p) => p.map((x) => (x.key === job.key ? { ...x, state: "", error: `${job.name}: ${err.message}` } : x)));
        }
      }
    },
    [editable, onChange]
  );

  // Paste a screenshot straight in (anywhere in the trade form).
  useEffect(() => {
    if (!editable) return;
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      upload(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [editable, upload]);

  const remove = (id) => onChange(shots.filter((s) => s.id !== id));
  const hidden = Math.max(0, shots.length - PREVIEW);
  const visible = expanded ? shots : shots.slice(0, PREVIEW);

  return (
    <div
      onDragOver={(e) => {
        if (!editable) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!editable) return;
        e.preventDefault();
        setDragging(false);
        upload(e.dataTransfer.files);
      }}
      className="rounded-[var(--radius-sm)]"
      style={dragging ? { outline: "2px dashed var(--accent)", outlineOffset: 4 } : undefined}
    >
      {shots.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {visible.map((s, i) => (
            <Tile key={s.id} shot={s} i={i} onOpen={setViewing} onRemove={editable ? remove : null} />
          ))}
          {!expanded && hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="relative rounded-[var(--radius-sm)] overflow-hidden border aspect-[16/10]"
              style={{ borderColor: "var(--border)" }}
              aria-label={`Show ${hidden} more screenshot${hidden === 1 ? "" : "s"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shotUrl(shots[PREVIEW].id)} alt="" className="absolute inset-0 w-full h-full object-cover blur-[2px] scale-105" loading="lazy" />
              <span className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}>
                <span className="text-2xl font-display">+{hidden}</span>
                <span className="text-[11px]">more</span>
              </span>
            </button>
          )}
        </div>
      )}
      {expanded && hidden > 0 && (
        <button type="button" onClick={() => setExpanded(false)} className="text-[11px] underline mt-1.5" style={{ color: "var(--accent)" }}>
          Show fewer
        </button>
      )}

      {pending.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {pending.map((p) => (
            <li key={p.key} className="text-[11px] flex items-center justify-between gap-2" style={{ color: p.error ? "var(--loss)" : "var(--text-muted)" }}>
              <span>{p.error ?? `${p.name} — ${p.state}`}</span>
              {p.error && (
                <button type="button" onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))} className="underline" style={{ color: "var(--text-faint)" }}>
                  dismiss
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="flex items-center gap-3 flex-wrap mt-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={shots.length >= MAX}
            className="text-xs px-2.5 py-1 rounded border"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", opacity: shots.length >= MAX ? 0.5 : 1 }}
          >
            + Add screenshots
          </button>
          <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
            or drag them here, or paste one (Ctrl/⌘+V) · {shots.length}/{MAX}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
            multiple
            className="hidden"
            onChange={(e) => {
              upload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {viewing != null && <Viewer shots={shots} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
