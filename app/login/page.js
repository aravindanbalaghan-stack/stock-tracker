"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const inputStyle = { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" };

function SetupNotice({ status }) {
  const problems = [];
  if (status.storage === "missing") problems.push("no Upstash Redis database is connected");
  if (status.storage === "unreachable") problems.push("the Upstash Redis database isn't responding");
  if (status.secret === "missing") problems.push("SESSION_SECRET isn't set");
  if (!problems.length) return null;
  return (
    <div className="text-xs mb-4 px-3 py-2 rounded border leading-relaxed" style={{ borderColor: "var(--loss)", color: "var(--loss)" }}>
      Sign-in isn&apos;t set up on this deployment yet: {problems.join(" and ")}. Follow README → &ldquo;Set up storage and
      sign-in&rdquo;, then redeploy.
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [mode, setMode] = useState("signin");
  const [status, setStatus] = useState(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/login")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const minPassword = status?.minPassword ?? 8;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError("Enter your username and password");
      return;
    }
    if (mode === "signup") {
      if (password.length < minPassword) {
        setError(`Password must be at least ${minPassword} characters`);
        return;
      }
      if (password !== confirm) {
        setError("The two passwords don't match");
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, username: username.trim(), password, inviteCode: inviteCode.trim() || undefined }),
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

  const tab = (id, label) => (
    <button
      type="button"
      onClick={() => {
        setMode(id);
        setError(null);
      }}
      className="flex-1 py-1.5 text-xs font-medium rounded-[4px]"
      style={{ background: mode === id ? "var(--surface-3)" : "transparent", color: mode === id ? "var(--text)" : "var(--text-muted)" }}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-sm rounded-lg border p-6" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <h1 className="font-display text-xl mb-1" style={{ color: "var(--text)" }}>
          Panel
        </h1>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          {mode === "signin" ? "Sign in to your account." : "Create an account — your lists follow it to every device."}
        </p>

        {status && <SetupNotice status={status} />}

        <div className="flex rounded-[var(--radius-sm)] border p-0.5 gap-0.5 mb-4" style={{ borderColor: "var(--border)" }}>
          {tab("signin", "Sign in")}
          {tab("signup", "Create account")}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username (or email)"
            autoComplete="username"
            autoFocus
            className="rounded px-3 py-2 text-sm outline-none border"
            style={inputStyle}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? `Password (${minPassword}+ characters)` : "Password"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="rounded px-3 py-2 text-sm outline-none border"
            style={inputStyle}
          />
          {mode === "signup" && (
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              autoComplete="new-password"
              className="rounded px-3 py-2 text-sm outline-none border"
              style={inputStyle}
            />
          )}
          {mode === "signup" && status?.inviteCodeRequired && (
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="Invite code"
              className="rounded px-3 py-2 text-sm outline-none border"
              style={inputStyle}
            />
          )}
          {error && (
            <div className="text-xs" style={{ color: "var(--loss)" }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="rounded px-3 py-2 text-sm font-medium"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            {submitting ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="text-xs mt-4 leading-relaxed" style={{ color: "var(--text-faint)" }}>
          {mode === "signup"
            ? "Used Panel before with just a name? Create an account with that same name and the watchlist, holdings and Top 5 saved under it carry over."
            : "Your watchlist, holdings and Top 5 are saved to your account, so they're the same on every device you sign in on."}
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
