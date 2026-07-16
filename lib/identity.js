// Casual identity for sharing this app with friends — NOT real
// authentication. Anyone with the link can type any email or name on the
// /login screen and get in; nothing is verified and there's no password.
// It exists so visitors identify themselves (e.g. so SMS price alerts
// belong to the person who created them, rather than one shared pool
// everyone can see/edit/delete). See README "Access".
//
// proxy.js duplicates this constant as a literal string rather than
// importing it — Next's docs note Proxy runs separately from the rest of
// the app and warn against relying on shared modules there, so the two
// are intentionally kept independent. If you ever rename this cookie,
// update the string in proxy.js too.
export const IDENTITY_COOKIE = "panel_identity";

export function readIdentityCookie() {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${IDENTITY_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
