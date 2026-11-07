"use client";

import { useState } from "react";

// Header → "Password": a small popover to change the signed-in user's password.
export default function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Couldn't change it");
      setMsg({ ok: true, text: "Password changed." });
      setCurrent("");
      setNext("");
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const field = { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" };
  return (
    <span className="relative">
      <button onClick={() => setOpen((v) => !v)} style={{ color: "var(--text-faint)" }}>
        Password
      </button>
      {open && (
        <form
          onSubmit={submit}
          className="absolute right-0 top-full mt-2 z-40 w-64 rounded-lg border p-3 flex flex-col gap-2 shadow-xl"
          style={{ background: "var(--surface)", borderColor: "var(--border-strong)" }}
        >
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" autoComplete="current-password" className="rounded px-2 py-1.5 text-sm border outline-none" style={field} />
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (8+)" autoComplete="new-password" className="rounded px-2 py-1.5 text-sm border outline-none" style={field} />
          {msg && (
            <span className="text-xs" style={{ color: msg.ok ? "var(--gain)" : "var(--loss)" }}>
              {msg.text}
            </span>
          )}
          <button type="submit" disabled={busy} className="rounded px-2 py-1.5 text-xs font-medium" style={{ background: "var(--accent)", color: "var(--bg)" }}>
            {busy ? "Saving…" : "Change password"}
          </button>
        </form>
      )}
    </span>
  );
}
