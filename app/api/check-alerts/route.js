import { listAlerts, markTriggered } from "@/lib/alertsStore";
import { fetchYahooJson } from "@/lib/yahooFinance";

export const dynamic = "force-dynamic";

async function getPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS?interval=1d&range=5d`;
  const data = await fetchYahooJson(url);
  return data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
}

async function sendSms(phone, message) {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) throw new Error("FAST2SMS_API_KEY is not set");

  const digitsOnly = phone.replace(/[^0-9]/g, "").slice(-10); // Fast2SMS wants the 10-digit Indian number, no country code

  const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
    method: "POST",
    headers: {
      authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      route: "q", // "Quick SMS" — no DLT template registration needed, fine for personal alerts
      message,
      language: "english",
      flash: 0,
      numbers: digitsOnly,
    }),
  });

  const result = await res.json();
  if (!res.ok || result?.return !== true) {
    throw new Error(`Fast2SMS error: ${JSON.stringify(result)}`);
  }
  return result;
}

// Vercel automatically sends this header on its own Cron invocations — but
// since Hobby-plan cron can't run more than once a day, this route is meant
// to be called by an external scheduler (e.g. cron-job.org) instead. We
// still check for a shared secret so randoms on the internet can't trigger
// SMS sends (and burn your SMS credits) by hitting this URL.
//
// Fails CLOSED when ALERTS_CRON_SECRET isn't set — a deployer who skips
// that setup step (easy to do; it's step 3 of 4 in the README) previously
// got an endpoint that was wide open AND, since the response below echoed
// back every alert including its phone number, exposed everyone's phone
// numbers and price targets to anyone who found the URL. Without the
// secret configured this route now simply refuses to run — see the README
// "SMS price alerts" section to enable it.
function isAuthorized(request) {
  const secret = process.env.ALERTS_CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    const configured = Boolean(process.env.ALERTS_CRON_SECRET);
    return Response.json(
      {
        error: configured
          ? "Unauthorized"
          : "ALERTS_CRON_SECRET isn't set — see README \"SMS price alerts\" to enable this endpoint.",
      },
      { status: configured ? 401 : 501 }
    );
  }

  try {
    const alerts = await listAlerts();
    const active = alerts.filter((a) => !a.triggered);
    if (active.length === 0) {
      return Response.json({ checked: 0, triggered: 0 });
    }

    // Parallel, matching app/api/quote/route.js's approach — the previous
    // sequential for-await loop here serialized one Yahoo round-trip per
    // unique symbol, which scales badly and risks the external scheduler
    // timing out as the alert list grows.
    const uniqueSymbols = [...new Set(active.map((a) => a.symbol))];
    const priceEntries = await Promise.all(uniqueSymbols.map(async (symbol) => [symbol, await getPrice(symbol)]));
    const prices = Object.fromEntries(priceEntries);

    let triggeredCount = 0;
    const results = [];

    for (const alert of active) {
      const price = prices[alert.symbol];
      // Never echo phone numbers back in the response — this endpoint's
      // JSON is visible to whatever external scheduler calls it (e.g.
      // cron-job.org logs the response body), and a phone number isn't
      // needed to see what the cron run did.
      const { phone, ...alertSummary } = alert;
      if (price == null) {
        results.push({ ...alertSummary, status: "no-price" });
        continue;
      }

      const hit =
        alert.direction === "above" ? price >= alert.targetPrice : price <= alert.targetPrice;

      if (hit) {
        try {
          await sendSms(
            alert.phone,
            `Panel alert: ${alert.symbol} is now ₹${price.toFixed(2)}, ${
              alert.direction === "above" ? "at or above" : "at or below"
            } your target of ₹${alert.targetPrice}.`
          );
          await markTriggered(alert.id);
          triggeredCount++;
          results.push({ ...alertSummary, status: "triggered", price });
        } catch (err) {
          console.error(`check-alerts: SMS send failed for alert ${alert.id} (${alert.symbol}):`, err?.message || err);
          results.push({ ...alertSummary, status: "sms-failed", detail: String(err?.message || err) });
        }
      } else {
        results.push({ ...alertSummary, status: "not-yet", price });
      }
    }

    return Response.json({ checked: active.length, triggered: triggeredCount, results });
  } catch (err) {
    console.error("check-alerts: failed to check alerts:", err?.message || err);
    return Response.json(
      { error: "Failed to check alerts", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
