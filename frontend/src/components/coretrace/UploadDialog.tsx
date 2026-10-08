"use client";

import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { CoreError, uploadScan, type HoleRow } from "@/lib/coreScan";
import { cn } from "@/lib/utils";

const GB = 1024 ** 3;

/** Upload one hole's scan: a zip of TSG files. The name defaults to the file name. */
export function UploadDialog({ open, onClose, onQueued, onNeedVerify }: {
  open: boolean; onClose: () => void; onQueued: (h: HoleRow) => void; onNeedVerify: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [frac, setFrac] = useState(0);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  if (!open) return null;

  const pick = (f: File | undefined) => {
    if (!f) return;
    setError("");
    if (!/\.zip$/i.test(f.name)) { setError("Choose a .zip file. Zip the hole's TSG files together first."); return; }
    if (f.size > 6 * GB) { setError("The file is larger than the 6 GB limit. Leave the tray photographs out of the zip, or contact us."); return; }
    setFile(f); if (!name) setName(f.name.replace(/\.zip$/i, "").replace(/_tsg$/i, "").slice(0, 96));
  };
  const send = async () => {
    if (!file || !name.trim()) return;
    setBusy(true); setError(""); setFrac(0);
    try {
      const h = await uploadScan(name.trim(), file, setFrac);
      setFile(null); setName(""); onQueued(h);
    } catch (e) {
      const err = e as CoreError;
      if (err.status === 403) onNeedVerify();
      else setError(err.status === 401 ? "Your session expired. Sign in again, then upload." : err.message);
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm" role="dialog" aria-modal aria-label="Upload a scan">
      <div className="w-full max-w-lg rounded-2xl border border-white/60 bg-white p-5 shadow-glass">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-base font-semibold text-slate-900">Upload a scan</h2><p className="text-xs text-slate-500">One drillhole. It stays private to your account.</p></div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40"><X size={16} /></button>
        </div>
        <button type="button" disabled={busy} onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
          className={cn("mt-4 flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors",
            over ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-400")}>
          <Upload size={20} className="text-slate-500" />
          <span className="text-sm font-medium text-slate-900">{file ? file.name : "Drop the zip here, or click to choose"}</span>
          <span className="text-xs text-slate-500">{file ? `${(file.size / 1024 ** 2).toFixed(0)} MB` : "Up to 6 GB"}</span>
        </button>
        <input ref={input} type="file" accept=".zip,application/zip" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <label className="mt-4 block text-xs font-medium text-slate-700">Hole name
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} maxLength={96} placeholder="e.g. DDH-001"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-900" />
        </label>
        <details className="mt-3 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">What goes in the zip</summary>
          <p className="pt-1.5 leading-relaxed">The TSG files of the hole, as The Spectral Geologist saves them or as NVCL packages them: <code className="rounded bg-slate-100 px-1">NAME_tsg.tsg</code> and <code className="rounded bg-slate-100 px-1">NAME_tsg.bip</code>, plus <code className="rounded bg-slate-100 px-1">NAME_tsg_tir.tsg</code> and <code className="rounded bg-slate-100 px-1">.bip</code> if thermal infrared was scanned. Tray photographs (<code className="rounded bg-slate-100 px-1">NAME_0001.jpg</code> …) are optional. No assays, logging or thermal infrared are needed. Chips and cuttings are not supported: the models were trained on continuous core.</p>
        </details>
        {busy && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-slate-600"><span>Uploading…</span><span className="font-mono">{Math.round(frac * 100)}%</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-900 transition-[width]" style={{ width: `${frac * 100}%` }} /></div>
            <p className="pt-1 text-[11px] text-slate-500">Keep this tab open until the upload finishes. Processing then carries on by itself.</p>
          </div>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40">Cancel</button>
          <button type="button" onClick={send} disabled={busy || !file || !name.trim()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40">Upload and process</button>
        </div>
      </div>
    </div>
  );
}
