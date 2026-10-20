"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ModelPicker, useChatModel } from "@/components/chat/ModelPicker";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { Streamdown, type Components } from "streamdown";
import { ExternalLink, FileText, Loader2, RotateCcw, Send } from "lucide-react";
import { MD_COMPONENTS } from "@/components/chat/mdTable";
import { ReportPdf } from "@/components/coretrace/ReportPdf";
import { authToken, refreshAccessToken, refreshToken } from "@/lib/auth";
import { PLATFORM_URL, platformFetch } from "@ntlp/geodata-web/fetch";
import { cn } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

const TOOL_RUNNING: Record<string, string> = {
  find_holes: "Searching the holes…", hole_summary: "Reading the hole summary…", hole_log: "Reading the auto log…", unusual_10cm: "Reading the 10 cm scores…", metre_detail: "Reading one metre…",
  similar_core: "Searching similar core…", quality_issues: "Reading the quality list…", open_hole: "Opening it on the map…",
  hole_documents: "Looking up the hole's documents and reading their first pages…", document_text: "Reading the document…", search_documents: "Searching the reports…", open_document: "Opening the PDF…",
};
const TOOL_LABEL: Record<string, string> = {
  find_holes: "Searched the holes", hole_summary: "Read the hole summary", hole_log: "Read the auto log", unusual_10cm: "Read the 10 cm scores", metre_detail: "Read one metre",
  similar_core: "Searched similar core", quality_issues: "Read the quality list", open_hole: "Opened it on the map",
  hole_documents: "Looked up the hole's documents", document_text: "Read the document", search_documents: "Searched the reports", open_document: "Opened the PDF",
};

/** "[MND036 120 m](hole:MND036?m=120)" → an in-page link the panel opens itself. A document link the model writes on
 * its own ("[report.pdf](wamex:A77996?file=report.pdf)") becomes a link to the PDF itself rather than a blocked one. */
const holeLinks = (t: string) => t
  .replace(/\]\(hole:([^)?\s]+)(?:\?m=(\d+))?\)/g, (_, h, m) => `](#hole=${encodeURIComponent(decodeURIComponent(h))}${m ? `&m=${m}` : ""})`)
  .replace(/\]\((wamex|hylogger|ebookshop|geolit):([^)?\s]+)(?:\?file=([^)\s]+))?\)/g, (_, c, k, f) => `](#doc=${c}&key=${encodeURIComponent(decodeURIComponent(k))}${f ? `&file=${encodeURIComponent(decodeURIComponent(f))}` : ""})`);
/** Where the platform serves a document's PDF (as the open_document tool builds it). */
const docHref = (corpus: string, key: string, file: string) => `${PLATFORM_URL}${corpus === "wamex"
  ? `/geo/api/wamex/report/${encodeURIComponent(key)}/${encodeURIComponent(file)}`
  : `/geo/api/doc/file/?corpus=${encodeURIComponent(corpus)}&key=${encodeURIComponent(key)}&filename=${encodeURIComponent(file)}`}`;

export type OpenTarget = { hole: string; m?: number; tab?: string };

type DocRow = { corpus: string; key: string; file: string; title: string; sub: string; url: string };

/** What hole_documents found, as a list the reader can open: the hole's own HyLogger PDFs and the WAMEX reports it was
 * logged in, each a link to its PDF, with a viewer in place on request. Drawn by the interface, so it is there whatever the model writes. */
