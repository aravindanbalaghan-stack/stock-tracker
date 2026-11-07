// Display-only copy of the signed-in username, readable from the browser
// so the header can show who's signed in. It grants NOTHING: access and
// every personal-data API use the signed, httpOnly `panel_session` cookie
// (lib/auth.js, checked in proxy.js). Must match DISPLAY_COOKIE there.
export const IDENTITY_COOKIE = "panel_identity";

export function readIdentityCookie() {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${IDENTITY_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
