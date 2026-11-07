"use client";

// Stock page → Your data: the details imported for this stock on the
// Stock Data tab (sector, industry, market cap, your own columns).

import { useEffect, useState } from "react";
import Link from "next/link";
import { SectionTitle, Panel } from "@/components/ui/Chrome";

export default function StockMasterPanel({ symbol }) {
  const [loaded, setLoaded] = useState({ key: null, rec: null });
  const rec = loaded.key === symbol ? loaded.rec : null;

  useEffect(() => {
    let alive = true;
    fetch(`/api/stock-master?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setLoaded({ key: symbol, rec: j?.record ?? null }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [symbol]);

  if (!rec) return null;
  const items = [
    ["Name", rec.name],
    ["Sector", rec.sectors?.join(", ")],
    ["Industry", rec.industry],
    ["Market cap", rec.marketCapCr != null ? `₹${Number(rec.marketCapCr).toLocaleString("en-IN")} Cr` : null],
    ...Object.entries(rec.custom ?? {}),
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!items.length) return null;

  return (
    <div>
      <SectionTitle meta={<Link href="/?tab=data" className="hover:underline">Edit on the Stock Data tab</Link>}>Your data</SectionTitle>
      <Panel>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-3">
          {items.map(([k, v]) => (
            <div key={k}>
              <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
                {k}
              </p>
              <p className="text-sm" style={{ color: "var(--text)" }}>
                {String(v)}
              </p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
