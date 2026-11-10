import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { extractReasoningMiddleware, wrapLanguageModel, type LanguageModel } from "ai";
import { pickLocalModel } from "./localModel";

// The assistant's model. OpenRouter by default: Gemini Flash (thinking) — thinking is on by
// default for these models, so no special config is needed; `sendReasoning: true` on the
// stream surfaces it. Override with CHAT_MODEL (a `creator/model` slug).
//
// The local model is our own GPU's Ollama (OpenAI-compatible API): OLLAMA_BASE_URL, OLLAMA_API_KEY
// and OLLAMA_MODEL, defaulting to the house "Home GPU" model. No per-token cost; a smaller model, so
// answers are slower and plainer. People pick cloud or local in the chat bar (chatChoices); CHAT_PROVIDER=ollama
// makes local the default.
const DEFAULT_MODEL = "google/gemini-2.5-flash";
const OLLAMA_BASE_URL = "https://ollama.ai4wa.com/v1";
const OLLAMA_MODEL = "qwen3-8b-32k";
const OLLAMA_FALLBACK = "qwen3.5-4b";

export type ChatProvider = "openrouter" | "ollama";
/** What a person picks in the chat bar: the cloud model (OpenRouter) or the local one (Ollama). */
export type ChatChoice = "cloud" | "local";

/** The server's default, from CHAT_PROVIDER. */
export function chatProvider(): ChatProvider {
  return process.env.CHAT_PROVIDER?.trim().toLowerCase() === "ollama" ? "ollama" : "openrouter";
}

function ollamaReady(): boolean {
  return Boolean(process.env.OLLAMA_API_KEY || process.env.OLLAMA_BASE_URL);
}

/** The provider for one request: the person's choice when it can be served, else the default. */
function providerFor(choice?: unknown): ChatProvider {
  if (choice === "local" && ollamaReady()) return "ollama";
  if (choice === "cloud") return "openrouter";
  return chatProvider();
}

const cloudModel = () => process.env.CHAT_MODEL || DEFAULT_MODEL;
const localModel = () => process.env.OLLAMA_MODEL || OLLAMA_MODEL;
// The smaller local model a chat goes to while the main one's GPU is busy (OLLAMA_FALLBACK_MODEL; empty: never), and
// how long a person may wait for the main one before that (LOCAL_MAX_WAIT_S).
const fallbackModel = () => process.env.OLLAMA_FALLBACK_MODEL ?? OLLAMA_FALLBACK;
const maxWaitS = () => Number(process.env.LOCAL_MAX_WAIT_S) || 20;

/** The local model that answers this chat now: the main one, or the smaller one while the main one's queue is deep
 *  (undefined when the chat goes to the cloud). Pass it to chatModel / chatModelId / chatTag. */
export async function localModelNow(choice?: unknown): Promise<string | undefined> {
  if (providerFor(choice) !== "ollama") return undefined;
  const { model } = await pickLocalModel({ primary: localModel(), fallback: fallbackModel(), queueUrl: queueFor, maxWaitS: maxWaitS() });
  return model;
}

/** The model id the usage log records. */
export function chatModelId(choice?: unknown, local?: string): string {
  return providerFor(choice) === "ollama" ? `ollama/${local ?? localModel()}` : cloudModel();
}

/** "google/gemini-3.1-flash-lite" → "Gemini 3.1 Flash Lite", "qwen3-8b-32k" → "Qwen3 8B",
 *  "qwen3-6-35b-a3b-32k" → "Qwen3.6 35B A3B" (a bare number after a versioned name is its minor version). */
export function modelLabel(id: string): string {
  const name = (id.split("/").pop() ?? id).replace(/:.*$/, "").replace(/-\d+k$/i, "");
  const parts = name.split("-").reduce<string[]>((out, w) => {
    if (/^\d+$/.test(w) && /\d$/.test(out.at(-1) ?? "")) out[out.length - 1] += `.${w}`; else out.push(w);
    return out;
  }, []);
  return parts.map((w) => (/^a?\d+(\.\d+)?[bm]$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

// The LLM gateway in front of our GPUs (gateway.ai4wa.com, PascalSun/LLMGateway) queues the calls to them and says how
// long a new one would wait (/queue?model=…, open to any page): the chat bar shows it beside the local model.
const GATEWAYS = (process.env.LLM_GATEWAYS || "https://gateway.ai4wa.com,https://llm.nlp-tlp.org").split(",").map((g) => g.trim().replace(/\/$/, "")).filter(Boolean);

/** The gateway's queue for a local model, when the local model is reached through the gateway (else undefined). */
function queueFor(model: string): string | undefined {
  const base = (process.env.OLLAMA_BASE_URL || OLLAMA_BASE_URL).replace(/\/$/, "");
  const root = GATEWAYS.find((g) => base === g || base.startsWith(g + "/"));
  return root ? `${root}/queue?model=${encodeURIComponent(model)}` : undefined;
}
const localQueue = () => queueFor(localModel());

/** `fallback`: the smaller local model a chat goes to while this one is busy. */
type Choice = { id: ChatChoice; label: string; model: string; queue?: string; fallback?: string };

/** What the chat bar offers: the cloud model always, the local one when Ollama is configured (with its queue). */
export function chatChoices(): { default: ChatChoice; options: Choice[] } {
  const options: Choice[] = [{ id: "cloud", label: "Cloud", model: modelLabel(cloudModel()) }];
  if (ollamaReady()) options.push({ id: "local", label: "Local", model: modelLabel(localModel()), queue: localQueue(),
    ...(fallbackModel() && fallbackModel() !== localModel() ? { fallback: modelLabel(fallbackModel()) } : {}) });
  return { default: providerFor() === "ollama" ? "local" : "cloud", options };
}

/** What an answer is labelled with in the chat: which side served it and the model's name. */
export function chatTag(choice?: unknown, local?: string): { llm: ChatChoice; model: string } {
  return providerFor(choice) === "ollama" ? { llm: "local", model: modelLabel(local ?? localModel()) } : { llm: "cloud", model: modelLabel(cloudModel()) };
}

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    "HTTP-Referer": "https://groundedgeo.local",
    "X-OpenRouter-Title": "CoreFlagging",
  },
});

export function chatModel(choice?: unknown, local?: string): LanguageModel {
  if (providerFor(choice) === "ollama") {
    const ollama = createOpenAICompatible({
      name: "ollama",
      baseURL: process.env.OLLAMA_BASE_URL || OLLAMA_BASE_URL,
      apiKey: process.env.OLLAMA_API_KEY || undefined,
      headers: { "X-Priority": "interactive" },               // a person waits on a chat: the gateway puts it first
    });
    // vLLM's qwen3 reasoning parser sends the thinking apart (`reasoning`), which the provider turns into reasoning
    // parts. Should a model or server not split it, the thinking comes inline as <think>…</think> in the answer:
    // the middleware lifts it out, so it shows as thinking, not as the answer (and is not sent back as history).
    return wrapLanguageModel({ model: ollama(local ?? localModel()), middleware: extractReasoningMiddleware({ tagName: "think" }) });
  }
  return openrouter(cloudModel());
}
