"use client";

import { PALETTE_EVENT } from "@/lib/navigation";

// Header button that opens the ⌘K command bar. Looks like a search box —
// that's what most people will use it for — but it also jumps to tabs,
// screeners and actions.
export default function CommandTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(PALETTE_EVENT))}
      className="group flex items-center gap-2 w-56 sm:w-64 px-3 py-1.5 rounded-[var(--radius-sm)] border text-left text-sm transition-colors hover:border-[var(--border-strong)]"
      style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-faint)" }}
      aria-label="Search stocks or jump to a screen"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <span className="flex-1 truncate">Search or jump to…</span>
      <kbd>⌘K</kbd>
    </button>
  );
}
