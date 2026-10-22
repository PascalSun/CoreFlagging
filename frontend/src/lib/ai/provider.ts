import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

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

/** The model id the usage log records. */
export function chatModelId(choice?: unknown): string {
  return providerFor(choice) === "ollama" ? `ollama/${localModel()}` : cloudModel();
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

/** The gateway's queue for the local model, when the local model is reached through the gateway (else undefined). */
function localQueue(): string | undefined {
  const base = (process.env.OLLAMA_BASE_URL || OLLAMA_BASE_URL).replace(/\/$/, "");
  const root = GATEWAYS.find((g) => base === g || base.startsWith(g + "/"));
  return root ? `${root}/queue?model=${encodeURIComponent(localModel())}` : undefined;
}

type Choice = { id: ChatChoice; label: string; model: string; queue?: string };

/** What the chat bar offers: the cloud model always, the local one when Ollama is configured (with its queue). */
export function chatChoices(): { default: ChatChoice; options: Choice[] } {
  const options: Choice[] = [{ id: "cloud", label: "Cloud", model: modelLabel(cloudModel()) }];
  if (ollamaReady()) options.push({ id: "local", label: "Local", model: modelLabel(localModel()), queue: localQueue() });
  return { default: providerFor() === "ollama" ? "local" : "cloud", options };
}

/** What an answer is labelled with in the chat: which side served it and the model's name. */
export function chatTag(choice?: unknown): { llm: ChatChoice; model: string } {
  return providerFor(choice) === "ollama" ? { llm: "local", model: modelLabel(localModel()) } : { llm: "cloud", model: modelLabel(cloudModel()) };
}

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    "HTTP-Referer": "https://groundedgeo.local",
    "X-OpenRouter-Title": "CoreFlagging",
  },
});

export function chatModel(choice?: unknown): LanguageModel {
  if (providerFor(choice) === "ollama") {
    const ollama = createOpenAICompatible({
      name: "ollama",
      baseURL: process.env.OLLAMA_BASE_URL || OLLAMA_BASE_URL,
      apiKey: process.env.OLLAMA_API_KEY || undefined,
      headers: { "X-Priority": "interactive" },               // a person waits on a chat: the gateway puts it first
    });
    return ollama(localModel());
  }
  return openrouter(cloudModel());
}
