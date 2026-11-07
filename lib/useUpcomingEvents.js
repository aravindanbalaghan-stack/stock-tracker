"use client";

// One shared fetch of /api/events for the whole page — every SymbolLink
// reads from the same promise, so 200 symbols on screen still means one
// request.

import { useEffect, useState } from "react";

let promise = null;
let value = null;

function load() {
  if (!promise) {
    promise = fetch("/api/events")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        value = j?.bySymbol ?? {};
        return value;
      })
      .catch(() => {
        value = {};
        return value;
      });
  }
  return promise;
}

/** Upcoming events for `symbol` (date ≥ today), or [] — while loading too. */
export function useUpcomingEvents(symbol) {
  const [map, setMap] = useState(value);
  useEffect(() => {
    if (value) return;
    let alive = true;
    load().then((v) => alive && setMap(v));
    return () => {
      alive = false;
    };
  }, []);
  return (map ?? value)?.[symbol] ?? [];
}
