// Makes Panel installable ("Add to Home Screen" / "Install app"), opening
// full-screen like a native app. Served at /manifest.webmanifest.
export default function manifest() {
  return {
    name: "Panel — Indian stock market analysis",
    short_name: "Panel",
    description: "Watchlist, screeners, breadth, rotation, portfolio analytics and alerts for NSE stocks.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#080b13",
    theme_color: "#080b13",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Watchlist", url: "/?tab=watchlist" },
      { name: "Holdings", url: "/?tab=holdings" },
      { name: "Screeners", url: "/?tab=screeners" },
      { name: "Alerts", url: "/?alerts=1" },
    ],
  };
}
