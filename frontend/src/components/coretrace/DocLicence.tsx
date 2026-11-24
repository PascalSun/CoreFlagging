"use client";
// A document's licence, as a small label beside it wherever it is shown (#835): green when it may be used
// commercially, amber when not. It links to the collection's page in the data library, which says why.

import { useEffect, useState } from "react";

const PLATFORM = (process.env.NEXT_PUBLIC_PLATFORM_URL ?? "https://platform.nlp-tlp.org").replace(/\/$/, "");
/** Where the data library is: this site, or the hub when the label is shown by another app. */
const LIBRARY = (process.env.NEXT_PUBLIC_DATA_LIBRARY_URL ?? "https://geo.nlp-tlp.org").replace(/\/$/, "");

/** Where a licence shown wrongly is reported (Groundwork #835). */
const CORRECTIONS = "pascal.sun@research.uwa.edu.au";

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
  const subject = `Licence shown wrongly: ${corpus}${docKey ? ` ${docKey}` : ""}`;
  const body = `The platform shows "${lic.name}" for ${corpus}${docKey ? ` ${docKey}` : ""}.\n\nWhat it should be, and where you read its terms:\n`;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <a href={`${LIBRARY}${lic.url}`} target="_blank" rel="noopener noreferrer" title={`${why} Open the data library for the terms.`}
        className={`inline-flex max-w-[16rem] items-center truncate rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 hover:underline ${tone}`}>
        {lic.name}
      </a>
      {/* a licence we show wrongly is ours to fix: one click to say so, with the document already named */}
      <a href={`mailto:${CORRECTIONS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
        title={`Tell us at ${CORRECTIONS} and we will correct it`}
        className="shrink-0 text-[10.5px] text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline">Wrong licence?</a>
    </span>
  );
}
