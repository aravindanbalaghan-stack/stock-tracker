"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ALERTS_EVENT, ALERTS_CHANGED } from "@/components/AlertsBell";
import { ALERT_TYPES, ALERT_TYPE_BY_ID, MARKET_ALERTS, AUTO_ALERTS, describeRule } from "@/lib/alertTypes";
import { SCREENS, MAIN_SCREEN_IDS, ARCHIVE_SCREEN_IDS } from "@/lib/screens";

// Slide-over panel for alerts, mounted once in app/layout.js and opened
// from the bell (or a stock page's "Alert" button with that symbol).

const TABS = [
  { id: "inbox", label: "Inbox" },
  { id: "rules", label: "My alerts" },
  { id: "delivery", label: "Delivery" },
];
const input =
  "rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm bg-[var(--surface-2)] border-[var(--border)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]";
const btnPrimary = "text-sm font-medium px-3.5 py-1.5 rounded-[var(--radius-sm)] disabled:opacity-50";
const btnQuiet = "text-xs px-2.5 py-1.5 rounded-[var(--radius-sm)] border";

function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function b64ToBytes(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const SCREEN_CHOICES = [...MAIN_SCREEN_IDS, ...ARCHIVE_SCREEN_IDS].filter((id) => SCREENS[id]).map((id) => ({ id, label: SCREENS[id].label }));

function NewAlert({ initialSymbol, onCreated }) {
  const [kind, setKind] = useState("stock");
  const [form, setForm] = useState({ symbol: initialSymbol ?? "", type: "price_above", value: "", repeat: "once", note: "", screenId: SCREEN_CHOICES[0]?.id ?? "" });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const t = kind === "stock" ? ALERT_TYPE_BY_ID[form.type] : null;

  async function create(e) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const rule =
        kind === "stock"
          ? { type: form.type, symbol: form.symbol, value: t?.needs ? form.value : undefined, repeat: form.repeat, note: form.note }
          : { type: form.type, screenId: form.screenId, screenLabel: SCREENS[form.screenId]?.label };
      const r = await fetch("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", rule }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Couldn't create the alert");
      onCreated(j.rules);
      setForm((f) => ({ ...f, value: "", note: "" }));
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={create} className="rounded-[var(--radius)] border p-3 space-y-2.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex gap-1" role="radiogroup" aria-label="Alert about">
        {[
          ["stock", "A stock"],
          ["market", "The market"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={kind === id}
            onClick={() => {
              setKind(id);
              setForm((f) => ({ ...f, type: id === "stock" ? "price_above" : "screen_new" }));
            }}
            className="px-2.5 py-1 rounded-full text-xs border"
            style={{ borderColor: kind === id ? "var(--accent)" : "var(--border)", color: kind === id ? "var(--text)" : "var(--text-muted)" }}
          >
            {label}
          </button>
        ))}
      </div>
      {kind === "stock" ? (
        <>
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
            <label className="sr-only" htmlFor="al-sym">Symbol</label>
            <input id="al-sym" className={`${input} uppercase font-mono`} placeholder="SYMBOL" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} autoComplete="off" spellCheck={false} />
            <label className="sr-only" htmlFor="al-type">When</label>
            <select id="al-type" className={`${input} w-full min-w-0`} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {ALERT_TYPES.map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {t?.needs && (
              <span className="inline-flex items-center gap-1">
                {t.unit === "₹" && <span className="text-sm" style={{ color: "var(--text-faint)" }}>₹</span>}
                <input className={`${input} w-28 font-mono`} type="number" step="any" min="0" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} aria-label="Value" required />
                {t.unit !== "₹" && <span className="text-sm" style={{ color: "var(--text-faint)" }}>{t.unit}</span>}
              </span>
            )}
            <select className={input} value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })} aria-label="Repeat">
              <option value="once">Alert once</option>
              <option value="daily">Every day it happens</option>
            </select>
          </div>
          <input className={`${input} w-full`} placeholder="Note (optional) — e.g. buy zone, add 50 more" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} aria-label="Note" />
          {t?.when === "eod" && <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>Checked after the close each evening.</p>}
        </>
      ) : (
        <div className="grid gap-2">
          <select className={input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} aria-label="Market alert">
            {MARKET_ALERTS.map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </select>
          {form.type === "screen_new" && (
            <select className={input} value={form.screenId} onChange={(e) => setForm({ ...form, screenId: e.target.value })} aria-label="Screener">
              {SCREEN_CHOICES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          )}
          <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>Checked after the close each evening; one alert per day listing what changed.</p>
        </div>
      )}
      {err && <p className="text-xs" role="alert" style={{ color: "var(--loss)" }}>{err}</p>}
      <button type="submit" disabled={busy} className={btnPrimary} style={{ background: "var(--accent)", color: "var(--on-accent)" }}>
        {busy ? "Creating…" : "Create alert"}
      </button>
    </form>
  );
}

