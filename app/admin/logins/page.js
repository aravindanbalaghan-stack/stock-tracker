"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function LoginsView() {
  const searchParams = useSearchParams();
  const keyFromUrl = searchParams.get("key") || "";

  const [key, setKey] = useState(keyFromUrl);
  const [logins, setLogins] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load(k) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/logins?key=${encodeURIComponent(k)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load");
      setLogins(json.logins);
    } catch (err) {
      setError(err.message);
      setLogins(null);
    } finally {
      setLoading(false);
    }
  }

  // Auto-load if the key arrived via ?key=... in the URL, e.g. a
  // bookmarked link — saves re-typing it every time.
  useEffect(() => {
    if (keyFromUrl) load(keyFromUrl);
  }, [keyFromUrl]);

  return (
    <div className="min-h-screen px-4 py-10 flex flex-col items-center" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-lg">
        <h1 className="font-display text-xl mb-1" style={{ color: "var(--text)" }}>Login log</h1>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          Every identity typed into /login, most recent first. This is unrelated to the casual
          friend-identity cookie — it needs a separate admin key (set via the ADMIN_KEY env var).
        </p>

        <form onSubmit={(e) => { e.preventDefault(); load(key); }} className="flex gap-2 mb-4">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Admin key"
            className="flex-1 rounded px-3 py-2 text-sm outline-none border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded px-3 py-2 text-sm font-medium"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            {loading ? "Loading…" : "View"}
          </button>
        </form>

        {error && (
          <div className="mb-4 rounded-md border px-4 py-3 text-sm" style={{ borderColor: "var(--loss)", background: "var(--loss-dim)", color: "var(--text)" }}>
            {error}
          </div>
        )}

        {logins && (
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            {logins.length === 0 ? (
              <div className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)" }}>No logins recorded yet.</div>
            ) : (
              logins.map((l, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-4 py-2 border-b last:border-b-0 text-sm"
                  style={{ borderColor: "var(--border)" }}
                >
                  <span style={{ color: "var(--text)" }}>{l.identity}</span>
                  <span className="text-xs" style={{ color: "var(--text-faint)" }}>{fmtWhen(l.at)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminLoginsPage() {
  return (
    <Suspense fallback={null}>
      <LoginsView />
    </Suspense>
  );
}
