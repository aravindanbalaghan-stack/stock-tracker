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

## SMS price alerts — setup

This needs three things: a small database to remember your alerts, an SMS
account to actually send texts, and something to check prices on a
schedule (since nothing runs while your browser is closed). Here's each
step.

### 1. Add a database (Vercel KV)

1. In your Vercel dashboard, open your project → **Storage** tab.
2. **Create Database** → choose **KV** (built on Upstash Redis, free tier
   is plenty for this).
3. Once created, click **Connect Project** and select this project.
   Vercel automatically adds the required environment variables
   (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, etc.) — you don't need to
   copy/paste anything.
4. Redeploy (Vercel usually prompts you to).

### 2. Get an SMS provider account (Fast2SMS)

1. Sign up at **fast2sms.com** (free trial credit included).
2. Go to **Dev API** in their dashboard → copy your **API key**.
3. In Vercel: Project → **Settings** → **Environment Variables** → add:
   - `FAST2SMS_API_KEY` = your API key
4. This app uses Fast2SMS's "Quick SMS" route, which doesn't require
   DLT sender-ID registration — fine for personal alerts to your own
   number. If you want a custom sender ID / template-based SMS instead,
   that's a small change in `app/api/check-alerts/route.js`.

### 3. Set a secret so strangers can't trigger SMS sends

1. In Vercel: **Settings** → **Environment Variables** → add:
   - `ALERTS_CRON_SECRET` = any random string you make up (e.g. a long
     password — you won't need to remember it, just paste it in both
     places below).

### 4. Schedule the price check

Vercel's free Hobby plan only allows cron jobs to run **once a day**,
which isn't often enough to catch a price move during market hours. The
practical fix is a free external scheduler that calls your app's check
endpoint every few minutes:

1. Go to **cron-job.org** (free) and create an account.
2. Create a new cron job:
   - **URL**: `https://your-app.vercel.app/api/check-alerts`
   - **Schedule**: every 5–15 minutes, restricted to roughly 9:00–15:30
     IST on weekdays (market hours) if you want to save on invocations.
   - **Request headers**: add `Authorization: Bearer YOUR_SECRET` (the
     same string you set as `ALERTS_CRON_SECRET`).
3. Save it — that's it, it'll now hit your app on schedule.

(There's also a `vercel.json` cron included that runs this same route
twice daily on Vercel's own scheduler as a backup — but for real
intraday alerting, the external scheduler above is what does the work.)

### Using it

Go to the Watchlist tab → **Price alerts** panel → **+ New alert**. Pick a
stock, a target price, a direction (reaches/crosses above, or drops to/below),
and your phone number with country code (e.g. `+91XXXXXXXXXX`). Once the
target is hit, you'll get a text and the alert marks itself "Sent" (it
won't keep re-texting you for the same alert — remove it and create a new
one if you want to re-arm it).



Prices are for personal tracking only and may be delayed relative to the
exchange. Do not use this app as the sole basis for trading decisions.
