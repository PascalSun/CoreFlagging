"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** A hole on a phone: a bottom sheet that opens at half height (the map stays in view above it), goes full screen
 * when pulled up or when the full log opens, and closes when pulled down. Only the handle drags; the content
 * scrolls as usual. */
export function HoleSheet({ full, onFull, onClose, children }: { full: boolean; onFull: (f: boolean) => void; onClose: () => void; children: React.ReactNode }) {
  const [drag, setDrag] = useState(0); const [dragging, setDragging] = useState(false); const start = useRef<number | null>(null); const moved = useRef(false);
  const end = () => {
    if (start.current === null) return;
    if (drag < -60 && !full) onFull(true);
    else if (drag > 80) { if (full) onFull(false); else onClose(); }
    setDrag(0); start.current = null; setDragging(false);
  };
  return (
    <aside className={cn("fixed inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_-12px_40px_rgba(15,23,42,0.28)]", !dragging && "transition-[height,transform] duration-300 ease-out")}
      style={{ height: full ? "calc(100dvh - 8px)" : "56dvh", transform: `translateY(${Math.max(drag, full ? 0 : -80)}px)` }} aria-label="Hole">
      <div className="flex flex-none cursor-grab touch-none justify-center pt-2 pb-1"
        onPointerDown={(e) => { start.current = e.clientY; moved.current = false; setDragging(true); (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (start.current !== null) { const d = e.clientY - start.current; if (Math.abs(d) > 6) moved.current = true; setDrag(d); } }}
        onPointerUp={end} onPointerCancel={end}
        onClick={() => { if (!moved.current) onFull(!full); }}>
        <button type="button" aria-label={full ? "Show the map" : "Full screen"} className="grid h-6 w-16 place-items-center"><span className="h-1.5 w-11 rounded-full bg-slate-300" /></button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </aside>
  );
}
