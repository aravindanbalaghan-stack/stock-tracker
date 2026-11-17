"use client";

// One shared fetch of /api/stage-map for every Delivery sub-tab: switching
// tabs with "Show stage" on reuses the same answer instead of refetching.

import { useCallback, useEffect, useState } from "react";

let cached = null; // { at, data }
let inflight = null;
const TTL_MS = 30 * 60 * 1000;

function fetchStageMap() {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.data);
  if (!inflight) {
    inflight = fetch("/api/stage-map")
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
        cached = { at: Date.now(), data: json };
        return json;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** { data, loading, error, retry } — fetches only while `enabled`. */
export function useStageMap(enabled) {
  const [state, setState] = useState(() => ({ data: cached?.data ?? null, error: null }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchStageMap()
      .then((data) => !cancelled && setState({ data, error: null }))
      .catch((err) => !cancelled && setState((s) => ({ data: s.data, error: err?.message || "Couldn't load stages." })));
    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => {
    setState((s) => ({ data: s.data, error: null }));
    setAttempt((a) => a + 1);
  }, []);

  return {
    data: state.data,
    error: enabled ? state.error : null,
    loading: enabled && !state.data && !state.error,
    retry,
  };
}
