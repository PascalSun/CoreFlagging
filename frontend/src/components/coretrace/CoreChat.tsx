"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { Streamdown, type Components } from "streamdown";
import { Loader2, RotateCcw, Send } from "lucide-react";
import { MD_COMPONENTS } from "@/components/chat/mdTable";
import { ReportPdf } from "@/components/coretrace/ReportPdf";
import { authToken, refreshAccessToken, refreshToken } from "@/lib/auth";
import { platformFetch } from "@ntlp/geodata-web/fetch";
import { cn } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

const TOOL_LABEL: Record<string, string> = {
  find_holes: "Searched the holes", hole_summary: "Read the hole summary", hole_log: "Read the auto log", unusual_10cm: "Read the 10 cm scores", metre_detail: "Read one metre",
  similar_core: "Searched similar core", quality_issues: "Read the quality list", open_hole: "Opened it on the map",
  hole_documents: "Looked up the hole's documents", document_text: "Read the document", search_documents: "Searched the reports", open_document: "Opened the PDF",
};

/** "[MND036 120 m](hole:MND036?m=120)" → an in-page link the panel opens itself. */
const holeLinks = (t: string) => t.replace(/\]\(hole:([^)?\s]+)(?:\?m=(\d+))?\)/g, (_, h, m) => `](#hole=${encodeURIComponent(decodeURIComponent(h))}${m ? `&m=${m}` : ""})`);

export type OpenTarget = { hole: string; m?: number; tab?: string };

/** The Core Flagging assistant: ask about holes, metres and the models in plain words. It reads
 * the same data as the map and moves the map to what it is describing. */
