// Calling the platform's API as the signed-in person.
//
// One place builds the URL and attaches the bearer token; a 401 on an expired token refreshes it once (one
// refresh in flight at a time, shared by every caller) and retries, and an expired session still reads what
// is public. A research app's frontend reaches the platform through this and nothing else.

import { authToken, refreshAccessToken } from "./auth";

/** The platform's public origin, e.g. https://platform.nlp-tlp.org (NEXT_PUBLIC_PLATFORM_URL). */
export const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL ?? "http://localhost:8001";

let refreshing: Promise<string | null> | null = null;
/** Refresh the access token, once, however many requests hit 401 at the same moment. */
export function sharedRefresh(): Promise<string | null> {
  if (!refreshing) refreshing = refreshAccessToken().finally(() => { refreshing = null; });
  return refreshing;
}

/** fetch() against the platform: `path` is absolute within the API, e.g. "/core-scan/api/holes/". */
export async function platformFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const go = (t: string | null) => fetch(`${PLATFORM_URL}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) } });
  const tok = authToken();
  let res = await go(tok);
  if (res.status === 401 && tok) res = await go(await sharedRefresh());
  return res;
}
