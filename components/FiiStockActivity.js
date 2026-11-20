"use client";

// Stock page: was this stock part of FII (or DII) buying or selling?
// From the FII / DII bulk & block deals Panel stores nightly (lib/fii.js).
//   <FiiBadge>     one line next to the name: "FII bought ₹80 Cr · 18 Nov"
//   <FiiDealsPanel> the deals themselves, when there are any

import { useEffect, useState } from "react";
import { Panel, SectionTitle } from "@/components/ui/Chrome";

const cache = new Map();
function useFiiStock(symbol) {
  const [state, setState] = useState({ symbol: null, data: null });
  useEffect(() => {
    let cancelled = false;
    const p =
      cache.get(symbol) ??
      fetch(`/api/fii/stock?symbol=${encodeURIComponent(symbol)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    cache.set(symbol, p);
    p.then((data) => !cancelled && setState({ symbol, data }));
    return () => {
      cancelled = true;
    };
  }, [symbol]);
  return state.symbol === symbol ? state.data : undefined;
}

const crore = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr`;
const shortDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export function FiiBadge({ symbol }) {
  const data = useFiiStock(symbol);
  if (!data || data.unavailable || !data.coveredDays) return null;
  const pill = (who, s) => {
    const bought = s.netCr > 0;
    const color = bought ? "var(--gain)" : "var(--loss)";
    return (
      <span
        key={who}
        className="px-1.5 py-0.5 rounded border font-medium"
        style={{ borderColor: color, color }}
        title={`${who} bulk/block deals in the last ~4 months: net ${crore(s.netCr)} across ${s.deals} deal${s.deals === 1 ? "" : "s"}, last on ${s.last}`}
      >
        {who} {bought ? "bought" : "sold"} {crore(Math.abs(s.netCr)).replace("+", "")} · {shortDate(s.last)}
      </span>
    );
  };
  const out = [data.fii?.all && pill("FII", data.fii.all), data.dii?.all && pill("DII", data.dii.all)].filter(Boolean);
  if (!out.length)
    return (
      <span className="px-1.5 py-0.5 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }} title="No bulk or block deals by FIIs or DIIs in this stock in the last ~4 months">
        No FII/DII deals
      </span>
    );
  return <>{out}</>;
}

export function FiiDealsPanel({ symbol }) {
  const data = useFiiStock(symbol);
  if (!data?.deals?.length) return null;
  const line = (who, s) =>
    s ? (
      <span style={{ color: s.netCr > 0 ? "var(--gain)" : "var(--loss)" }}>
        {who} net {s.netCr > 0 ? "buyers" : "sellers"} {crore(s.netCr)}
      </span>
    ) : (
      <span style={{ color: "var(--text-faint)" }}>no {who} deals</span>
    );
  return (
    <div>
      <SectionTitle meta="Bulk & block deals, last ~4 months">FII / DII activity</SectionTitle>
      <Panel>
        <p className="text-xs mb-2 flex flex-wrap gap-x-4 gap-y-1">
          <span style={{ color: "var(--text-muted)" }}>Last month:</span> {line("FII", data.fii?.m1)} {line("DII", data.dii?.m1)}
          <span style={{ color: "var(--text-muted)" }}>3 months:</span> {line("FII", data.fii?.m3)} {line("DII", data.dii?.m3)}
        </p>
        <table className="w-full text-xs border-collapse">
          <tbody>
            {data.deals.slice(0, 12).map((x, i) => (
              <tr key={`${x.d}-${i}`} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-1.5 pr-2 font-mono whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{x.d}</td>
                <td className="py-1.5 px-2 font-medium" style={{ color: x.w === "FII" ? "#3b82f6" : "#f59e0b" }}>{x.w}</td>
                <td className="py-1.5 px-2" style={{ color: x.side === "B" ? "var(--gain)" : "var(--loss)" }}>{x.side === "B" ? "Bought" : "Sold"}</td>
                <td className="py-1.5 px-2 truncate max-w-[16rem]" style={{ color: "var(--text)" }} title={x.c}>{x.c}</td>
                <td className="py-1.5 px-2 text-right font-mono whitespace-nowrap">{x.q.toLocaleString("en-IN")} @ ₹{x.p.toLocaleString("en-IN")}</td>
                <td className="py-1.5 pl-2 text-right font-mono whitespace-nowrap">₹{x.cr.toLocaleString("en-IN")} Cr</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] mt-2" style={{ color: "var(--text-faint)" }}>
          FII / DII is read from the client&apos;s name in NSE&apos;s deal records — the big, disclosed trades only.
        </p>
      </Panel>
    </div>
  );
}
