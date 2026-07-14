import { listAlerts, markTriggered } from "@/lib/alertsStore";

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function getPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS?interval=1d&range=5d`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
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
function isAuthorized(request) {
  const secret = process.env.ALERTS_CRON_SECRET;
  if (!secret) return true; // not configured — allow (see README to lock this down)
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const alerts = await listAlerts();
    const active = alerts.filter((a) => !a.triggered);
    if (active.length === 0) {
      return Response.json({ checked: 0, triggered: 0 });
    }

    const uniqueSymbols = [...new Set(active.map((a) => a.symbol))];
    const prices = {};
    for (const symbol of uniqueSymbols) {
      prices[symbol] = await getPrice(symbol);
    }

    let triggeredCount = 0;
    const results = [];

    for (const alert of active) {
      const price = prices[alert.symbol];
      if (price == null) {
        results.push({ ...alert, status: "no-price" });
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
          results.push({ ...alert, status: "triggered", price });
        } catch (err) {
          results.push({ ...alert, status: "sms-failed", detail: String(err?.message || err) });
        }
      } else {
        results.push({ ...alert, status: "not-yet", price });
      }
    }

    return Response.json({ checked: active.length, triggered: triggeredCount, results });
  } catch (err) {
    return Response.json(
      { error: "Failed to check alerts", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
