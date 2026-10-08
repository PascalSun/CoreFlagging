import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

// Chat model via OpenRouter. Gemini Flash (thinking) by default — thinking is on by
// default for these models, so no special config is needed; `sendReasoning: true` on
// the stream surfaces it. Override with CHAT_MODEL (a `creator/model` slug).
const DEFAULT_MODEL = "google/gemini-2.5-flash";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    "HTTP-Referer": "https://groundedgeo.local",
    "X-OpenRouter-Title": "MineTrace",
  },
});

export function chatModel(): LanguageModel {
  return openrouter(process.env.CHAT_MODEL ?? DEFAULT_MODEL);
}
