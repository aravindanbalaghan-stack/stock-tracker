// nseindia.com (unlike nsearchives.nseindia.com) sits behind bot
// protection that requires a browser-like cookie session before its JSON
// APIs will respond. The standard workaround: hit the homepage first to
// collect cookies, then reuse them on the actual API call.
//
// This is the least reliable data source in this app — NSE can and does
// tighten this protection, and cloud IPs (like Vercel's) get blocked more
// aggressively than residential ones. Every caller of this module should
// degrade gracefully (show "unavailable") rather than fail the whole page.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Do the homepage cookie handshake and return the cookie string. Exported
 * (in addition to nseApiFetch below) so callers making MANY requests in one
 * batch — e.g. the Delivery tab's market-cap lookups — can fetch the cookie
 * once and reuse it, instead of re-doing the handshake per symbol.
 */
export async function getSessionCookies() {
  const res = await fetch("https://www.nseindia.com/", {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    cache: "no-store",
  });

  // Newer Node/undici exposes all Set-Cookie headers via getSetCookie();
  // fall back to the single-header form if that's not available.
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);

  return raw.map((c) => c.split(";")[0]).join("; ");
}

/**
 * Fetch a JSON endpoint under nseindia.com/api/... using an already-fetched
 * cookie string (see getSessionCookies above). Optional timeoutMs guards
 * against NSE stalling instead of failing fast, same rationale as the
 * Yahoo timeout in app/api/delivery/route.js. Returns null (never throws)
 * on any failure — callers should treat null as "this data source is
 * unavailable right now" rather than a hard error.
 */
export async function nseApiFetchWithCookies(path, cookies, timeoutMs) {
  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`https://www.nseindia.com${path}`, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        Referer: "https://www.nseindia.com/",
        Cookie: cookies,
      },
      cache: "no-store",
      signal: controller?.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // covers network errors AND the abort-on-timeout case
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Convenience wrapper for one-off calls: does the cookie handshake and the
 * fetch in one go. Prefer getSessionCookies + nseApiFetchWithCookies
 * directly when making several calls in a row (e.g. a batch loop).
 */
export async function nseApiFetch(path) {
  try {
    const cookies = await getSessionCookies();
    return await nseApiFetchWithCookies(path, cookies);
  } catch {
    return null;
  }
}
