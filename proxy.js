import { NextResponse } from "next/server";

// Sign-in gate. A request gets through only with a valid `panel_session`
// cookie — signed with SESSION_SECRET by lib/auth.js. The signature is
// re-checked here (Web Crypto, so it works in any runtime); an edited or
// expired cookie counts as signed out.
//
// Kept self-contained rather than importing lib/auth.js: Next runs Proxy
// separately from the rest of the app and advises against shared modules
// here. The cookie name and token format must match lib/auth.js.
const SESSION_COOKIE = "panel_session";

// Reachable without a session:
// - /login, /api/login: the sign-in screen and endpoint.
// - /admin, /api/admin: gated by their own ADMIN_KEY.
const PUBLIC_PATHS = ["/login", "/api/login", "/admin", "/api/admin"];

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function validSession(token, secret) {
  if (!token || !secret) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "verify",
    ]);
    const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), new TextEncoder().encode(payload));
    if (!ok) return false;
    const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
    return !!data?.u && data.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const secret = process.env.SESSION_SECRET;

  // The app's own server-to-server calls (e.g. lib/screenerFreshness.js
  // refreshing screens for the Delivery tab) carry the secret instead of a
  // user cookie.
  if (secret && request.headers.get("x-panel-internal") === secret) {
    return NextResponse.next();
  }

  if (await validSession(request.cookies.get(SESSION_COOKIE)?.value, secret)) {
    return NextResponse.next();
  }

  // API routes get a plain 401 rather than a redirect, so fetch() callers
  // see "Not signed in" instead of the login page's HTML.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

// Skip static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
