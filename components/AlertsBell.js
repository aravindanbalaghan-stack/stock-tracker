"use client";

import { useEffect, useState } from "react";
import { marketIsOpen } from "@/lib/marketHours";

export const ALERTS_EVENT = "panel:open-alerts";
export const ALERTS_CHANGED = "panel:alerts-changed";

/** Opens the alerts panel, optionally to create an alert for `symbol`. */
export function openAlerts(detail = {}) {
  window.dispatchEvent(new CustomEvent(ALERTS_EVENT, { detail }));
}

const COUNT_EVERY_MS = 60_000;
const CHECK_EVERY_MS = 120_000;

// Bell with an unread count. While Panel is open during market hours it
// also asks the server to check your price alerts every 2 minutes, so they
// work without any external scheduler.
export default function AlertsBell() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let live = true;
    const count = () =>
      fetch("/api/alerts?count=1")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => live && j && setUnread(j.unread ?? 0))
        .catch(() => {});
    const check = () => {
      if (document.visibilityState !== "visible" || !marketIsOpen()) return;
      fetch("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check" }) })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.fired > 0 && count())
        .catch(() => {});
    };
    count();
    const a = setInterval(count, COUNT_EVERY_MS);
    const b = setInterval(check, CHECK_EVERY_MS);
    const onChanged = () => count();
    window.addEventListener(ALERTS_CHANGED, onChanged);
    // ?alerts=1 (from a notification or the app shortcut) opens the panel.
    if (new URLSearchParams(location.search).get("alerts") === "1") setTimeout(() => openAlerts(), 300);
    return () => {
      live = false;
      clearInterval(a);
      clearInterval(b);
      window.removeEventListener(ALERTS_CHANGED, onChanged);
    };
  }, []);

  return (
    <button
      type="button"
      onClick={() => openAlerts()}
      className="relative inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] border transition-colors hover:border-[var(--border-strong)]"
      style={{ borderColor: "var(--border)", color: "var(--text-muted)", background: "var(--surface)" }}
      aria-label={unread ? `Alerts, ${unread} unread` : "Alerts"}
      title="Alerts"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unread > 0 && (
        <span
          className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold flex items-center justify-center"
          style={{ background: "var(--loss)", color: "#fff" }}
          aria-hidden="true"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}
