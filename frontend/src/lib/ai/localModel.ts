// Which local model answers a chat now. The local model lives on the 5090 behind the LLM gateway, which also runs
// GeoThought's batch work there; when its queue is deep a person would wait, so the chat goes to the smaller model on
// the other GPU (the 3080) instead. The gateway's /queue?model=… says, per model: whether a backend has it, how many
// calls run against how many slots, and how long a new interactive call would wait.

export type Queue = {
  available?: boolean; running?: number; parallel?: number; waiting?: number;
  eta_s?: { interactive?: number; batch?: number };
};

/** A person would wait too long on this model now (or nothing serves it). */
export function busy(q: Queue | null, maxWaitS: number): boolean {
  if (!q || q.available === false) return true;
  if ((q.eta_s?.interactive ?? 0) > maxWaitS) return true;
  return q.parallel != null && q.running != null && q.running >= q.parallel;
}

async function queueOf(url: string, fetcher: typeof fetch, timeoutMs: number): Promise<Queue | null> {
  try {
    const r = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    return r.ok ? ((await r.json()) as Queue) : null;
  } catch {
    return null;
  }
}

/** The model to use: the main one unless it is busy and the fallback is not (a gateway that does not answer leaves
 *  the main one: no news is no reason to answer worse). */
export async function pickLocalModel(o: {
  primary: string; fallback?: string; queueUrl: (model: string) => string | undefined;
  maxWaitS?: number; timeoutMs?: number; fetcher?: typeof fetch;
}): Promise<{ model: string; fellBack: boolean }> {
  const { primary, fallback, queueUrl, maxWaitS = 20, timeoutMs = 1500, fetcher = fetch } = o;
  const url = queueUrl(primary);
  if (!fallback || fallback === primary || !url) return { model: primary, fellBack: false };
  const q = await queueOf(url, fetcher, timeoutMs);
  if (q === null || !busy(q, maxWaitS)) return { model: primary, fellBack: false };
  const fUrl = queueUrl(fallback);
  const fq = fUrl ? await queueOf(fUrl, fetcher, timeoutMs) : null;
  if (fq !== null && busy(fq, maxWaitS)) return { model: primary, fellBack: false };   // both busy: the better one
  return { model: fallback, fellBack: true };
}
