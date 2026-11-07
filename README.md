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
3. Click Deploy, then follow "Set up storage and sign-in" below — the
   app needs a database and a `SESSION_SECRET` before anyone can sign in.
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

## Set up storage and sign-in

Panel needs two things on Vercel before Watchlist, Holdings, Top 5,
Sectors and sign-in work: an **Upstash Redis** database and a
**SESSION_SECRET**. Do these once.

### 1. Connect an Upstash Redis database

Vercel's old "KV" product was retired; its replacement is Upstash Redis
from the Vercel Marketplace (free tier is plenty).

1. Vercel dashboard → your project → **Storage** tab.
2. **Create Database** (or **Browse Marketplace**) → **Upstash** →
   **Upstash for Redis** → choose the free plan and a region close to you
   (e.g. Mumbai / `ap-south-1`) → Create.
3. On the database page, **Connect Project** → pick this project → tick
   **Production**, **Preview** and **Development** → Connect.
   Leave the "custom prefix" field empty.
4. Check **Settings → Environment Variables**: you should now see
   `KV_REST_API_URL` and `KV_REST_API_TOKEN` (plus a few others).

The app also accepts `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
(a database made directly on upstash.com) or a custom-prefixed pair like
`STORAGE_KV_REST_API_URL` — see `lib/kv.js`.

### 2. Add SESSION_SECRET (and optionally SIGNUP_CODE)

**Settings → Environment Variables → Add**, for all environments:

| Name | Value |
| --- | --- |
| `SESSION_SECRET` | A long random string, 32+ characters. Generate one with `openssl rand -base64 48`, or any password generator. It signs every sign-in cookie — keep it private, and changing it signs everyone out. |
| `SIGNUP_CODE` (optional) | Any word or phrase. If set, creating an account needs this code — give it only to people you want using the app. |
| `ADMIN_KEY` (optional) | Enables `/admin/logins` (see below). |

### 3. Redeploy

**Deployments** → latest → **⋯ → Redeploy**. Environment variables only
apply to new deployments.

### 4. Create your account

Open the app → **Create account**. If you used Panel before with just a
name, create the account with **that same name** — the watchlist,
holdings and Top 5 saved under it carry over, and anything that was only
in your browser is uploaded to your account the first time you load
Watchlist and Holdings.

### How sign-in works

- Accounts are username + password. Passwords are stored only as salted
  scrypt hashes (`lib/auth.js`).
- Signing in sets an httpOnly cookie signed with `SESSION_SECRET`, valid
  for 30 days. `proxy.js` checks the signature on every request, so a
  cookie can't be edited to become someone else.
- Watchlist and Holdings are keyed by the signed-in username on the
  server, so the same account shows the same data on every device.
- 8 wrong passwords lock that username for 15 minutes.
- Change your password from **Password** in the header.

Note: this app uses **Proxy** (`proxy.js` in the project root), not the
older `middleware.js` convention — this Next.js version renamed it.

### Checking who's logged in

Every successful sign-in is recorded (username + timestamp). Set
`ADMIN_KEY` to a secret string, redeploy, then visit `/admin/logins`
and enter that key.

Prices are for personal tracking only and may be delayed relative to the
exchange. Do not use this app as the sole basis for trading decisions.

## Trendline breakout screen

Screeners → **Trendline breakout** finds weekly breakouts above a long
falling trendline out of a base, judged against the 30-week MA: a spike
into a peak, a 20+ week downtrend with at least 3 trendline touches, a base
(ideally with a shakeout under support), then a weekly close 2%+ above the
line on 1.5×+ volume while price is at or above a rising or flattening
30-week MA. Rows are tagged Fresh breakout / Retest / Follow-through, or
Extended when more than 20% above the breakout level, and scored out of 100.
Click a row for the peak, base, breakout, MA and stop levels.

- Logic: `lib/trendlineBreakout.js` (all thresholds in `TLB` at the top)
- Wiring: `runTrendlineBreakoutScreen` in `app/api/screeners/route.js`
- Self-check: `node --no-warnings scripts/test-trendline-breakout.mjs`
  (synthetic charts + 1,500 randomised runs)
- Uses the same cached 2-year weekly Yahoo bars and ~500-stock universe as
  the Weinstein screen. BSE-only stocks are not covered: the app's universe
  comes from NSE bhavcopy.
