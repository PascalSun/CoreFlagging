import { chatChoices } from "@/lib/ai/provider";

// The models the chat bar offers (cloud, and local when Ollama is configured) and the default.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(chatChoices());
}
