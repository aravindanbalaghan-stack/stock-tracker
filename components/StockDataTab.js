"use client";

// Stock Data — export everything Panel knows about every stock, fill in
// or correct details (sector, industry, market cap, name, plus any columns
// of your own) in Excel / a CSV / JSON, and import it back. Imported data
// is used across the app — see lib/stockMaster.js.

import { useEffect, useRef, useState } from "react";
import { ScreenHeader, SectionTitle, Panel, ErrorState } from "@/components/ui/Chrome";
import { parseTableFile, downloadTable } from "@/lib/tabularFile";

const FORMATS = [
  { id: "xlsx", label: "Excel" },
  { id: "csv", label: "CSV" },
  { id: "json", label: "JSON" },
];

function Btn({ children, primary, ...props }) {
  return (
    <button
      type="button"
      {...props}
      className="text-xs px-3 py-1.5 rounded border font-medium disabled:opacity-40"
      style={primary ? { background: "var(--accent)", color: "var(--bg)", borderColor: "var(--accent)" } : { borderColor: "var(--border)", color: "var(--text)" }}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
        {label}
      </p>
      <p className="font-mono text-sm" style={{ color: tone ?? "var(--text)" }}>
        {value}
      </p>
    </div>
  );
}

export default function StockDataTab() {
  const [info, setInfo] = useState(null);
  const [exporting, setExporting] = useState(null);
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mode, setMode] = useState("merge");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const inputRef = useRef(null);

  const loadInfo = () =>
    fetch("/api/stock-master")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo(null));
  useEffect(() => {
    loadInfo();
  }, []);

  async function doExport(format) {
    setError(null);
    setExporting(format);
    try {
      const res = await fetch("/api/stock-master?export=1");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Export failed");
      const readme = [
        { column: "symbol", use: "Required on import. NSE symbol." },
        { column: "name", use: "Editable — company name." },
        { column: "sector", use: "Editable — the stock is placed in exactly these sectors everywhere in Panel. Several? Separate with ;  A new name creates a new sector." },
        { column: "industry", use: "Editable — shown on the stock page." },
        { column: "marketCapCr", use: "Editable — market cap in ₹ crore; used instead of asking NSE (e.g. the ₹100 Cr floor on screens)." },
        { column: "(any new column)", use: "Add your own columns (e.g. Theme, Conviction, Notes). They're saved, shown on the stock page and included in exports." },
        { column: "currentSectors … avgDelivery20Pct", use: "Read-only — what Panel currently has. Ignored on import." },
        { column: "Blank cells", use: "In Merge mode a blank cell keeps the value already saved." },
      ];
      await downloadTable(json.rows, json.columns, {
        format,
        baseName: `panel-stocks-${json.asOf ?? "latest"}`,
        sheetName: "Stocks",
        extraSheets: [{ name: "How to edit", rows: readme, columns: ["column", "use"] }],
        jsonExtra: { asOf: json.asOf, editableColumns: json.editableColumns, readOnlyColumns: json.readOnlyColumns },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(null);
    }
  }

  async function runImport(dryRun, rows = parsed?.rows, importMode = mode) {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stock-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, mode: importMode, dryRun }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Import failed");
      if (dryRun) setPreview(json);
      else {
        setDone(json);
        setPreview(null);
        setParsed(null);
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        loadInfo();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onPick(f) {
    setError(null);
    setPreview(null);
    setDone(null);
    setFile(f);
    if (!f) return setParsed(null);
    try {
      const p = await parseTableFile(f);
      if (!p.rows.length) throw new Error("No rows found in that file");
      setParsed(p);
      runImport(true, p.rows, mode);
    } catch (err) {
      setParsed(null);
      setError(err.message);
    }
  }

  async function clearAll() {
    if (!window.confirm("Delete ALL imported stock data? Sectors and market caps go back to Panel's built-in values.")) return;
    await fetch("/api/stock-master", { method: "DELETE" });
    setDone(null);
    loadInfo();
  }

  return (
    <div>
      <ScreenHeader
        title="Stock Data"
        meta={
          info?.count
            ? `${info.count.toLocaleString("en-IN")} stocks with imported details · last import ${new Date(info.updatedAt).toLocaleString("en-IN")}`
            : "No imported details yet — Panel is using its built-in sector lists and NSE market caps"
        }
      />

      {error && !file && (
        <div className="mb-4">
          <ErrorState>{error}</ErrorState>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle>1 · Export</SectionTitle>
          <Panel>
            <p className="text-xs leading-relaxed mb-3" style={{ color: "var(--text-muted)" }}>
              Downloads every NSE stock with everything Panel has for it: name, ISIN, listing date, face value, current sectors,
              latest close, turnover and delivery (and 20-day averages), plus any details you&apos;ve imported. The Excel file has a
              second sheet explaining each column.
            </p>
            <div className="flex gap-2 flex-wrap">
              {FORMATS.map((f) => (
                <Btn key={f.id} primary={f.id === "xlsx"} disabled={!!exporting} onClick={() => doExport(f.id)}>
                  {exporting === f.id ? "Preparing…" : `Export ${f.label}`}
                </Btn>
              ))}
            </div>
          </Panel>

          <div className="mt-6">
            <SectionTitle>2 · Edit</SectionTitle>
            <Panel>
              <ul className="text-xs leading-relaxed list-disc pl-4 flex flex-col gap-1" style={{ color: "var(--text-muted)" }}>
                <li>
                  Fill or fix <b style={{ color: "var(--text)" }}>sector</b>, <b style={{ color: "var(--text)" }}>industry</b>,{" "}
                  <b style={{ color: "var(--text)" }}>marketCapCr</b> (₹ crore) and <b style={{ color: "var(--text)" }}>name</b>. Several
                  sectors: separate with <code>;</code>
                </li>
                <li>Add any columns of your own — they&apos;re kept, shown on the stock page and exported back.</li>
                <li>Delete rows you don&apos;t want to change, or leave cells blank — blanks keep what&apos;s saved.</li>
                <li>Columns like lastClose and currentSectors are live figures and are ignored on import.</li>
              </ul>
            </Panel>
          </div>
        </div>

        <div>
          <SectionTitle>3 · Import</SectionTitle>
          <Panel>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              {/* Hidden native input, opened by the buttons below so it's obvious where to click. */}
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.json"
                onChange={(e) => onPick(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <Btn onClick={() => inputRef.current?.click()}>{file ? "Choose a different file" : "Choose file…"}</Btn>
              <span className="text-xs font-mono truncate max-w-[14rem]" style={{ color: file ? "var(--text)" : "var(--text-faint)" }}>
                {file ? file.name : "No file chosen (.xlsx, .csv or .json)"}
              </span>
              <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                Mode
                <select
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value);
                    if (parsed) runImport(true, parsed.rows, e.target.value);
                  }}
                  className="rounded px-2 py-1 text-xs border"
                  style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
                >
                  <option value="merge">Merge — update what&apos;s in the file</option>
                  <option value="replace">Replace — wipe and use only this file</option>
                </select>
              </label>
            </div>

            {file && !preview && !error && (
              <p className="text-xs mb-3" style={{ color: "var(--text-faint)" }}>
                {parsed ? `Checking ${parsed.rows.length.toLocaleString("en-IN")} rows…` : `Reading ${file.name}…`}
              </p>
            )}
            {error && file && (
              <p className="text-xs mb-3" style={{ color: "var(--loss)" }}>
                {error}
              </p>
            )}

            {preview && (
              <div className="rounded-[var(--radius-sm)] p-3 mb-3" style={{ background: "var(--surface-2)" }}>
                <p className="text-xs mb-2" style={{ color: "var(--text)" }}>
                  Preview of <span className="font-mono">{file?.name}</span> — nothing saved yet
                </p>
                <div className="grid grid-cols-3 gap-3 mb-2">
                  <Stat label="Rows" value={preview.rows.toLocaleString("en-IN")} />
                  <Stat label="New" value={preview.added.toLocaleString("en-IN")} tone="var(--gain)" />
                  <Stat label="Updated" value={preview.updated.toLocaleString("en-IN")} tone="var(--accent)" />
                  <Stat label="Unchanged / blank" value={preview.skipped.toLocaleString("en-IN")} />
                  <Stat label="Not on NSE today" value={preview.unknownSymbols.toLocaleString("en-IN")} tone={preview.unknownSymbols ? "var(--tier-mid)" : undefined} />
                  <Stat label="Total after" value={preview.totalAfter.toLocaleString("en-IN")} />
                </div>
                <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  Symbol column: <b>{preview.symbolColumn}</b>
                  {Object.keys(preview.columnsUsed).length > 0 && <> · used: {Object.entries(preview.columnsUsed).map(([f, h]) => `${h} → ${f}`).join(", ")}</>}
                  {preview.customColumns.length > 0 && <> · your columns: {preview.customColumns.join(", ")}</>}
                  {preview.ignoredColumns.length > 0 && <> · ignored (read-only): {preview.ignoredColumns.join(", ")}</>}
                </p>
                {preview.newSectors.length > 0 && (
                  <p className="text-[11px] mt-1" style={{ color: "var(--tier-mid)" }}>
                    New sectors will be created: {preview.newSectors.join(", ")}
                  </p>
                )}
                {preview.unknownSample.length > 0 && (
                  <p className="text-[11px] mt-1" style={{ color: "var(--text-faint)" }}>
                    Not trading on NSE today (kept anyway): {preview.unknownSample.join(", ")}
                    {preview.unknownSymbols > preview.unknownSample.length ? "…" : ""}
                  </p>
                )}
                {preview.duplicateSymbols > 0 && (
                  <p className="text-[11px] mt-1" style={{ color: "var(--tier-mid)" }}>
                    {preview.duplicateSymbols} symbol(s) appear more than once — the last row wins.
                  </p>
                )}
                {mode === "replace" && (
                  <p className="text-[11px] mt-1" style={{ color: "var(--loss)" }}>
                    Replace mode deletes everything imported before and keeps only this file.
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              {/* Always clickable: with no file yet it opens the file picker;
                  once the preview is ready it saves. */}
              <Btn
                primary
                disabled={busy || (file && !preview && !error)}
                onClick={() => (preview ? runImport(false) : inputRef.current?.click())}
              >
                {busy ? "Working…" : preview ? `Import ${preview.rows.toLocaleString("en-IN")} rows` : "Import…"}
              </Btn>
              {info?.count > 0 && <Btn onClick={clearAll}>Delete imported data</Btn>}
            </div>

            {done && (
              <p className="text-xs mt-3" style={{ color: "var(--gain)" }}>
                Imported: {done.added} new, {done.updated} updated. Sectors, market caps and your columns now apply across Panel
                (screens pick it up on their next run).
              </p>
            )}
          </Panel>

          {info?.customColumns?.length > 0 && (
            <p className="text-[11px] mt-3" style={{ color: "var(--text-faint)" }}>
              Your saved columns: {info.customColumns.join(", ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
