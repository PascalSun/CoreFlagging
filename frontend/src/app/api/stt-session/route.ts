// A live speech-to-text session for the signed-in user's microphone (lib/dictation.ts): this server asks the LLM gateway
// for a one-use token with the site's gateway key (STT_GATEWAY_KEY; never sent to the page) and returns the socket's URL.
// The page then streams its microphone straight to the gateway (our Whisper on the GPU). Signed-in, verified users only:
// the GPU is ours to spend.
import { STT_VOCAB } from "@/lib/sttVocab";

export const runtime = "nodejs";

const PLATFORM = (process.env.PLATFORM_API_URL ?? process.env.NEXT_PUBLIC_PLATFORM_URL ?? "https://platform.nlp-tlp.org").replace(/\/$/, "");
const GATEWAY = (process.env.STT_GATEWAY_URL ?? "https://gateway.ai4wa.com").replace(/\/$/, "");

/** The gateway key: STT_GATEWAY_KEY, else the local model's key when that model is reached through the gateway. */
function gatewayKey(): string {
  if (process.env.STT_GATEWAY_KEY) return process.env.STT_GATEWAY_KEY;
  const local = process.env.OLLAMA_BASE_URL ?? "";
  return /gateway\.ai4wa\.com|llm\.nlp-tlp\.org/.test(local) ? (process.env.OLLAMA_API_KEY ?? "") : "";
}

async function signedIn(req: Request): Promise<boolean> {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) return false;
  try {
    const r = await fetch(`${PLATFORM}/authenticate/api/me/`, { headers: { Authorization: h }, cache: "no-store" });
    if (!r.ok) return false;
    const u = (await r.json()) as { verified?: boolean };
    return u.verified !== false;
  } catch { return false; }
}

export async function POST(req: Request) {
  const key = gatewayKey();
  if (!key) return Response.json({ error: "speech to text is not set up here" }, { status: 503 });
  if (!(await signedIn(req))) return Response.json({ error: "sign in to use our speech to text" }, { status: 401 });
  let lang = "en";
  try { lang = String(((await req.json()) as { lang?: string }).lang ?? "en"); } catch { /* the default */ }
  const base = lang.split("-")[0].toLowerCase();
  try {
    const r = await fetch(`${GATEWAY}/v1/audio/sessions`, {
      method: "POST", cache: "no-store",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Priority": "interactive" },
      // the language is detected from the speech (one may speak Chinese with the English page); the vocabulary
      // follows the page's language
      body: JSON.stringify({ prompt: STT_VOCAB[base] ?? STT_VOCAB.en }),
    });
    if (!r.ok) return Response.json({ error: `gateway ${r.status}` }, { status: 502 });
    const s = (await r.json()) as { url: string; expires_in: number };
    return Response.json({ url: s.url, expires_in: s.expires_in }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "the gateway is not reachable" }, { status: 502 });
  }
}