function PushControls({ push, onTest }) {
  const [state, setState] = useState("checking"); // unsupported | denied | off | on | checking
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return live && setState("unsupported");
      if (Notification.permission === "denied") return live && setState("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (live) setState(sub ? "on" : "off");
    })().catch(() => live && setState("off"));
    return () => {
      live = false;
    };
  }, []);

  async function enable() {
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(push.publicKey) });
      const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!r.ok) throw new Error((await r.json())?.error || "Couldn't register this device");
      setState("on");
      setMsg("Notifications are on for this device.");
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    setState("off");
  }

  const ios = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true);

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium" style={{ color: "var(--text)" }}>Notifications on this device</h4>
      {!push.configured ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Push isn&apos;t set up on the server yet. Add <code>VAPID_PUBLIC_KEY</code> and <code>VAPID_PRIVATE_KEY</code> in
          Vercel (README → Alerts has the one-line command that makes them). Alerts still arrive in the inbox meanwhile.
        </p>
      ) : state === "unsupported" ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {ios && !standalone
            ? "On iPhone and iPad, notifications work once Panel is on your home screen: tap Share → Add to Home Screen, open it from there, then turn them on here."
            : "This browser doesn't support web notifications."}
        </p>
      ) : state === "denied" ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>Notifications are blocked for this site — allow them in your browser&apos;s site settings, then come back here.</p>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          {state === "on" ? (
            <>
              <span className="text-xs" style={{ color: "var(--gain)" }}>✓ On for this device</span>
              <button type="button" className={btnQuiet} style={{ borderColor: "var(--border)", color: "var(--text-muted)" }} onClick={disable}>Turn off</button>
            </>
          ) : (
            <button type="button" className={btnPrimary} style={{ background: "var(--accent)", color: "var(--on-accent)" }} onClick={enable} disabled={state === "checking"}>
              Turn on notifications
            </button>
          )}
          <button type="button" className={btnQuiet} style={{ borderColor: "var(--border)", color: "var(--text-muted)" }} onClick={onTest}>Send a test alert</button>
        </div>
      )}
      {msg && <p className="text-xs" role="status" style={{ color: "var(--text-muted)" }}>{msg}</p>}
    </div>
  );
}

