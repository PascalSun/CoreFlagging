"use client";

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** Where each colour scheme on the site comes from, so a reader can judge it and cite it. */
export const COLOUR_NOTES = {
  rock: {
    title: "Rock colours: GSWA's bedrock map",
    body: "The logged rock classes wear the colours GSWA gives units of that rock type on the 1:500 000 Interpreted bedrock geology of Western Australia (DASC, CC BY 4.0): the fill most often used for each rock type across the map's 1,537 unit codes — granitoids pink, mafic intrusives mint, mafic volcanics green, felsic volcanics yellow, ultramafics lavender, siliciclastics pale grey, chemical sediments and iron formation sky blue, metamorphics grey-green. Regolith is our own, the bedrock map having none.",
    link: { href: "https://dasc.dmirs.wa.gov.au/download/file/3472", label: "The map and its symbology on DASC (file 3472)" },
  },
  target: {
    title: "Commodity colours and symbols",
    body: "A plain fill is the hole's own record: WA from the DMIRS HyLogger drillhole package (DASC), South Australia from SARIG, Victoria from the Earth Resources bores database. A hatched fill (≈ in the list) is an inference, because the survey records no target on the hole: Queensland and the NT take the commodities of the exploration report or permit the hole belongs to; NSW and Tasmania take the nearest known mineral deposit within 5 km (Geoscience Australia), the project's namesake first. The colours are CoreFlagging's own, with the chemical symbol (Au, Cu, Ni…) on each mark so the colour need not be remembered.",
    link: { href: "https://dasc.dmirs.wa.gov.au/", label: "DASC: Datasets › Interim data › Drillholes › HyLogger drillhole package" },
  },
  rc: {
    title: "Rock Classification colours",
    body: "A rock class (RC) is a cluster of HyFormer's reading; its name only describes what the class is mostly made of. So the classes have colours of their own (Tableau 20, muted beside the minerals' pure TSG hues) rather than a mineral's, which would read as that mineral. Classes of related name share a hue in two shades: the two “Plagioclase + chlorite, more amphibole” greens, the “Quartz + chlorite” blues, the “Quartz + white mica” oranges, the “Quartz (no SWIR response)” browns. A class whose name mixes minerals is hatched over its colour: lines for two (“Quartz + kaolin”), a crosshatch for three (“Quartz + chlorite, more dark mica”); one mineral (“Carbonate”) is solid.",
    link: null,
  },
  mineral: {
    title: "Mineral colours",
    body: "The HyLogger / TSG standard colours for spectral groups, the same as in the NVCL summary reports and any TSG plot: the same colour for the same group on every page, SWIR and TIR alike. Grey is TSG's Invalid (no usable spectrum).",
    link: null,
  },
} as const;

/** A small ⓘ that opens the note for one scheme. */
/** `inline`: the note opens in the flow under the button (in a scrolling panel), not as a bubble above it. */
export function ColourNote({ kind, className, inline }: { kind: keyof typeof COLOUR_NOTES; className?: string; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const n = COLOUR_NOTES[kind];
  return (
    <div ref={ref} className={cn(inline ? "flex flex-col items-start" : "relative inline-flex", className)}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`How the ${kind} colours are chosen`} title="How these colours are chosen"
        className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium text-slate-500 hover:bg-white hover:text-slate-800", open && "bg-white text-slate-800")}>
        <Info size={11} />How the colours are chosen
      </button>
      {open && (
        <div role="dialog" className={cn(inline ? "mt-1.5 mb-1 w-full" : "absolute bottom-full left-0 z-30 mb-1.5 w-[300px]", "rounded-xl border border-white/70 bg-white/92 p-3 text-xs leading-relaxed text-slate-700 shadow-glass backdrop-blur-xl")}>
          <div className="mb-1 font-semibold text-slate-900">{n.title}</div>
          <p>{n.body}</p>
          {n.link && <a href={n.link.href} target="_blank" rel="noreferrer" className="mt-1.5 inline-block font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900">{n.link.label} ↗</a>}
        </div>
      )}
    </div>
  );
}
