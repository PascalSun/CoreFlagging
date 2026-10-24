"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** A step points at the element carrying data-tour={target}; without one (or if it is not on screen) it sits in the middle. */
export type TourStep = { target?: string; title: string; body: string };

// v2 (2026-10-24): the assistant and its model picker got their own steps, so everyone sees the tour once more
const KEY = "coretrace.tour.v2";
export const tourSeen = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(KEY, "1"); } catch { /* private window: the tour just shows again */ } };

/** A short guided tour: the element in question is lit, everything else dimmed, with a card beside it. */
export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];
  // the card's own height, measured once it is drawn: long steps are taller than a guess, and were cut off at the bottom
  const card = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(0);
  useLayoutEffect(() => { setCardH(card.current?.offsetHeight ?? 0); }, [i, rect]);

  useLayoutEffect(() => {
    const measure = () => {
      const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
      const r = el?.getBoundingClientRect();
      setRect(r && r.width > 0 && r.height > 0 ? r : null);
    };
    measure(); window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [step]);

  const close = () => { markSeen(); onClose(); };
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
      {rect ? <div className="pointer-events-none fixed rounded-2xl ring-2 ring-cyan transition-all duration-300" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: "0 0 0 9999px rgba(15,23,42,0.55)" }} />
        : <div className="fixed inset-0 bg-slate-900/55" />}
      <div ref={card} className="fixed max-h-[calc(100vh-24px)] w-[320px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl transition-all duration-300" style={pos}>
        <div className="flex items-start justify-between gap-3">
          <p className="font-display text-[15px] font-semibold leading-snug text-slate-900">{step.title}</p>
          <button type="button" onClick={close} aria-label="Close the tour" className="-mr-1 -mt-1 grid size-7 flex-none place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={15} /></button>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <span className="flex gap-1" aria-label={`Step ${i + 1} of ${steps.length}`}>
            {steps.map((_, k) => <i key={k} className={`inline-block h-1.5 rounded-full transition-all ${k === i ? "w-4 bg-slate-900" : "w-1.5 bg-slate-300"}`} />)}
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
