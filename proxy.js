import { NextResponse } from "next/server";

// Casual identity gate — NOT real authentication. See lib/identity.js and
// README "Access" for the full explanation. Cookie name duplicated here
// as a literal (rather than imported from lib/identity.js) because Proxy
// is documented to run separately from the rest of the app; don't rely on
// shared modules here. Keep this string in sync with lib/identity.js.
const IDENTITY_COOKIE = "panel_identity";

// Routes that must stay reachable without an identity cookie:
// - /login and /api/login: the login screen itself and the endpoint that
//   sets the cookie — gating these would make it impossible to ever log in.
// - /api/check-alerts: called by an external cron (see that route's own
//   ALERTS_CRON_SECRET check), not by a browser with a session cookie.
const PUBLIC_PATHS = ["/login", "/api/login", "/api/check-alerts"];

export function proxy(request) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const identity = request.cookies.get(IDENTITY_COOKIE)?.value;
  if (identity) return NextResponse.next();

  // API routes get a plain 401 rather than a redirect — redirecting a
  // fetch() call to the login page's HTML would otherwise show up to the
  // frontend as a confusing JSON-parse failure instead of a clear "not
  // signed in".
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

// Skip static assets — no need to gate CSS/JS/images, and gating them
// unintentionally is a common way to break an app's own styling.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