export default function AlertsPanel() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("inbox");
  const [symbol, setSymbol] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [testMsg, setTestMsg] = useState(null);
  const [chat, setChat] = useState("");
  const closeRef = useRef(null);
  const lastFocus = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/alerts");
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Couldn't load alerts");
      setData(j);
      setChat(j.settings?.telegramChatId ?? "");
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    if (pathname === "/login") return;
    const onOpen = (e) => {
      lastFocus.current = document.activeElement;
      const sym = e.detail?.symbol ?? "";
      setSymbol(sym);
      setTab(sym ? "rules" : "inbox");
      setOpen(true);
      load();
    };
    window.addEventListener(ALERTS_EVENT, onOpen);
    return () => window.removeEventListener(ALERTS_EVENT, onOpen);
  }, [pathname, load]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function post(body) {
    const r = await fetch("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || "Something went wrong");
    return j;
  }

  function close() {
    setOpen(false);
    if (data?.unread) post({ action: "read", ids: "all" }).then(() => window.dispatchEvent(new Event(ALERTS_CHANGED))).catch(() => {});
    lastFocus.current?.focus?.();
  }

  if (!open) return null;
  const inbox = data?.inbox ?? [];
  const rules = data?.rules ?? [];

  return (
    <div className="fixed inset-0 z-[90] flex justify-end" style={{ background: "var(--scrim)" }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="alerts-title"
        className="h-full w-full max-w-md flex flex-col border-l shadow-2xl"
        style={{ background: "var(--bg)", borderColor: "var(--border-strong)" }}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 id="alerts-title" className="font-display text-lg font-semibold" style={{ color: "var(--text)" }}>
            Alerts
          </h2>
          <button ref={closeRef} type="button" onClick={close} className="w-8 h-8 rounded hover:bg-[var(--hover)]" aria-label="Close alerts" style={{ color: "var(--text-muted)" }}>
            ✕
          </button>
        </div>
        <div className="px-4 flex gap-1 border-b" role="tablist" style={{ borderColor: "var(--border)" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="px-3 py-2 text-sm -mb-px border-b-2"
              style={{ borderColor: tab === t.id ? "var(--accent)" : "transparent", color: tab === t.id ? "var(--text)" : "var(--text-muted)" }}
            >
              {t.label}
              {t.id === "inbox" && data?.unread ? ` (${data.unread})` : t.id === "rules" && rules.length ? ` (${rules.filter((r) => r.active).length})` : ""}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3" role="tabpanel">
          {error && <p className="text-sm" role="alert" style={{ color: "var(--loss)" }}>{error}</p>}
          {!data && !error && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>}

          {data && tab === "inbox" && (
            inbox.length === 0 ? (
              <p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
                Nothing yet. Create alerts under <button type="button" className="underline" onClick={() => setTab("rules")}>My alerts</button> — holdings with a stop or target are watched automatically.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {inbox.map((x) => (
                  <li key={x.id} className="rounded-[var(--radius-sm)] border px-3 py-2" style={{ borderColor: "var(--border)", background: x.read ? "var(--surface)" : "var(--surface-2)" }}>
                    <div className="flex items-baseline justify-between gap-2">
                      <Link href={x.url ?? "/"} onClick={close} className="text-sm font-medium hover:underline" style={{ color: "var(--text)" }}>
                        {!x.read && <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: "var(--accent)" }} aria-label="unread" />}
                        {x.title}
                      </Link>
                      <span className="text-[11px] shrink-0" style={{ color: "var(--text-faint)" }}>{ago(x.at)}</span>
                    </div>
                    {x.body && <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{x.body}</p>}
                  </li>
                ))}
              </ul>
            )
          )}

          {data && tab === "rules" && (
            <>
              <NewAlert key={symbol} initialSymbol={symbol} onCreated={(r) => setData({ ...data, rules: r })} />
              {rules.length > 0 && (
                <ul className="space-y-1.5">
                  {rules.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--surface)", opacity: r.active ? 1 : 0.6 }}>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm" style={{ color: "var(--text)" }}>{describeRule(r)}</div>
                        <div className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                          {r.repeat === "daily" ? "every day it happens" : "once"}
                          {r.lastFired ? ` · last fired ${r.lastFired}` : ""}
                          {!r.active && r.repeat === "once" && r.lastFired ? " · done" : ""}
                          {r.note ? ` · ${r.note}` : ""}
                        </div>
                      </div>
                      <label className="flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                        <input
                          type="checkbox"
                          checked={r.active}
                          onChange={async (e) => setData({ ...data, rules: (await post({ action: "toggle", id: r.id, active: e.target.checked })).rules })}
                        />
                        On
                      </label>
                      <button
                        type="button"
                        className="text-xs px-1.5 rounded hover:bg-[var(--hover)]"
                        style={{ color: "var(--text-faint)" }}
                        aria-label={`Delete alert: ${describeRule(r)}`}
                        onClick={async () => {
                          const res = await fetch(`/api/alerts?id=${encodeURIComponent(r.id)}`, { method: "DELETE" });
                          if (res.ok) setData({ ...data, rules: (await res.json()).rules });
                        }}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {data && tab === "delivery" && (
            <div className="space-y-5">
              <PushControls
                push={data.push}
                onTest={async () => {
                  setTestMsg(null);
                  try {
                    const r = await post({ action: "test" });
                    setTestMsg(`Sent: inbox${r.pushed ? `, ${r.pushed} device${r.pushed === 1 ? "" : "s"}` : ""}${r.telegram ? ", Telegram" : ""}.`);
                    load();
                    window.dispatchEvent(new Event(ALERTS_CHANGED));
                  } catch (e) {
                    setTestMsg(e.message);
                  }
                }}
              />
              {testMsg && <p className="text-xs" role="status" style={{ color: "var(--text-muted)" }}>{testMsg}</p>}

              <div className="space-y-2">
                <h4 className="text-sm font-medium" style={{ color: "var(--text)" }}>Telegram</h4>
                {data.telegram.configured ? (
                  <>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Message your Panel bot on Telegram, then paste your chat id (get it from @userinfobot) below.
                    </p>
                    <div className="flex gap-2">
                      <input className={`${input} flex-1 font-mono`} value={chat} onChange={(e) => setChat(e.target.value)} placeholder="e.g. 123456789" aria-label="Telegram chat id" />
                      <button
                        type="button"
                        className={btnQuiet}
                        style={{ borderColor: "var(--border)", color: "var(--text)" }}
                        onClick={async () => {
                          try {
                            const r = await post({ action: "settings", settings: { telegramChatId: chat } });
                            setData({ ...data, settings: r.settings });
                            setTestMsg("Telegram saved — use “Send a test alert” to check it.");
                          } catch (e) {
                            setTestMsg(e.message);
                          }
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Optional. Set <code>TELEGRAM_BOT_TOKEN</code> in Vercel (README → Alerts) to also get alerts as Telegram messages.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium" style={{ color: "var(--text)" }}>Automatic alerts on your holdings</h4>
                {AUTO_ALERTS.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
                    <input
                      type="checkbox"
                      checked={!!data.settings?.auto?.[a.id]}
                      onChange={async (e) => {
                        const r = await post({ action: "settings", settings: { auto: { [a.id]: e.target.checked } } });
                        setData({ ...data, settings: r.settings });
                      }}
                    />
                    {a.label}
                  </label>
                ))}
                <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>Set stops and targets in Holdings → Analytics.</p>
              </div>

              <div className="text-[11px] leading-relaxed space-y-1" style={{ color: "var(--text-faint)" }}>
                <p>
                  <b style={{ color: "var(--text-muted)" }}>When alerts are checked:</b> every evening after the close (everything), and every 2
                  minutes during market hours while Panel is open in a tab (price alerts).
                </p>
                <p>To get price alerts during the day with Panel closed, point a free scheduler (e.g. cron-job.org) at /api/cron/alerts?mode=live every 5 minutes — README → Alerts.</p>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
