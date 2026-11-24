"use client";
// A document's licence, as a small label beside it wherever it is shown (#835): green when it may be used
// commercially, amber when not. It links to the collection's page in the data library, which says why.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const PLATFORM = (process.env.NEXT_PUBLIC_PLATFORM_URL ?? "https://platform.nlp-tlp.org").replace(/\/$/, "");
/** Where the data library is: this site, or the hub when the label is shown by another app. */
const LIBRARY = (process.env.NEXT_PUBLIC_DATA_LIBRARY_URL ?? "https://geo.nlp-tlp.org").replace(/\/$/, "");

export type DocLicence = { name: string; commercial: boolean; status: string; source: string; url: string };

const cache = new Map<string, Promise<DocLicence | null>>();
function load(corpus: string, key?: string | null): Promise<DocLicence | null> {
  const k = `${corpus}|${key ?? ""}`;
  let p = cache.get(k);
  if (!p) {
    const q = `corpus=${encodeURIComponent(corpus)}${key ? `&key=${encodeURIComponent(key)}` : ""}`;
    p = fetch(`${PLATFORM}/geo/api/doc/licence/?${q}`).then((r) => (r.ok ? r.json() as Promise<DocLicence> : null)).catch(() => null);
    cache.set(k, p);
  }
  return p;
}

const WORDS: Record<string, string> = {
  confirmed: "stated on the document or its collection",
  site: "from the agency's site-wide notice",
  unconfirmed: "not confirmed: held for research",
  per_item: "varies by document",
};

/** The licence of one document (key) or of a whole collection (no key). Nothing while loading or when unknown. */
export function DocLicenceTag({ corpus, docKey, className = "" }: { corpus?: string | null; docKey?: string | null; className?: string }) {
  const [lic, setLic] = useState<DocLicence | null>(null);
  useEffect(() => {
    let live = true;
    if (corpus) load(corpus, docKey).then((l) => { if (live) setLic(l); });
    return () => { live = false; };
  }, [corpus, docKey]);
  if (!lic?.name) return null;
  const tone = lic.commercial ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200";
  const why = `${lic.name}${lic.source ? ` · ${lic.source}` : ""}${WORDS[lic.status] ? ` (${WORDS[lic.status]})` : ""}${lic.commercial ? "" : ". Not for commercial use."}`;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <a href={`${LIBRARY}${lic.url}`} target="_blank" rel="noopener noreferrer" title={`${why} Open the data library for the terms.`}
        className={`inline-flex max-w-[16rem] items-center truncate rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 hover:underline ${tone}`}>
        {lic.name}
      </a>
      {/* a licence we show wrongly is ours to fix: one click to say so, with the document already named */}
      <LicenceReport corpus={corpus ?? ""} docKey={docKey} lic={lic} />
    </span>
  );
}


/** "Wrong licence?": a short report to the platform's issue queue, the same one the data map's "Report an issue"
 *  uses (POST /community/api/issues/, open to anyone), with the document and the licence shown already named. */
function LicenceReport({ corpus, docKey, lic }: { corpus: string; docKey?: string | null; lic: DocLicence }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [err, setErr] = useState<string | null>(null);
  const label = `licence shown as ${lic.name} on ${corpus}${docKey ? ` ${docKey}` : ""}`;
  const send = async () => {
    setState("sending"); setErr(null);
    try {
      const r = await fetch(`${PLATFORM}/community/api/issues/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset: lic.url.replace(/^\/data\//, ""), item_kind: "licence", item_label: label.slice(0, 200),
                               message, email: email || undefined, page: window.location.href }),
      });
      if (!r.ok) throw new Error(`the platform said ${r.status}`);
      setState("sent");
    } catch (e) { setErr((e as Error).message); setState("idle"); }
  };
  const close = () => { setOpen(false); setState("idle"); setMessage(""); setErr(null); };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Tell us and we will correct it"
        className="shrink-0 text-[10.5px] text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline">Wrong licence?</button>
      {open && typeof document !== "undefined" && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Report a licence shown wrongly" onClick={close}
          className="fixed inset-0 z-[300] grid place-items-center bg-black/40 p-4">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-5 text-left text-slate-800 shadow-xl ring-1 ring-black/10">
            <p className="text-[17px] font-semibold text-slate-900">Licence shown wrongly?</p>
            <p className="mt-1 truncate text-[13px] text-slate-500" title={label}>We show <strong className="font-semibold text-slate-700">{lic.name}</strong> for {corpus}{docKey ? ` ${docKey}` : ""}.</p>
            {state === "sent" ? (
              <>
                <p className="mt-4 text-[14px] text-slate-700">Thanks. We will check it and correct the licence if it is wrong.</p>
                <div className="mt-5 flex justify-end"><button type="button" onClick={close} className="h-9 rounded-full bg-slate-900 px-4 text-[13px] font-semibold text-white hover:bg-slate-700">Done</button></div>
              </>
            ) : (
              <>
                <label className="mt-4 block text-[13px] font-semibold text-slate-700" htmlFor="lic-msg">What should it be, and where did you read its terms?</label>
                <textarea id="lic-msg" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={2000}
                  placeholder="e.g. The report says CC BY 4.0 on page 2; the agency's terms page is …"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[14px] text-slate-800 outline-none focus:border-slate-500" />
                <label className="mt-3 block text-[13px] font-semibold text-slate-700" htmlFor="lic-email">Your email <span className="font-normal text-slate-500">(optional, so we can reply)</span></label>
                <input id="lic-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[14px] text-slate-800 outline-none focus:border-slate-500" />
                {err && <p className="mt-2 text-[12.5px] text-rose-600">Could not send: {err}</p>}
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={close} className="h-9 rounded-full px-4 text-[13px] font-semibold text-slate-700 ring-1 ring-slate-300 hover:ring-slate-500">Cancel</button>
                  <button type="button" onClick={send} disabled={!message.trim() || state === "sending"}
                    className="h-9 rounded-full bg-slate-900 px-4 text-[13px] font-semibold text-white hover:bg-slate-700 disabled:opacity-40">{state === "sending" ? "Sending…" : "Send"}</button>
                </div>
              </>
            )}
          </div>
        </div>, document.body)}
    </>
  );
}
