"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Cloud, Cpu } from "lucide-react";
import { busy as deep } from "@/lib/ai/localModel";

// Cloud (OpenRouter) or local (our own GPU's Ollama) for the assistant, picked in the assistant's header
// (`compact`: an icon button among the header's icons) or, where a page has no header, as a pill.
// The server lists what it can serve (/api/chat-models); the choice is kept per browser and
// travels with each message as `llm`. On the local model the button shows our GPU's queue (the LLM gateway's).
// The list is our own menu (a popover by the button; a small sheet on phones), not the device's select.

export type ChatChoice = "cloud" | "local";
type Option = { id: ChatChoice; label: string; model: string; queue?: string; fallback?: string };
type Queue = { available: boolean; ahead?: { interactive: number }; eta_s?: { interactive: number }; running?: number; parallel?: number; waiting?: number };

/** The local model's queue on our GPU (the LLM gateway's estimate), read every 5 s while it is shown. */
function useQueue(url?: string): Queue | null {
  const [got, setGot] = useState<{ url: string; q: Queue | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const read = () => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((q) => { if (live) setGot({ url, q }); }).catch(() => {});
    read();
    const t = setInterval(read, 5000);
    return () => { live = false; clearInterval(t); };
  }, [url]);
  return url && got?.url === url ? got.q : null;
}

const wait = (s: number) => (s < 90 ? `~${Math.max(5, Math.round(s / 5) * 5)} s` : `~${Math.round(s / 60)} min`);

// v2 (2026-10-24): Cloud is everyone's default again, so picks saved under "chat.llm" are left behind once
const KEY = "chat.llm.v2";

/** The person's pick, the options, and a ref the chat transport reads when a message is sent. */
export function useChatModel() {
  const [options, setOptions] = useState<Option[]>([]);
  const [choice, setChoiceState] = useState<ChatChoice | null>(null);
  const ref = useRef<ChatChoice | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/chat-models").then((r) => (r.ok ? r.json() : null)).then((d: { default: ChatChoice; options: Option[] } | null) => {
      if (!live || !d) return;
      setOptions(d.options);
      let saved: string | null = null;
      try { saved = localStorage.getItem(KEY); } catch { /* storage blocked */ }
      const pick = d.options.some((o) => o.id === saved) ? (saved as ChatChoice) : d.default;
      ref.current = pick; setChoiceState(pick);
    }).catch(() => { /* no list: the server's default is used */ });
    return () => { live = false; };
  }, []);

  const setChoice = (c: ChatChoice) => {
    ref.current = c; setChoiceState(c);
    try { localStorage.setItem(KEY, c); } catch { /* storage blocked */ }
  };
  return { options, choice, setChoice, ref };
}

/** Our GPU's state in words, from the gateway's queue (the same phrases as the button's tooltip). */
function gpuState(q: Queue | null, sending: boolean, fallback?: string) {
  if (!q) return { busy: false, ahead: 0, text: "" };
  // too deep to wait on (the server's own test, lib/ai/localModel): the smaller model answers instead
  if (fallback && !sending && deep(q, 20)) return { busy: true, ahead: 0, text: `${q.available === false ? "our big GPU is not answering" : "our big GPU is busy"}; ${fallback} answers instead` };
  const ahead = q.ahead?.interactive ?? 0, eta = q.eta_s?.interactive ?? 0, busy = !sending && (ahead > 0 || eta >= 10);
  // "ahead": people's calls before this one (a batch run waits behind it); none ahead but every slot taken: it is next
  const text = !q.available ? "our GPU is not answering" : sending ? "your message is with our GPU" : !busy ? "our GPU is free"
    : ahead ? `${ahead} ahead on our GPU, ${wait(eta)}` : `our GPU is full; yours is next, ${wait(eta)}`;
  return { busy, ahead, text };
}

const PHONE = "(max-width: 640px)";
function usePhone(): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(PHONE); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(PHONE).matches, () => false);
}

