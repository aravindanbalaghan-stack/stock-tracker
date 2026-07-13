# Panel — Live NSE/BSE Watchlist

A personal stock watchlist for Indian equities, built with Next.js. Add any
NSE/BSE-listed stock, see live price, change, day range and volume, with
auto-refresh every 12 seconds.

## How it works

- **Frontend**: Next.js (App Router) + Tailwind, plain React state.
- **Live data**: two server-side API routes (`/api/quote`, `/api/search`)
  proxy Yahoo Finance's public quote/search endpoints. Doing the fetch on
  the server avoids browser CORS issues and keeps things simple — no API
  key needed.
- **Your watchlist** is saved in your browser's `localStorage`, so it's
  personal to your device and needs no login or database. Clearing browser
  data resets it to the default list.
- **Refresh rate**: 12s polling. Yahoo's feed for NSE is close to real-time
  during market hours (typically low double-digit seconds of lag) — it is
  not the same as a paid Level-1/tick-by-tick broker feed. See "Upgrading
  to true real-time" below if you need that.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. Go to vercel.com → New Project → import the repo.
3. No environment variables are required — click Deploy.
4. Vercel builds and hosts it; the two API routes become serverless
   functions automatically.

(You can also run `npx vercel` from inside this folder if you have the
Vercel CLI installed.)

## Customizing

- **Default watchlist**: edit `DEFAULT_WATCHLIST` in `lib/watchlist.js`.
- **Refresh interval**: edit `REFRESH_MS` in `app/page.js`.
- **Colors/fonts**: design tokens are CSS variables at the top of
  `app/globals.css` (`--bg`, `--accent`, `--gain`, `--loss`, etc.) — change
  those to re-theme the whole app.
- **Columns shown**: `components/WatchlistTable.js` — add/remove `<td>`s,
  the quote objects already carry `dayHigh`, `dayLow`, `volume`,
  `previousClose`, `marketState`.
- **BSE instead of NSE for a symbol**: pass the symbol with `.BO` suffix
  (e.g. `RELIANCE.BO`) when adding — the API route respects an explicit
  suffix and defaults to `.NS` otherwise.

## Upgrading to true real-time (optional, later)

Yahoo's feed is unofficial and can be delayed or rate-limited. If you later
want tick-level real-time data (e.g. for intraday trading decisions), the
practical paths are:

- **Broker APIs** (need a demat/trading account): Zerodha Kite Connect,
  Upstox API, ICICI Breeze — free or low-cost, real WebSocket ticks.
- **Paid data vendors**: TrueData, Global Datafeeds — dedicated market data
  without needing a broker account, priced per month.

Swapping either in only requires changing `app/api/quote/route.js` — the
rest of the app (UI, polling, watchlist) stays the same.

## Disclaimer

Prices are for personal tracking only and may be delayed relative to the
exchange. Do not use this app as the sole basis for trading decisions.
