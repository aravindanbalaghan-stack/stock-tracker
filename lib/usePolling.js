"use client";

// One rule for every auto-refresh in Panel, to keep server CPU (Vercel's
// "Active CPU") low:
//   • only while the browser tab is visible — a background tab or a
//     sleeping phone never polls
//   • only during NSE market hours (Mon–Fri, 9:10–15:35 IST) for live
//     prices — outside them the numbers can't change, so one load is enough
//   • when the tab comes back into view, refresh once (if it's been a while)
//
// usePolling(fn, ms, { marketHoursOnly = true })

import { useEffect, useRef } from "react";

export function marketOpenNow(now = new Date()) {
  const ist = new Date(now.getTime() + 19800 * 1000);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= 9 * 60 + 10 && mins <= 15 * 60 + 35;
}

export function usePolling(fn, ms, { marketHoursOnly = true, enabled = true } = {}) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (!enabled || !ms) return;
    let last = Date.now();
    const shouldRun = () => document.visibilityState === "visible" && (!marketHoursOnly || marketOpenNow());
    const tick = () => {
      if (!shouldRun()) return;
      last = Date.now();
      fnRef.current?.();
    };
    const id = setInterval(tick, ms);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last > ms && (!marketHoursOnly || marketOpenNow())) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms, marketHoursOnly, enabled]);
}

/** For existing setInterval loops: true only when a poll could show something new. */
export function shouldPoll({ marketHoursOnly = true } = {}) {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
  return !marketHoursOnly || marketOpenNow();
}
