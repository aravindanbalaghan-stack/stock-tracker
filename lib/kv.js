// The app's one key-value store — Upstash Redis.
//
// This replaces the `@vercel/kv` package. Vercel retired its own "KV"
// product: new databases are created from Vercel → Storage → Marketplace →
// Upstash (Redis), and `@vercel/kv` is deprecated. Same API for what this
// app uses (get / set / del, values stored as JSON), so every caller just
// imports `kv` from here instead.
//
// Credentials are read from whichever naming the deployment has:
//   KV_REST_API_URL + KV_REST_API_TOKEN            (Vercel's Upstash integration)
//   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN  (a database made on upstash.com)
//   <PREFIX>_KV_REST_API_URL + <PREFIX>_KV_REST_API_TOKEN
//                                                  (integration connected with a custom prefix)
//
// Without credentials every call throws a clear "not configured" error,
// which the existing callers already catch and turn into their fallback or
// message.

import { Redis } from "@upstash/redis";

function findCredentials() {
  const env = process.env;
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) {
    return { url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN, source: "KV_REST_API_URL" };
  }
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    return { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN, source: "UPSTASH_REDIS_REST_URL" };
  }
  for (const name of Object.keys(env)) {
    const m = name.match(/^(.+)_KV_REST_API_URL$/);
    if (m && env[`${m[1]}_KV_REST_API_TOKEN`]) {
      return { url: env[name], token: env[`${m[1]}_KV_REST_API_TOKEN`], source: name };
    }
  }
  return null;
}

const creds = findCredentials();
const client = creds ? new Redis({ url: creds.url, token: creds.token }) : null;

export const kvConfigured = !!client;
export const kvSource = creds?.source ?? null;

const NOT_CONFIGURED =
  "KV store not configured: add an Upstash Redis database to this Vercel project (see README → \"Set up storage and sign-in\")";

function need() {
  if (!client) throw new Error(NOT_CONFIGURED);
  return client;
}

export const kv = {
  get: (key) => need().get(key),
  set: (key, value, opts) => need().set(key, value, opts),
  del: (...keys) => need().del(...keys),
  // Several keys in one round trip; missing keys come back as null.
  mget: (...keys) => (keys.length ? need().mget(...keys) : Promise.resolve([])),
  // Cursor-based key listing: returns [nextCursor, keys]. Cursor "0" ends it.
  scan: (cursor, opts) => need().scan(cursor, opts),
};

/** Round-trips one key — true only if the store is configured AND reachable. */
export async function kvHealthy() {
  if (!client) return false;
  try {
    await client.set("panel:health", Date.now(), { ex: 60 });
    return true;
  } catch {
    return false;
  }
}