/** The button: an icon in the assistant's header (`compact`) or a small pill; the list opens our own menu. */
export function ModelPicker({ options, choice, onChange, disabled, compact }: {
  options: Option[]; choice: ChatChoice | null; onChange: (c: ChatChoice) => void; disabled?: boolean;
  /** an icon button the size of the assistant header's other icons (the header's toolbar), not a labelled pill */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const cur = options.find((o) => o.id === choice) ?? options[0];
  const local = options.find((o) => o.id === "local");
  // the local model's queue: while it is the one picked (the button's dot), and while the list is open (its row)
  const q = useQueue(local && (open || cur?.id === "local") ? local.queue : undefined);
  const close = useCallback((refocus = true) => { setOpen(false); if (refocus) button.current?.focus(); }, []);
  if (options.length < 2 || !choice || !cur) return null;

  const Icon = cur.id === "local" ? Cpu : Cloud;
  const mine = cur.id === "local" ? gpuState(q, !!disabled, local?.fallback) : { busy: false, ahead: 0, text: "" };
  const tip = `Model: ${cur.label} · ${cur.model}${mine.text ? ` · ${mine.text}` : ""}`;
  const dot = cur.id === "local" && q && <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${!q.available ? "bg-rose-500" : disabled ? "animate-pulse bg-sky-500" : mine.busy ? "bg-amber-500" : "bg-emerald-500"}`} />;
  const toggle = () => { if (!disabled) setOpen((o) => !o); };
  const onKey = (e: KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); }
  };
  const common = {
    ref: button, type: "button" as const, title: tip, "aria-label": tip, "aria-haspopup": "listbox" as const, "aria-expanded": open,
    disabled, onClick: toggle, onKeyDown: onKey, "data-tour": "model",
  };

  return (
    <>
      {compact ? (
        <button {...common}
          className="relative grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/70 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500 disabled:cursor-not-allowed aria-expanded:bg-white/80 aria-expanded:text-slate-700">
          <Icon size={15} aria-hidden />
          {dot && <span className="absolute right-1 top-1 grid place-items-center">{dot}</span>}
          {cur.id === "local" && mine.busy && <span aria-hidden className="absolute -bottom-0.5 -right-0.5 rounded-full bg-amber-500 px-1 text-[9px] font-semibold leading-[13px] text-white">{mine.ahead || "1"}</span>}
        </button>
      ) : (
        <button {...common}
          className="relative flex h-7 max-w-[10rem] shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white/80 pl-2 pr-1.5 text-xs text-slate-600 hover:border-slate-300 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500 disabled:cursor-not-allowed">
          <Icon size={13} className="shrink-0" aria-hidden />
          {dot}
          <span className="truncate"><span className="font-medium">{cur.label}</span>{cur.id === "local" && mine.busy && <span className="text-amber-700"> · {mine.ahead ? `${mine.ahead} ahead` : "next"}</span>}</span>
          <ChevronDown size={12} className="shrink-0 text-slate-400" aria-hidden />
        </button>
      )}
      {open && <ModelMenu anchor={button} options={options} choice={cur.id} queue={q} sending={!!disabled}
        onPick={(c) => { onChange(c); close(); }} onClose={close} />}
    </>
  );
}

/** The list: a glass popover by the button, or a small sheet at the foot of a phone's screen. A listbox: arrows, Home,
 *  End, Enter or Space to pick; Esc, a tap outside or Tab to close; focus goes back to the button. */
function ModelMenu({ anchor, options, choice, queue, sending, onPick, onClose }: {
  anchor: RefObject<HTMLButtonElement | null>; options: Option[]; choice: ChatChoice; queue: Queue | null; sending: boolean;
  onPick: (c: ChatChoice) => void; onClose: (refocus?: boolean) => void;
}) {
  const phone = usePhone();
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.id === choice)));
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // under the button, its right edges aligned, kept on screen (above the button when there is no room below)
  useLayoutEffect(() => {
    if (phone) return;
    const place = () => {
      const b = anchor.current?.getBoundingClientRect(), el = list.current;
      if (!b || !el) return;
      const w = el.offsetWidth, h = el.offsetHeight, pad = 8;
      const left = Math.min(Math.max(pad, b.right - w), window.innerWidth - w - pad);
      const below = b.bottom + 6, top = below + h > window.innerHeight - pad ? Math.max(pad, b.top - h - 6) : below;
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, phone]);

  useEffect(() => { list.current?.focus(); }, []);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !anchor.current?.contains(t)) onClose(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [anchor, onClose]);

  const onKey = (e: KeyboardEvent) => {
    const n = options.length;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % n); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + n) % n); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(n - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(options[active].id); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "Tab") onClose(false);
  };

  const rows = options.map((o, i) => {
    const RowIcon = o.id === "local" ? Cpu : Cloud;
    const g = o.id === "local" ? gpuState(queue, sending && o.id === choice, o.fallback) : null;
    const tone = !g || !queue ? "" : !queue.available ? "text-rose-600" : g.busy ? "text-amber-700" : "text-emerald-700";
    const selected = o.id === choice;
    return (
      <div key={o.id} id={`${id}-${o.id}`} role="option" aria-selected={selected}
        onPointerEnter={() => setActive(i)} onClick={() => onPick(o.id)}
        className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ${i === active ? "bg-slate-900/[0.06]" : ""}`}>
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${selected ? "bg-slate-900 text-white" : "bg-slate-900/5 text-slate-500"}`}>
          <RowIcon size={15} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold leading-tight text-slate-800">{o.label}</span>
          <span className="block truncate text-[12px] leading-snug text-slate-500">{o.model}</span>
          {g?.text && <span className={`block text-[11.5px] leading-snug ${tone}`}>{g.text.charAt(0).toUpperCase() + g.text.slice(1)}</span>}
        </span>
        <Check size={16} aria-hidden className={`shrink-0 text-slate-800 ${selected ? "" : "invisible"}`} />
      </div>
    );
  });

  const box = (
    <div ref={list} role="listbox" tabIndex={-1} aria-label="Model" aria-activedescendant={`${id}-${options[active]?.id}`}
      onKeyDown={onKey}
      className={phone
        ? "fixed inset-x-2 bottom-2 z-[95] rounded-2xl border border-white/60 bg-white/95 p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] shadow-2xl ring-1 ring-slate-900/5 backdrop-blur-xl outline-none motion-safe:animate-[mp-up_160ms_ease-out]"
        : "fixed z-[95] w-72 rounded-2xl border border-white/60 bg-white/90 p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.16)] ring-1 ring-slate-900/5 backdrop-blur-xl outline-none focus-visible:ring-2 focus-visible:ring-sky-500 motion-safe:animate-[mp-in_120ms_ease-out]"}
      style={phone ? undefined : { top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
      {rows}
    </div>
  );
  return createPortal(
    <>
      {phone && <div aria-hidden className="fixed inset-0 z-[94] bg-slate-950/20" />}
      {box}
      <style>{"@keyframes mp-in{from{opacity:0;transform:scale(.97) translateY(-2px)}to{opacity:1;transform:none}}@keyframes mp-up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}"}</style>
    </>,
    document.body,
  );
}

/** Beside an answer: the model that wrote it ("Gemini 3.1 Flash Lite" or "Local · Qwen3 8B").
 *  Answers from before the label existed carry no model and show nothing. */
export function ModelTag({ metadata }: { metadata: unknown }) {
  const m = metadata as { llm?: ChatChoice; model?: string } | undefined;
  if (!m?.model) return null;
  const Icon = m.llm === "local" ? Cpu : Cloud;
  return (
    <span title={m.llm === "local" ? "Answered by the local model on our own GPU" : "Answered by a cloud model"}
      className="inline-flex w-fit items-center gap-1 text-[10.5px] leading-none text-slate-400">
      <Icon size={11} aria-hidden />{m.llm === "local" ? `Local · ${m.model}` : m.model}
    </span>
  );
}
