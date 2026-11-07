// Sign-in for Panel — real accounts with passwords, replacing the old
// "type any name" identity cookie.
//
// HOW IT WORKS
//   - An account is a username + password. The password is never stored:
//     only a scrypt hash with a random per-user salt (Node's built-in
//     crypto — no extra dependency), compared in constant time.
//   - Signing in sets `panel_session`, an httpOnly cookie holding the
//     username and an expiry, signed with HMAC-SHA256 using SESSION_SECRET.
//     The browser's JavaScript can't read or alter it, and a cookie that's
//     been edited fails the signature check — so nobody can become someone
//     else by typing their name, which the old cookie allowed.
//   - Every API route that touches personal data (Watchlist, Holdings)
//     takes the username from the VERIFIED session only. Same username on
//     any device → same server-side data, which is what keeps devices in
//     sync.
//   - Repeated wrong passwords lock that username for 15 minutes.
//   - Optional SIGNUP_CODE: if set, creating an account needs that code, so
//     only people you give it to can register.
//
// Accounts live in the same Upstash Redis store as everything else
// (lib/kv.js) under `auth:user:<username>`.

import crypto from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { kv } from "@/lib/kv";

const scrypt = promisify(crypto.scrypt);

export const SESSION_COOKIE = "panel_session";
// Readable, display-only copy of the username for the header. It grants
// nothing — every check uses SESSION_COOKIE.
export const DISPLAY_COOKIE = "panel_identity";
export const SESSION_DAYS = 30;

const USER_PREFIX = "auth:user:";
const FAIL_PREFIX = "auth:fail:";
const MAX_FAILS = 8;
const LOCK_SECONDS = 15 * 60;
export const MIN_PASSWORD = 8;

export function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 32 ? s : null;
}

/** Usernames are case-insensitive: "Arun", " arun " and "ARUN" are one account. */
export function normaliseUsername(raw) {
  const u = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (u.length < 3 || u.length > 60) return null;
  if (!/^[a-z0-9@._\- ]+$/.test(u)) return null;
  return u;
}

async function hashPassword(password, salt = crypto.randomBytes(16)) {
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

export function signSession(username, days = SESSION_DAYS) {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET isn't set (needs 32+ characters)");
  const payload = b64url(JSON.stringify({ u: username, exp: Math.floor(Date.now() / 1000) + days * 86400 }));
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token) {
  const secret = sessionSecret();
  if (!secret || typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data?.u || !(data.exp > Date.now() / 1000)) return null;
    return data.u;
  } catch {
    return null;
  }
}

/** The signed-in username for this request, or null. Use in API routes. */
export async function getSessionUser() {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

export async function setSessionCookies(username) {
  const store = await cookies();
  const common = { path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: SESSION_DAYS * 86400 };
  store.set(SESSION_COOKIE, signSession(username), { ...common, httpOnly: true });
  store.set(DISPLAY_COOKIE, username, common);
}

export async function clearSessionCookies() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(DISPLAY_COOKIE);
}

// ---------------------------------------------------------------------

async function lockState(username) {
  const f = await kv.get(`${FAIL_PREFIX}${username}`);
  return { count: f?.count ?? 0, locked: (f?.count ?? 0) >= MAX_FAILS };
}

async function recordFailure(username) {
  const { count } = await lockState(username);
  await kv.set(`${FAIL_PREFIX}${username}`, { count: count + 1 }, { ex: LOCK_SECONDS });
}

/**
 * Returns { ok: true, username } or { ok: false, status, error }.
 * Throws only if the store itself is unreachable.
 */
export async function signIn(rawUsername, password) {
  const username = normaliseUsername(rawUsername);
  if (!username || typeof password !== "string" || !password) {
    return { ok: false, status: 400, error: "Enter your username and password" };
  }
  if ((await lockState(username)).locked) {
    return { ok: false, status: 429, error: "Too many wrong attempts — try again in 15 minutes" };
  }
  const user = await kv.get(`${USER_PREFIX}${username}`);
  // Same message for "no such user" and "wrong password", so the form
  // doesn't reveal which usernames exist.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await recordFailure(username);
    return { ok: false, status: 401, error: "Wrong username or password" };
  }
  await kv.del(`${FAIL_PREFIX}${username}`);
  return { ok: true, username };
}

export async function signUp(rawUsername, password, inviteCode) {
  const required = process.env.SIGNUP_CODE;
  if (required && inviteCode !== required) {
    return { ok: false, status: 403, error: "That invite code isn't right" };
  }
  const username = normaliseUsername(rawUsername);
  if (!username) {
    return {
      ok: false,
      status: 400,
      error: "Username must be 3–60 characters: letters, numbers, spaces, @ . _ -",
    };
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return { ok: false, status: 400, error: `Password must be at least ${MIN_PASSWORD} characters` };
  }
  const key = `${USER_PREFIX}${username}`;
  if (await kv.get(key)) {
    return { ok: false, status: 409, error: "That username is taken — sign in instead" };
  }
  await kv.set(key, { username, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() });
  return { ok: true, username };
}

export async function changePassword(username, current, next) {
  const res = await signIn(username, current);
  if (!res.ok) return res;
  if (typeof next !== "string" || next.length < MIN_PASSWORD) {
    return { ok: false, status: 400, error: `New password must be at least ${MIN_PASSWORD} characters` };
  }
  const key = `${USER_PREFIX}${username}`;
  const user = await kv.get(key);
  await kv.set(key, { ...user, passwordHash: await hashPassword(next), passwordChangedAt: new Date().toISOString() });
  return { ok: true, username };
}
