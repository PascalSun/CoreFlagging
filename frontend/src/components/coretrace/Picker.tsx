"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** A dropdown in the app's own look (the native one differs on every phone). `side` is where the list opens:
 * "top" for a control at the foot of the screen. Escape or a click elsewhere closes it; arrows move, Enter picks. */
export function Picker<T extends string>({ value, options, onChange, label, side = "bottom", className, menuClassName }: {
  value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string;
  side?: "top" | "bottom"; className?: string; menuClassName?: string;
}) {
  const [open, setOpen] = useState(false); const [hi, setHi] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const cur = options.find((o) => o.id === value) ?? options[0];
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away); return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const pick = (v: T) => { onChange(v); setOpen(false); };
  return (
    <div ref={root} className="relative min-w-0">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${cur?.label}`}
        onClick={() => { setHi(Math.max(0, options.findIndex((o) => o.id === value))); setOpen((o) => !o); }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setHi(Math.max(0, options.findIndex((o) => o.id === value))); setOpen(true); return; }
          if (!open) return;
          if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
          else if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, options.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(options[hi].id); }
        }}
        className={cn("flex w-full min-w-0 items-center justify-between gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-left text-xs font-medium text-slate-800 outline-none hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-cyan", open && "border-slate-300", className)}>
        <span className="truncate">{cur?.label}</span><ChevronDown size={13} className={cn("flex-none text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul role="listbox" aria-label={label}
          className={cn("absolute left-0 z-50 min-w-full overflow-hidden rounded-xl border border-white/70 bg-white/95 p-1 shadow-glass backdrop-blur-xl", side === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]", menuClassName)}>
          {options.map((o, i) => (
            <li key={o.id} role="option" aria-selected={o.id === value}>
              <button type="button" onClick={() => pick(o.id)} onMouseEnter={() => setHi(i)}
                className={cn("flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-xs", i === hi ? "bg-slate-100 text-slate-900" : "text-slate-700", o.id === value && "font-semibold")}>
                {o.label}{o.id === value && <Check size={13} className="flex-none text-slate-900" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
