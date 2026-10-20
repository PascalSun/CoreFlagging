import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";

import { chatModel, chatModelId } from "@/lib/ai/provider";
import { coretracePrompt, coretraceTools } from "@/lib/ai/coretrace-tools";

// The CoreFlagging assistant. Same sign-in rule and usage log as the platform's assistant
// (/api/chat); its own tools read the core-scan API with the reader's token.

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = chatModelId();
const PLATFORM = (process.env.PLATFORM_API_URL ?? process.env.NEXT_PUBLIC_PLATFORM_URL ?? "http://localhost:8001").replace(/\/$/, "");

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

async function verified(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${PLATFORM}/authenticate/api/me/`, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok && Boolean(((await res.json()) as { verified?: boolean }).verified);
  } catch { return false; }
}

async function log(token: string, row: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${PLATFORM}/chats/logs/`, {
      method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: "chat", model: MODEL, ...row, metadata: { site: "coretrace", ...((row.metadata as object) ?? {}) } }),
    });
  } catch (e) { console.error("[coretrace chat] log failed", e); }
}

export async function POST(req: Request) {
  const token = bearer(req);
  if (!token || !(await verified(token))) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: { messages?: UIMessage[]; context?: { hole?: string | null; m?: number | null; model?: string | null } };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) return Response.json({ error: "no_messages" }, { status: 400 });
  const last = [...messages].reverse().find((m) => m.role === "user");
  const question = (last?.parts ?? []).filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("").slice(0, 8000);
  const tools = coretraceTools(token);
  const result = streamText({
    model: chatModel(),
    system: coretracePrompt(body.context ?? {}, req.headers.get("x-locale") ?? undefined),
    messages: await convertToModelMessages(messages.map((m) => ({ ...m, parts: m.parts.filter((p) => p.type !== "reasoning") })), { tools }),
    tools,
    stopWhen: stepCountIs(12),
    onFinish: async (e) => {
      const u = (e as { totalUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }).totalUsage ?? {};
      await log(token, { status: "ok", question, answer: e.text ?? "", input_tokens: u.inputTokens ?? null, output_tokens: u.outputTokens ?? null, total_tokens: u.totalTokens ?? null, finish_reason: e.finishReason ?? "" });
    },
    onError: async (e) => {
      const er = (e as { error?: unknown }).error ?? e;
      await log(token, { status: "error", question, answer: "", metadata: { error: er instanceof Error ? er.message : String(er) } });
    },
  });
  return result.toUIMessageStreamResponse({
    onError: (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      return /rate.?limit|quota|credit|402|429|503|unavailable|overloaded|timeout|fetch failed|econn|api key|unauthor/i.test(msg) ? "provider_unavailable" : "error";
    },
  });
}
