"use client";

import { useEffect, useState } from "react";
import { applyTheme, readThemePref, useThemeVersion } from "@/lib/theme";

// Cycles System → Light → Dark. The label says what's active, for screen
// readers and on hover.
const NEXT = { system: "light", light: "dark", dark: "system" };
const LABEL = { system: "Theme: follows your device", light: "Theme: light", dark: "Theme: dark" };

function Icon({ pref }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true };
  if (pref === "light")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  if (pref === "dark")
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

export default function ThemeToggle() {
  const [pref, setPref] = useState("system");
  useThemeVersion(); // keeps "system" in sync with the OS
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => live && setPref(readThemePref()));
    return () => {
      live = false;
    };
  }, []);
  return (
    <button
      type="button"
      onClick={() => {
        const next = NEXT[pref] ?? "system";
        setPref(next);
        applyTheme(next);
      }}
      className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] border transition-colors hover:border-[var(--border-strong)]"
      style={{ borderColor: "var(--border)", color: "var(--text-muted)", background: "var(--surface)" }}
      aria-label={`${LABEL[pref]}. Click to change.`}
      title={LABEL[pref]}
    >
      <Icon pref={pref} />
    </button>
  );
}
