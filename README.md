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

## Stock Data (import / export)

**Stock Data** tab → **Export** (Excel, CSV or JSON) downloads every NSE
stock with everything Panel has for it. Fill in or fix `sector`,
`industry`, `marketCapCr` (₹ crore) and `name`, add any columns of your
own, and **Import** the file back (preview first, then Merge or Replace).
Imported sectors decide which sector each stock is in everywhere in the
app (new sector names create new sectors); imported market caps are used
instead of NSE's lookup; your own columns show on the stock page. See
`lib/stockMaster.js`.

## Journal

**Journal** tab: log trades with stop, target, setup, emotions, mistakes
and a lesson. It shows expectancy, R-multiples, profit factor, drawdown,
what each mistake cost and which setups pay. **Export → AI review pack**
writes a Markdown file with the stats, breakdowns, every trade and a
coaching prompt — upload it to any AI assistant. Also exports CSV / Excel /
JSON and imports the same formats.

## Analysis

**Analysis** tab (next to Journal): one page per trading day — bias and
levels for NIFTY / BANK NIFTY, market context, sectors and themes in focus,
events, trade ideas (trigger / stop / target / thesis), a routine checklist
you can edit, and a post-market review. A market snapshot (indices,
breadth, best/worst sectors and themes) is saved with each day.

Panel grades the analysis against what happened next: each bias call vs
the index's next session (and next 5), each idea by whether it triggered
and whether target or stop came first. The scorecard, 12-week calendar and
observations sit on top. Ideas can be added from any stock's page, carried
forward to the next day, or turned into a draft Journal trade; the Home tab
shows today's plan. **Export → AI review pack** writes a Markdown file with
the scorecard, breakdowns and every day, plus a coaching prompt.

**Stock studies** (second view in Analysis): technical analysis of
individual stocks, several per day — top-down trend per timeframe, stage,
patterns, candle, levels, indicators, volume/delivery, relative strength,
verdict with conviction and horizon, an optional plan, a quality checklist
(several items checked automatically) and notes. **Auto-fill** pulls
Panel's own readings (trends, stage, MAs, RSI, MACD, 52-week position,
ATR, delivery, RS vs NIFTY, swing levels, screens the stock is on) and
saves them with the study. Each study is graded at its horizon and its
plan like an idea; the scorecard breaks accuracy down by verdict, pattern,
stage, conviction and timeframe alignment.

## Events

Upcoming results, dividends, bonuses, splits and other corporate actions
come from NSE's event calendar and corporate-actions feeds (cached 6h). A
small tag appears next to a stock anywhere in the app when it has an event
in the next 14 days; the stock page lists upcoming and recent events.

## Market holidays

Weekends and NSE holidays are never treated as sessions: there's no live
overlay on a holiday, Yahoo's holiday bars are dropped, and the header
shows NSE closed. The calendar merges NSE's holiday list with a built-in
list in `lib/marketHours.js` — add next year's dates there when NSE
publishes them.

## Instant tabs (nightly precompute)

Every "latest session" view — all screeners, the Delivery views (buckets,
sectors, themes, top 20s), Home's sections and picks, and Trading
Suggestions — is computed once per session and stored in Redis
(`lib/precompute.js`). The first open of a view per session computes and
stores it; after that it's instant. Past dates and live (market-hours)
views still compute on demand.

A nightly job warms all of them so even the first open is instant:

1. Vercel → Settings → Environment Variables → add `CRON_SECRET` (any
   long random string), all environments.
2. Redeploy. `vercel.json` schedules `/api/cron/precompute` at 20:00 IST
   (14:30 UTC) Monday–Friday; Vercel sends the secret automatically.
3. The header shows **Data ready · <date>** when it's done. Click it for
   details or **Prepare now** to run it by hand.

The job runs a few views at a time and hands over to a fresh invocation
if it runs short of time, so it fits Vercel's function limits.

## Stock chart

The stock page has an interactive chart (TradingView lightweight-charts):
daily or weekly candles, volume, moving averages, and Panel's own
overlays — where its screeners fired, results/dividends/splits, your
Journal entries and exits (plus stop/target of open trades), your
Analysis ideas, study levels and your holding's average price.

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