export function CoreChat({ context, onOpen, signedIn, onSignIn }: {
  context: { hole: string | null; m: number | null; model: string | null }; onOpen: (t: OpenTarget) => boolean;
  signedIn: boolean; onSignIn: () => void;
}) {
  const ctxRef = useRef(context);
  const openRef = useRef(onOpen);
  // the transport and the tool handler are built once; they read the latest props through these
  useEffect(() => { ctxRef.current = context; openRef.current = onOpen; });
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // built once; its callbacks read the refs when a message is sent, not during render
  // eslint-disable-next-line react-hooks/refs
  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/coretrace/chat",
    body: () => ({ context: ctxRef.current }),
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const go = (t: string | null) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), Authorization: `Bearer ${t ?? ""}`, "X-Locale": navigator.language } });
      let res = await go(authToken());
      if (res.status === 401 && refreshToken()) { const n = await refreshAccessToken(); if (n) res = await go(n); }
      return res;
    }) as typeof fetch,
  }), []);

  const { messages, sendMessage, status, setMessages, addToolOutput, error, stop } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      const { toolName, toolCallId, input: arg } = toolCall as any;
      if (toolName !== "open_hole") return;
      const ok = openRef.current(arg as OpenTarget);
      (addToolOutput as any)({ tool: toolName, toolCallId, output: ok ? { shown: true } : { shown: false, reason: "no such processed hole on the map" } });
    },
  });
  const busy = status === "submitted" || status === "streaming";

  // The conversation is kept on the platform, as on the hub and MineTrace: it survives a reload,
  // and staff can read it there. Loaded once on sign-in, saved after each finished answer.
  const loaded = useRef(false);
  const saved = useRef("");
  useEffect(() => {
    if (!signedIn || loaded.current) return;
    loaded.current = true;
    platformFetch("/chats/conversation/").then((r) => (r.ok ? r.json() : null)).then((c) => {
      if (!Array.isArray(c?.messages) || c.messages.length === 0) return;
      saved.current = JSON.stringify(c.messages);
      setMessages((now: any[]) => (now.length ? now : c.messages));
    }).catch(() => {});
  }, [signedIn, setMessages]);
  useEffect(() => {
    if (!signedIn || status !== "ready" || messages.length === 0) return;
    const body = JSON.stringify(messages);
    if (body === saved.current) return;
    saved.current = body;
    platformFetch("/chats/conversation/", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages }) }).catch(() => {});
  }, [signedIn, status, messages]);
  const startOver = () => {
    if (busy) void stop();
    setMessages([]);
    saved.current = "";
    platformFetch("/chats/conversation/clear/", { method: "POST" }).catch(() => {});
  };
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, status]);

  const send = (text: string) => { const t = text.trim(); if (!t || busy) return; setInput(""); sendMessage({ text: t }); };
  const components: Partial<Components> = useMemo(() => ({
    ...MD_COMPONENTS,
    a: ({ href, children }: any) => {
      if (typeof href === "string" && href.startsWith("#hole=")) {
        const p = new URLSearchParams(href.slice(1));
        return <button type="button" className="font-medium text-slate-900 underline decoration-cyan decoration-2 underline-offset-2 hover:decoration-slate-900"
          onClick={() => openRef.current({ hole: p.get("hole") ?? "", m: p.get("m") ? Number(p.get("m")) : undefined })}>{children}</button>;
      }
      return <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{children}</a>;
    },
  }), []);

  const starters = context.hole
    ? [`What stands out in ${context.hole}?`, `Find and summarise the report for ${context.hole}`, `Summarise the auto log of ${context.hole}`, context.m !== null ? `Why is ${context.m} m in ${context.hole} flagged as unusual?` : `Where is gold most likely in ${context.hole}?`, `Which data-quality issues does ${context.hole} have?`]
    : ["Which processed holes have gold assays?", "Find and summarise the WAMEX report for MND037", "Find holes in the Yilgarn with thermal infrared", "What does the unusual score mean?", "Which data-quality problem is most common?"];

  if (!signedIn) {
    return (
      <div className="flex flex-1 flex-col items-start justify-center gap-3 p-5">
        <p className="text-sm leading-relaxed text-slate-600">The assistant answers from the same data as the map: holes, metres, the auto log, unusual intervals, gold ranking and quality issues. Sign in to use it.</p>
        <button type="button" onClick={onSignIn} className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white hover:bg-ink-soft">Sign in</button>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length > 0 && (
          <div className="sticky top-0 z-10 -mx-4 -mt-3 mb-1 flex justify-end bg-gradient-to-b from-white via-white/90 to-transparent px-4 pt-2 pb-3">
            <button type="button" onClick={startOver} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm hover:border-slate-400 hover:text-slate-900"><RotateCcw size={11} />New conversation</button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="flex flex-col gap-3 px-1 pt-1">
            <p className="text-sm leading-relaxed text-slate-600">Ask in plain words, in any language. Answers come from the scans and the models, with the depths they refer to.</p>
            <div className="flex flex-col gap-1.5">
              {starters.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-[13px] text-slate-700 transition-colors hover:border-slate-400">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m: any) => (
          <div key={m.id} className={cn("py-1.5", m.role === "user" ? "flex justify-end" : "")}>
            {m.role === "user" ? (
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-slate-900 px-3.5 py-2 text-sm text-white">{m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text).join("")}</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {m.parts.map((p: any, i: number) => {
                  if (p.type === "text" && p.text) {
                    return <div key={i} className="max-w-[92%] rounded-2xl rounded-tl-sm bg-slate-100 px-3.5 py-2 text-sm leading-relaxed text-slate-700 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-display [&_h3]:font-semibold [&_h3]:text-slate-900 [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5"><Streamdown controls={{ table: false }} components={components}>{holeLinks(p.text)}</Streamdown></div>;
                  }
                  if (p.type === "tool-open_document" && p.state === "output-available" && p.output?.url) {
                    return <div key={i} className="w-full max-w-[92%] py-1"><ReportPdf url={p.output.url} title={p.output.title} page={p.output.page ?? undefined} subtitle={`${p.output.corpus === "wamex" ? "WAMEX " : ""}${p.output.key} · ${p.output.file}`} /></div>;
                  }
                  if (typeof p.type === "string" && p.type.startsWith("tool-")) {
                    const name = p.type.slice(5); const done = p.state === "output-available" || p.state === "output-error";
                    const what = p.input?.hole ? ` · ${p.input.hole}${p.input.m !== undefined ? ` ${p.input.m} m` : ""}` : "";
                    return (
                      <span key={i} className="inline-flex w-fit items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600">
                        {done ? <span className="size-1.5 rounded-full bg-emerald-500" /> : <Loader2 size={11} className="animate-spin" />}
                        {TOOL_LABEL[name] ?? name}{what}
                      </span>
                    );
                  }
                  return null;
                })}
              </div>
            )}
          </div>
        ))}
        {status === "submitted" && <div className="flex items-center gap-2 py-2 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" />Reading the scans…</div>}
        {error && <div className="my-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{/provider_unavailable/.test(error.message) ? "The language model is busy or unavailable. Try again in a minute." : "That did not work. Try again, or ask it differently."}</div>}
        <div ref={endRef} />
      </div>
      <form className="p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <div className="flex items-end gap-2 rounded-2xl border border-slate-200/70 bg-white/60 px-2.5 py-1.5 focus-within:border-slate-400">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder={context.hole ? `Ask about ${context.hole}…` : "Ask about the core…"} aria-label="Message"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            className="max-h-[96px] min-h-[24px] flex-1 resize-none overflow-y-auto bg-transparent text-base leading-[22px] text-slate-700 outline-none placeholder:text-slate-400 sm:text-sm" />
          <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-900 text-white transition-opacity disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}</button>
        </div>
      </form>
    </div>
  );
}
