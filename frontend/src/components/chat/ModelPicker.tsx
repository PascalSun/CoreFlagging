"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Cloud, Cpu } from "lucide-react";

// Cloud (OpenRouter) or local (our own GPU's Ollama) for the assistant, picked in the chat bar.
// The server lists what it can serve (/api/chat-models); the choice is kept per browser and
// travels with each message as `llm`.

export type ChatChoice = "cloud" | "local";
type Option = { id: ChatChoice; label: string; model: string };

const KEY = "chat.llm";

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

/** A small pill before the send button: "Cloud", or "Local · Qwen3 8B"; the list names both models. */
export function ModelPicker({ options, choice, onChange, disabled }: {
  options: Option[]; choice: ChatChoice | null; onChange: (c: ChatChoice) => void; disabled?: boolean;
}) {
  if (options.length < 2 || !choice) return null;
  const cur = options.find((o) => o.id === choice) ?? options[0];
  const Icon = cur.id === "local" ? Cpu : Cloud;
  return (
    <label title={`Model: ${cur.label} · ${cur.model}`}
      className="relative flex h-7 max-w-[10rem] shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white/80 pl-2 pr-1.5 text-xs text-slate-600 hover:border-slate-300 hover:text-slate-800">
      <Icon size={13} className="shrink-0" aria-hidden />
      <span className="truncate"><span className="font-medium">{cur.label}</span>{cur.id === "local" && <span className="text-slate-400"> · {cur.model}</span>}</span>
      <ChevronDown size={12} className="shrink-0 text-slate-400" aria-hidden />
      <select aria-label="Model" value={cur.id} disabled={disabled} onChange={(e) => onChange(e.target.value as ChatChoice)}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed">
        {options.map((o) => <option key={o.id} value={o.id}>{o.label} · {o.model}</option>)}
      </select>
    </label>
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
