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

/** "google/gemini-3.1-flash-lite" → "Gemini 3.1 Flash Lite", "qwen3-8b-32k" → "Qwen3 8B". */
export function modelLabel(id: string): string {
  const name = (id.split("/").pop() ?? id).replace(/:.*$/, "").replace(/-\d+k$/i, "");
  return name.split("-").map((w) => (/^\d+(\.\d+)?[bm]$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

/** What the chat bar offers: the cloud model always, the local one when Ollama is configured. */
export function chatChoices(): { default: ChatChoice; options: { id: ChatChoice; label: string; model: string }[] } {
  const options: { id: ChatChoice; label: string; model: string }[] = [{ id: "cloud", label: "Cloud", model: modelLabel(cloudModel()) }];
  if (ollamaReady()) options.push({ id: "local", label: "Local", model: modelLabel(localModel()) });
  return { default: providerFor() === "ollama" ? "local" : "cloud", options };
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
    });
    return ollama(localModel());
  }
  return openrouter(cloudModel());
}
