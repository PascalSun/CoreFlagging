"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** A step points at the element carrying data-tour={target}; without one (or if it is not on screen) it sits in the middle.
 *  An optional step is dropped when its element is not on the page as the tour opens (a hole with no trays, no documents). */
export type TourStep = { target?: string; title: string; body: string; optional?: boolean;
  /** The element only comes once the tour has acted (the demo hole): it is waited for until the element named here is on
   *  the page (the view loaded), and an optional one still missing then is stepped over. */
  later?: string;
  /** "hole": run the page's demo (open a real hole) when this step is first reached. */
  act?: "hole";
  /** Click this data-tour element when the step is first reached (the tour opens the full log itself). */
  click?: string };

/** The map's tour, and one for each view of the data (a hole's summary, its full log, the table, two holes compared,
 *  the 3D scene): each is shown once per browser, the first time that view is open on a wide screen. */
export type TourId = "map" | "hole" | "log" | "table" | "compare" | "scene";
// v2 (2026-10-24): the assistant and its model picker got their own steps, so everyone sees the map tour once more
const KEYS: Record<TourId, string> = {
  map: "coretrace.tour.v2", hole: "coretrace.tour.hole.v1", log: "coretrace.tour.log.v1",
  table: "coretrace.tour.table.v1", compare: "coretrace.tour.compare.v1", scene: "coretrace.tour.scene.v1",
};
export const tourSeen = (id: TourId = "map") => { try { return localStorage.getItem(KEYS[id]) === "1"; } catch { return true; } };
const markSeen = (id: TourId) => { try { localStorage.setItem(KEYS[id], "1"); } catch { /* private window: the tour just shows again */ } };

// One tour at a time, and only one opens by itself in a visit: a view's tour that would follow another (the map's, say)
// waits for the next time its view is opened. None opens in the middle of a drag or a zoom.
let showing = false, shownThisVisit = false, pressed = false;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => { pressed = true; }, true);
  for (const e of ["pointerup", "pointercancel"]) window.addEventListener(e, () => { pressed = false; }, true);
}
const tourFree = () => !showing && !shownThisVisit && !pressed;

/** Opens a view's tour by itself, once per browser: once `id`'s view is in use and its `ready` element has been on the
 *  page for about 0.8 s (the view drawn with its data), and no other tour is showing or has been this visit. */
export function useViewTour(id: TourId | null, ready: string | undefined, open: (id: TourId) => void) {
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; });
  useEffect(() => {
    if (!id || !ready || tourSeen(id)) return;
    let since = 0, n = 0;
    const t = setInterval(() => {
      if (++n > 75) { clearInterval(t); return; }                    // ~30 s: the view never finished, try another time
      since = document.querySelector(`[data-tour="${ready}"]`) ? since + 1 : 0;
      if (since >= 2 && tourFree()) { clearInterval(t); openRef.current(id); }
    }, 400);
    return () => clearInterval(t);
  }, [id, ready]);
}

