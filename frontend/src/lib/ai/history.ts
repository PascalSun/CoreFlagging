import type { UIMessage } from "ai";

/**
 * The history the model is sent back: no past reasoning, no tool call that never got a result, and no question
 * left standing without an answer.
 *
 * A tool the browser runs (fly_to, show_layers, …) leaves an "input-available" part in the saved
 * conversation if the page closed or reloaded before it answered. The provider rejects a call
 * without its result, and because the dock reloads the saved conversation, one such part made
 * every later question in that conversation fail. Dropping it keeps the rest of the history.
 *
 * A turn that failed leaves its question with no answer after it; asked again, the model saw the same question two
 * or three times in a row and spent its thinking on why it was repeated. Of a run of unanswered questions only the
 * last is kept.
 */
export function cleanHistory(messages: UIMessage[]): UIMessage[] {
  const kept = messages
    .map((m) => ({
      ...m,
      parts: m.parts.filter((p) => {
        if (p.type === "reasoning") return false;
        if (p.type.startsWith("tool-") || p.type === "dynamic-tool") {
          const state = (p as { state?: string }).state;
          return state === "output-available" || state === "output-error";
        }
        return true;
      }),
    }))
    .filter((m) => m.role !== "assistant" || m.parts.some((p) => p.type !== "step-start"));
  return kept.filter((m, i) => m.role !== "user" || kept[i + 1]?.role !== "user");
}

/** What the reader had open, in words: the hole, the metre and the model, as the system prompt says it. */
export function describeOpen(ctx: { hole?: string | null; m?: number | null; model?: string | null } | undefined): string | undefined {
  if (!ctx?.hole) return undefined;
  return `hole ${ctx.hole}${ctx.m !== null && ctx.m !== undefined ? `, at ${ctx.m}–${ctx.m + 1} m` : ""}${ctx.model ? `, model ${ctx.model}` : ""}`;
}

/** What the reader had open when a question was asked, as the chat panel records it on the question. */
export function askedWith(m: UIMessage): string | undefined {
  const c = (m.metadata as { context?: unknown } | undefined)?.context;
  return typeof c === "string" && c.trim() ? c.trim() : undefined;
}

/**
 * The system prompt carries only the hole open now; an earlier answer was about the hole open then. Each earlier
 * question asked with something else open says what it was asked with, so the model does not take an old answer's
 * hole for the one open now (or argue the two). The latest question is left as it is: the system
 * prompt speaks for it.
 */
export function noteSelections(messages: UIMessage[], current: string | undefined, max = 600): UIMessage[] {
  const now = current?.trim() || undefined;
  const lastUser = messages.findLastIndex((m) => m.role === "user");
  return messages.map((m, i) => {
    const then = m.role === "user" && i !== lastUser ? askedWith(m) : undefined;
    if (!then || then === now) return m;
    const note = `[Asked while the reader had open: ${then.slice(0, max)}]`;
    return { ...m, parts: [{ type: "text" as const, text: note }, ...m.parts] };
  });
}

/**
 * Whether a failed turn can be asked again in place (useChat's regenerate): the conversation ends with its question,
 * or with the answer that broke off. (The `manual-` / evidence checks keep the copy in step with Groundwork's, whose
 * map adds cards to the conversation; asking again drops whatever follows the question.)
 */
export function canRetry(messages: UIMessage[]): boolean {
  const last = messages.at(-1);
  if (!last) return false;
  if (last.role === "user") return true;
  if (last.role !== "assistant" || last.id.startsWith("manual-")) return false;
  if ((last.metadata as { evidence?: unknown } | undefined)?.evidence) return false;
  return messages.at(-2)?.role === "user";
}
