import { chatChoicesNow } from "@/lib/ai/provider";

// The models the chat bar offers (cloud, and local and code when Ollama is configured and the gateway serves them)
// and the default.
export const dynamic = "force-dynamic";

export async function GET() {
  // our models that nothing serves right now (a GPU turned off) are not offered
  return Response.json(await chatChoicesNow());
}
