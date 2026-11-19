"use client";

import { useEffect, useState } from "react";

// Registers the service worker (push + offline page) and offers "Install
// app" where the browser supports it. iPhone/iPad Safari has no install
// prompt, so there it explains Share → Add to Home Screen instead.

export default function InstallButton() {
  const [prompt, setPrompt] = useState(null);
  const [ios, setIos] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    const onPrompt = (e) => {
      e.preventDefault();
      setPrompt(e);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone;
    if (isIos) Promise.resolve().then(() => setIos(true));
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!prompt && !ios) return null;
  const btn = "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-sm)] border text-xs transition-colors hover:border-[var(--border-strong)]";
  return (
    <span className="relative">
      <button
        type="button"
        className={btn}
        style={{ borderColor: "var(--border)", color: "var(--text-muted)", background: "var(--surface)" }}
        onClick={async () => {
          if (prompt) {
            prompt.prompt();
            await prompt.userChoice.catch(() => null);
            setPrompt(null);
          } else setShowIosHelp((v) => !v);
        }}
        aria-expanded={ios ? showIosHelp : undefined}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
        Install app
      </button>
      {showIosHelp && (
        <span
          role="note"
          className="absolute right-0 top-full mt-2 z-40 w-64 rounded-[var(--radius-sm)] border p-3 text-xs shadow-xl"
          style={{ borderColor: "var(--border-strong)", background: "var(--surface-2)", color: "var(--text)" }}
        >
          In Safari, tap <b>Share</b> (the square with an arrow), then <b>Add to Home Screen</b>. Panel then opens like
          an app from your home screen.
        </span>
      )}
    </span>
  );
}
