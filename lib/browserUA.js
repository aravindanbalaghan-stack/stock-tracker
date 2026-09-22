// A single realistic desktop-Chrome User-Agent, reused by every server-
// side fetch in this app that talks to a third party that blocks
// non-browser requests (Yahoo Finance, NSE, Zerodha's public sector
// pages, Google News RSS). Previously this exact string was copy-pasted
// into 16 separate files — this is the one place to change it.
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
