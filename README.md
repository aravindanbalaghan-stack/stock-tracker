# Panel — Live NSE/BSE Watchlist

A personal stock watchlist for Indian equities, built with Next.js. Add any
NSE/BSE-listed stock, see live price, change, day range and volume, with
auto-refresh every 12 seconds.

## How it works

- **Tabs**: Watchlist, Holdings (your actual positions, with P&L), Market,
  Delivery, Screeners, and Sectors (the master stock↔sector list every
  sector calculation in the app reads from — see "Managing sectors"
  below).
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

## Managing sectors

The **Sectors** tab is the single source of truth every sector-based
calculation in the app reads from (the Delivery tab's sector view, each
sector's page, a stock's "Sectors" row, Holdings). The base lists are
hand-maintained in `lib/sectors.js`; the tab lets you layer corrections on
top without editing code:

- **Wrong sector** — remove the bad badge (×) and add the right one from
  the same row.
- **Stock missing entirely** — use "Add a stock not in this list" at the
  top, search or type its symbol, and pick a sector.
- **Export/Import** — Export downloads just your customizations (not the
  full base lists) as JSON; Import replaces your current customizations
  with a file's. Useful for backing them up or moving them to another
  deployment. See `lib/sectorOverrides.js` for exactly what's stored.

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

## Access

Every page and API route requires a `panel_identity` cookie, set by
entering your email or name at `/login`. **This is not real
authentication** — nothing is verified, there's no password, and anyone
with your deployed URL can type any email or name and get in. It exists
so that if you share this with friends, everyone identifies themselves
(mainly so each person's Watchlist and Holdings belong to them, rather
than one shared pool everyone can see and edit).

If you actually want to restrict who can get in — not just ask visitors
to identify themselves — you'd need to add an allowlist check in
`proxy.js` (e.g. against a fixed list of emails in an env var) and
probably real email verification (a magic link via an email-sending
service like Resend). Neither is implemented here.

Note: this app uses **Proxy** (`proxy.js` in the project root), not the
older `middleware.js` convention — this Next.js version renamed it (see
`AGENTS.md` and `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).

### Checking who's logged in

Every submission to `/login` is recorded (identity + timestamp) in Vercel
KV — the same database Watchlist and Holdings use, so you need that set
up too (see below). To view the log:

1. In your Vercel project → **Settings** → **Environment Variables**, add
   `ADMIN_KEY` set to any secret string of your choosing. Redeploy.
2. Visit `/admin/logins` on your deployed app and enter that key (or
   bookmark `/admin/logins?key=YOUR_KEY` to skip re-typing it).

This key is separate from the friend-identity cookie on purpose — since
that cookie can be set to literally anything by anyone, it can't be what
decides who gets to see everyone else's login history. Without `ADMIN_KEY` set, `/admin/logins` just shows an error and nothing
recorded is ever exposed.

## Add a database (Vercel KV)

Watchlist, Holdings, Sectors, accumulation history, and screener-
membership tracking all need a small server-side database to persist
anything beyond a single browser — without it, the app still runs, but
each of those quietly falls back to local-only behavior (or, for Sectors,
refuses to save at all — see "Managing sectors" above).

1. In your Vercel dashboard, open your project → **Storage** tab.
2. **Create Database** → choose **KV** (built on Upstash Redis, free tier
   is plenty for this).
3. Once created, click **Connect Project** and select this project.
   Vercel automatically adds the required environment variables
   (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, etc.) — you don't need to
   copy/paste anything.
4. Redeploy (Vercel usually prompts you to).



Prices are for personal tracking only and may be delayed relative to the
exchange. Do not use this app as the sole basis for trading decisions.
