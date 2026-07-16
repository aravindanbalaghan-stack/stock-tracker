import { kv } from "@vercel/kv";

const LOGIN_LOG_KEY = "panel:login-log";
const MAX_ENTRIES = 500; // keep the log from growing unbounded over time

export async function recordLogin(identity) {
  try {
    const log = await kv.get(LOGIN_LOG_KEY);
    const entries = Array.isArray(log) ? log : [];
    entries.unshift({ identity, at: new Date().toISOString() });
    await kv.set(LOGIN_LOG_KEY, entries.slice(0, MAX_ENTRIES));
  } catch {
    // Best-effort — if KV isn't set up yet (e.g. before the SMS-alerts
    // setup steps in the README), logging shouldn't block someone from
    // actually being able to log in.
  }
}

export async function listLogins() {
  const log = await kv.get(LOGIN_LOG_KEY);
  return Array.isArray(log) ? log : [];
}
