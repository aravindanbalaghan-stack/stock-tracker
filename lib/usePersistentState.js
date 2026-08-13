"use client";

import { useCallback, useEffect, useState } from "react";

// State that survives navigating away and back.
//
// The screener and delivery tabs unmount when you open a stock or sector
// page, so plain useState loses every filter you'd set. This keeps them in
// sessionStorage: they persist while you're working, and reset when you
// close the tab — which is the right lifetime for a filter, unlike
// localStorage where a threshold set weeks ago would silently still apply.
//
// Falls back to plain state if storage is unavailable (private mode, or
// server render), so the tabs never break over a persistence failure.

const PREFIX = "panel:filters:";

function read(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    // Guard against a stored shape that no longer matches the code — an
    // old key from a previous version shouldn't break the tab.
    if (
      fallback !== null &&
      typeof fallback === "object" &&
      !Array.isArray(fallback) &&
      (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    ) {
      return fallback;
    }
    // Merge onto the default so fields added since the value was stored
    // still get their defaults rather than coming back undefined.
    if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
      return { ...fallback, ...parsed };
    }
    return parsed;
  } catch {
    return fallback;
  }
}

export function usePersistentState(key, defaultValue) {
  // Lazy initialiser so storage is read once, during the first render,
  // rather than flashing the default and then correcting itself.
  const [value, setValue] = useState(() => read(key, defaultValue));

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // Storage full or blocked — the tab still works, it just won't
      // remember across navigation.
    }
  }, [key, value]);

  const reset = useCallback(() => setValue(defaultValue), [defaultValue]);

  return [value, setValue, reset];
}

/** Clears every persisted filter — used by the "reset filters" affordance. */
export function clearPersistedFilters() {
  if (typeof window === "undefined") return;
  try {
    const keys = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    /* nothing to do */
  }
}
