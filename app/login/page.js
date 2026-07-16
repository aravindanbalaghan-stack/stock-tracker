"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [value, setValue] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!value.trim()) {
      setError("Enter your email or name");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: value.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Couldn't sign in");
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-sm rounded-lg border p-6" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <h1 className="font-display text-xl mb-1" style={{ color: "var(--text)" }}>Panel</h1>
        <p className="text-sm mb-5" style={{ color: "var(--text-muted)" }}>
          Enter your email or name to continue.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="you@example.com or your name"
            autoFocus
            className="rounded px-3 py-2 text-sm outline-none border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          />
          {error && <div className="text-xs" style={{ color: "var(--loss)" }}>{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded px-3 py-2 text-sm font-medium"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            {submitting ? "Signing in…" : "Continue"}
          </button>
        </form>
        <p className="text-xs mt-4" style={{ color: "var(--text-faint)" }}>
          This just labels who&apos;s who (e.g. on price alerts) — there&apos;s no password and nothing is
          verified.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