function DocumentList({ out }: { out: any }) {
  const rows: DocRow[] = [
    ...((out.wamex?.reports_this_hole_was_logged_in ?? []) as any[]).filter((r) => r.url).map((r) => ({
      corpus: "wamex", key: r.anumber, file: r.pdf, url: r.url, title: `${r.anumber} · ${r.title ?? "WAMEX report"}`,
      sub: [r.year, r.company, r.type, r.commodities].filter(Boolean).join(" · ") })),
    ...((out.hole_pdfs ?? []) as any[]).map((p) => ({ corpus: p.corpus, key: p.key, file: p.file, url: p.url, title: p.title, sub: `${p.kind}${p.pages ? ` · ${p.pages} pages` : ""}` })),
  ];
  const [open, setOpen] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const covering: any[] = out.wamex?.reports_covering_the_collar ?? [];
  // the platform's count includes the reports the hole was logged in, which the list above already shows
  const coveringTotal: number = Math.max(covering.length, (out.wamex?.reports_covering_the_collar_total ?? covering.length) - (out.wamex?.reports_this_hole_was_logged_in?.length ?? 0));
  if (!rows.length) return null;
  const shown = rows.find((r) => r.url === open);
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.url} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-xs", r.url === open ? "border-slate-400 bg-white" : "border-slate-200 bg-white/70")}>
            <FileText size={14} className="shrink-0 text-slate-500" />
            <div className="min-w-0 flex-1">
              <a href={`${PLATFORM_URL}${r.url}`} target="_blank" rel="noreferrer" className="block truncate font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900">{r.title}</a>
              {r.sub && <div className="truncate text-[11px] text-slate-500">{r.sub}</div>}
            </div>
            <a href={`${PLATFORM_URL}${r.url}`} target="_blank" rel="noreferrer" aria-label="Open the PDF in a new tab" className="grid size-6 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900"><ExternalLink size={12} /></a>
            <button type="button" onClick={() => setOpen(r.url === open ? null : r.url)} className="shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-700 hover:border-slate-400">{r.url === open ? "Hide" : "View here"}</button>
          </li>
        ))}
      </ul>
      {coveringTotal > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white/70 text-xs">
          <button type="button" onClick={() => setMore((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-left text-[12px] text-slate-700 hover:text-slate-900">
            <span>{coveringTotal} more WAMEX {coveringTotal === 1 ? "report covers" : "reports cover"} the collar{covering.length < coveringTotal ? ` (newest ${covering.length} listed)` : ""}</span>
            <span className="text-[11px] text-slate-500">{more ? "Hide" : "Show all"}</span>
          </button>
          {more && (
            <ol className="flex flex-col gap-1.5 border-t border-slate-100 px-3 py-2">
              {covering.map((r) => (
                <li key={r.anumber} className="text-[11px] leading-snug text-slate-600">
                  <a href={r.wamex_page} target="_blank" rel="noreferrer" className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900">{r.anumber}</a>
                  {" "}{[r.year, r.company, r.type, r.commodities].filter(Boolean).join(" · ")}
                  <div className="text-slate-700">{r.title}</div>
                  {r.abstract && <div className="text-slate-500">{String(r.abstract).replace(/\s+/g, " ").slice(0, 220)}{String(r.abstract).length > 220 ? "…" : ""}</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {shown && <ReportPdf url={shown.url} title={shown.title} subtitle={`${shown.corpus === "wamex" ? "WAMEX " : ""}${shown.key} · ${shown.file}`} />}
    </div>
  );
}

/** The CoreFlagging assistant: ask about holes, metres and the models in plain words. It reads
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
  const llm = useChatModel();   // cloud or local model, picked in the input bar
  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/coretrace/chat",
    body: () => ({ context: ctxRef.current, llm: llm.ref.current ?? undefined }),
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
      if (typeof href === "string" && href.startsWith("#doc=")) {
        const p = new URLSearchParams(href.slice(1)); const file = p.get("file");
        if (file) return <a href={docHref(p.get("doc") ?? "wamex", p.get("key") ?? "", file)} target="_blank" rel="noreferrer" className="underline underline-offset-2">{children}</a>;
        return <span>{children}</span>;
      }
      return <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{children}</a>;
    },
  }), []);

  const starters = context.hole
    ? [`Find the WAMEX reports for ${context.hole} and summarise them`, `What stands out in ${context.hole}?`, `Summarise the auto log of ${context.hole}`, context.m !== null ? `Why is ${context.m} m in ${context.hole} flagged as unusual?` : `Where is gold most likely in ${context.hole}?`, `Which data-quality issues does ${context.hole} have?`]
    : ["Find the WAMEX reports for DRDD309 and summarise them", "What do the WAMEX reports say about MND037?", "Which reports cover KPDDH009, and what did the drilling find?", "Which processed holes have gold assays?", "What does the unusual score mean?"];

  if (!signedIn) {
    return (
      <div className="flex flex-1 flex-col items-start justify-center gap-3 p-5">
        <p className="text-sm leading-relaxed text-slate-600">The assistant answers from the same data as the map: holes, metres, the auto log, unusual intervals and quality issues. Sign in to use it.</p>
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
                  if (p.type === "tool-hole_documents" && p.state === "output-available" && p.output?.hole_pdfs) {
                    return <div key={i} className="w-full max-w-[92%] py-1"><DocumentList out={p.output} /></div>;
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
                        {done ? (TOOL_LABEL[name] ?? name) : (TOOL_RUNNING[name] ?? TOOL_LABEL[name] ?? name)}{what}
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
          <ModelPicker options={llm.options} choice={llm.choice} onChange={llm.setChoice} disabled={busy} />
          <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-900 text-white transition-opacity disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}</button>
        </div>
      </form>
    </div>
  );
}
