"use client";

import { useEffect, useState } from "react";

// Light / dark / follow-the-system theme.
//
// The preference lives in localStorage ("panel:theme"); the resolved theme
// is set as <html data-theme="light|dark">, which switches the colour
// tokens in globals.css. THEME_BOOT runs inline in <head> before the first
// paint, so a light-theme user never sees a dark flash.

export const THEME_KEY = "panel:theme";
export const THEME_EVENT = "panel:theme";

export const THEME_BOOT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}")||"system";var d=p==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;document.documentElement.dataset.theme=d;}catch(e){document.documentElement.dataset.theme="dark";}})();`;

export function readThemePref() {
  try {
    return localStorage.getItem(THEME_KEY) || "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(pref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* storage blocked: still apply for this page */
  }
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "light" ? "#f4f6fa" : "#080b13");
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: resolved }));
}

/**
 * A number that changes whenever the theme does — add it to a chart's
 * effect dependencies so the chart redraws with the new colours (charts
 * read the CSS tokens once, when they're created).
 */
export function useThemeVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((n) => n + 1);
    window.addEventListener(THEME_EVENT, bump);
    // Following the system: react when the OS switches light/dark.
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onSystem = () => {
      if (readThemePref() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onSystem);
    return () => {
      window.removeEventListener(THEME_EVENT, bump);
      mq.removeEventListener("change", onSystem);
    };
  }, []);
  return v;
}
