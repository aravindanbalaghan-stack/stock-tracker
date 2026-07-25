"use client";

import { useState } from "react";

// Generic expand/collapse wrapper: `summary` always shows; `children`
// only renders once expanded. Used both to compress dense results tables
// (NiftyBankTab's backtest/swing-high results) and to tuck away long
// methodology notes (InfoNote, which wraps this) behind a toggle instead
// of always taking up space.
export default function CollapsibleSection({
  summary,
  defaultOpen = false,
  expandLabel = "Show details",
  collapseLabel = "Hide",
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">{summary}</div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-xs px-2.5 py-1 rounded border shrink-0 whitespace-nowrap"
          style={{ borderColor: "var(--border)", color: "var(--accent)" }}
        >
          {open ? `▲ ${collapseLabel}` : `▼ ${expandLabel}`}
        </button>
      </div>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
