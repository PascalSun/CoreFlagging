// The card shown when the pointer rests on a hole: built as plain DOM, since Mapbox owns the popup.

import type { HoleRow } from "@/lib/coreScan";
import { NONE, STATUS_LABEL, coreTypeColor } from "@/components/coretrace/palette";
import type { Shape } from "@/components/coretrace/shapes";

type Look = { color: string; label: string; ring?: string; wait?: boolean; shape?: Shape; shapeLabel?: string };

const el = (tag: string, cls: string, text?: string) => { const e = document.createElement(tag); e.className = cls; if (text !== undefined) e.textContent = text; return e; };

function mark(look: Look): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg", s = document.createElementNS(ns, "svg"); s.setAttribute("width", "10"); s.setAttribute("height", "10"); s.setAttribute("viewBox", "0 0 10 10");
  const shape = look.shape ?? "circle"; let p: SVGElement;
  if (shape === "circle") { p = document.createElementNS(ns, "circle"); p.setAttribute("cx", "5"); p.setAttribute("cy", "5"); p.setAttribute("r", "4"); }
  else { p = document.createElementNS(ns, "path"); p.setAttribute("d", shape === "square" ? "M1.5 1.5h7v7h-7z" : shape === "diamond" ? "M5 .6L9.4 5 5 9.4.6 5z" : "M5 .8L9.4 8.6H.6z"); }
  p.setAttribute("fill", look.ring ? "#fff" : look.color); p.setAttribute("stroke", look.ring ?? "rgba(15,23,42,.35)"); p.setAttribute("stroke-width", look.ring ? "1.5" : "0.8");
  s.append(p); return s;
}

export function holeCard(h: HoleRow, look: Look, typeName: Map<number, string>, colourBy = "Map colour"): HTMLElement {
  const card = el("div", "ct-card");
  const head = el("div", "ct-card-head");
  head.append(el("span", "ct-card-name", h.name));
  head.append(el("span", "ct-card-chip", h.source === "upload" ? "Your scan" : h.state || "NVCL"));
  if (h.offshore) head.append(el("span", "ct-card-chip ct-card-chip-sea", "Offshore"));
  card.append(head);
  const who = [h.operator, h.project].filter(Boolean).join(" · ");
  if (who) card.append(el("div", "ct-card-sub", who));

  if (h.status !== "ready") {
    card.append(el("div", "ct-card-wait", `${STATUS_LABEL[h.status]}. Its readings appear once it is processed.`));
    return card;
  }
  // the hole from top to bottom, in the core types the model reads
  const strip = el("div", "ct-card-strip");
  if (h.strip?.length) for (const k of h.strip) { const i = el("i", ""); i.style.background = coreTypeColor(typeName.get(k)); strip.append(i); }
  else { const i = el("i", ""); i.style.background = NONE; strip.append(i); }
  const ends = el("div", "ct-card-ends");
  ends.append(el("span", "", h.depth_min !== null ? `${Math.round(h.depth_min)} m` : ""), el("span", "", h.depth_max !== null ? `${Math.round(h.depth_max)} m` : ""));
  card.append(strip, ends);

  const facts = el("div", "ct-card-facts");
  const fact = (k: string, v: string | Node) => { const r = el("div", "ct-card-fact"); r.append(el("span", "ct-card-k", k)); const vv = el("span", "ct-card-v"); vv.append(v); r.append(vv); facts.append(r); };
  const cls = el("span", "ct-card-cls"); cls.append(mark(look), document.createTextNode(look.label)); fact(colourBy, cls);
  fact("Gold assays", h.au_pos_m > 0 ? `${h.au_pos_m} m ≥ 0.1 ppm` : h.au_m > 0 ? `${h.au_m} m, all < 0.1 ppm` : "none in the scan");
  if (h.message) fact("Models", "not read (scan shown as is)");
  card.append(facts);
  card.append(el("div", "ct-card-hint", "Click to open the hole"));
  return card;
}