/** A short guided tour: the element in question is lit, everything else dimmed, with a card beside it. */
export function Tour({ steps: all, id = "map", onClose, onDemo }: { steps: TourStep[]; id?: TourId; onClose: () => void; /** open a hole, for a step with act "hole" */ onDemo?: () => void }) {
  // the steps as the tour opens: an optional step whose element is not there is left out, and they hold still after
  // (a step waiting on the demo is kept, its element not there yet; without a demo the demo's steps go)
  const [steps] = useState(() => all.filter((s) => s.later ? !!onDemo : !s.optional || !s.target || document.querySelector(`[data-tour="${s.target}"]`)));
  const [i, setI0] = useState(0);
  const dir = useRef(1);
  const setI = (n: number | ((n: number) => number)) => setI0((cur) => { const v = typeof n === "function" ? n(cur) : n; dir.current = v >= cur ? 1 : -1; return v; });
  // the demo runs once, when its step is first reached; the hole it opens is then the next steps' subject
  const demoed = useRef(false), clicked = useRef(new Set<string>());
  useEffect(() => {
    if (steps[i]?.act === "hole" && !demoed.current && onDemo) { demoed.current = true; markSeen("hole"); markSeen("log"); onDemo(); }
    const c = steps[i]?.click;
    if (c && !clicked.current.has(c)) { clicked.current.add(c); document.querySelector<HTMLElement>(`[data-tour="${c}"]`)?.click(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);
  useEffect(() => { showing = true; shownThisVisit = true; return () => { showing = false; }; }, []);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i] ?? steps[0];
  // the card's own height, measured once it is drawn: long steps are taller than a guess, and were cut off at the bottom
  const card = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(0);
  useLayoutEffect(() => { setCardH(card.current?.offsetHeight ?? 0); }, [i, rect]);

  useLayoutEffect(() => {
    let wait = 0, tries = 0, settled = 0;
    const get = (t?: string) => (t ? document.querySelector<HTMLElement>(`[data-tour="${t}"]`) : null);
    const measure = () => {
      const r = get(step.target)?.getBoundingClientRect();
      setRect(r && r.width > 0 && r.height > 0 ? r : null);
    };
    const look = () => {
      // the demo hole is on its way: wait (up to ~15 s) for its view, then ~2.5 s more for its parts that load after
      // it (the model's findings); only then is a missing optional part stepped over
      if (step.later && !get(step.target)) {
        if (get(step.later)) settled++;
        if ((!get(step.later) || settled < 12) && tries++ < 90) { measure(); wait = window.setTimeout(look, 200); return; }
        if (step.optional) { setI((n) => Math.min(Math.max(n + dir.current, 0), steps.length - 1)); return; }
      }
      const el = get(step.target);
      if (el) el.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      measure(); wait = window.setTimeout(measure, 400);   // a panel still sliding in lands a moment later
    };
    // a panel scrolling the element into view moves it: follow it
    look(); window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { clearTimeout(wait); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const close = () => { markSeen(id); onClose(); };
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "Enter") setI((n) => Math.min(n + 1, steps.length - 1));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps.length]);

  // the card goes beside the lit element, on whichever side has room, kept whole on screen by its measured height
  const W = 320, pad = 14, m = 12, vw = typeof window !== "undefined" ? window.innerWidth : 1440, vh = typeof window !== "undefined" ? window.innerHeight : 900;
  const h = Math.min(cardH || 220, vh - 2 * m);
  let pos: React.CSSProperties = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  if (rect) {
    const fitTop = (top: number) => Math.min(Math.max(top, m), vh - h - m);
    const fitLeft = (left: number) => Math.min(Math.max(left, m), vw - W - m);
    pos = rect.bottom + pad + h < vh - m ? { left: fitLeft(rect.left), top: rect.bottom + pad }
      : rect.right + pad + W < vw - m ? { left: rect.right + pad, top: fitTop(rect.top) }
      : rect.left - pad - W > m ? { left: rect.left - pad - W, top: fitTop(rect.top) }
      : { left: fitLeft(rect.left), top: fitTop(rect.top - pad - h) };
  }
  const last = i === steps.length - 1;
  return createPortal(
    <div className="fixed inset-0 z-[95]" role="dialog" aria-modal aria-label="Guided tour">
      {/* the dim, with a hole cut for the element: one big shadow around a box that matches it */}
      {rect ? <div className="pointer-events-none fixed rounded-2xl ring-2 ring-cyan transition-all duration-300 motion-reduce:transition-none" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: "0 0 0 9999px rgba(15,23,42,0.55)" }} />
        : <div className="fixed inset-0 bg-slate-900/55" />}
      <div ref={card} className="fixed max-h-[calc(100vh-24px)] w-[320px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl transition-all duration-300 motion-reduce:transition-none" style={pos}>
        <div className="flex items-start justify-between gap-3">
          <p className="font-display text-[15px] font-semibold leading-snug text-slate-900">{step.title}</p>
          <button type="button" onClick={close} aria-label="Close the tour" className="-mr-1 -mt-1 grid size-7 flex-none place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={15} /></button>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <span className="flex gap-1" aria-label={`Step ${i + 1} of ${steps.length}`}>
            {steps.map((_, k) => <i key={k} className={`inline-block h-1.5 rounded-full transition-all motion-reduce:transition-none ${k === i ? "w-4 bg-slate-900" : "w-1.5 bg-slate-300"}`} />)}
          </span>
          <span className="flex items-center gap-1.5">
            {i > 0 && <button type="button" onClick={() => setI(i - 1)} className="h-8 rounded-full px-3 text-xs font-medium text-slate-600 hover:bg-slate-100">Back</button>}
            <button type="button" onClick={() => (last ? close() : setI(i + 1))} className="h-8 rounded-full bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-700">{last ? "Start exploring" : "Next"}</button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
