import "./globals.css";
import CommandPalette from "@/components/CommandPalette";
import AlertsPanel from "@/components/AlertsPanel";
import { THEME_BOOT } from "@/lib/theme";

export const metadata = {
  title: "Panel | NSE/BSE Watchlist",
  description: "Watchlist, screeners, breadth, rotation, portfolio analytics and alerts for Indian equities.",
  applicationName: "Panel",
  appleWebApp: { capable: true, title: "Panel", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#080b13" },
  ],
};

export default function RootLayout({ children }) {
  return (
    // data-theme is set before paint by THEME_BOOT; the server can't know
    // it, hence suppressHydrationWarning on <html> only.
    <html lang="en-IN" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
        <CommandPalette />
        <AlertsPanel />
      </body>
    </html>
  );
}
