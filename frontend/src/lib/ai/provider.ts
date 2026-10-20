import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

// The assistant's model. OpenRouter by default: Gemini Flash (thinking) — thinking is on by
// default for these models, so no special config is needed; `sendReasoning: true` on the
// stream surfaces it. Override with CHAT_MODEL (a `creator/model` slug).
//
// CHAT_PROVIDER=ollama switches to our own GPU's Ollama instead (OpenAI-compatible API):
// OLLAMA_BASE_URL, OLLAMA_API_KEY and OLLAMA_MODEL, defaulting to the house "Home GPU" model.
// No per-token cost; a smaller model, so answers are slower and plainer.
const DEFAULT_MODEL = "google/gemini-2.5-flash";
const OLLAMA_BASE_URL = "https://ollama.ai4wa.com/v1";
const OLLAMA_MODEL = "qwen3-8b-32k";

export type ChatProvider = "openrouter" | "ollama";

export function chatProvider(): ChatProvider {
  return process.env.CHAT_PROVIDER?.trim().toLowerCase() === "ollama" ? "ollama" : "openrouter";
}

/** The model id the usage log records. */
export function chatModelId(): string {
  return chatProvider() === "ollama" ? `ollama/${process.env.OLLAMA_MODEL || OLLAMA_MODEL}` : process.env.CHAT_MODEL || DEFAULT_MODEL;
}

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    "HTTP-Referer": "https://groundedgeo.local",
    "X-OpenRouter-Title": "CoreFlagging",
  },
});

export function chatModel(): LanguageModel {
  if (chatProvider() === "ollama") {
    const ollama = createOpenAICompatible({
      name: "ollama",
      baseURL: process.env.OLLAMA_BASE_URL || OLLAMA_BASE_URL,
      apiKey: process.env.OLLAMA_API_KEY || undefined,
    });
    return ollama(process.env.OLLAMA_MODEL || OLLAMA_MODEL);
  }
  return openrouter(process.env.CHAT_MODEL || DEFAULT_MODEL);
}
