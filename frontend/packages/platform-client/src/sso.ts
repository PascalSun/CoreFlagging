// One sign-in for every research app: the platform is the identity provider.
//
// signIn() sends the browser to the platform's authorize page; the platform signs the person in (an emailed
// code, or a password) if it has not already, and sends them back to this app's /auth/callback with a code.
// completeSignIn() turns the code into tokens. A browser cannot keep a client secret, so PKCE does the
// proving: a random verifier stays in this tab, its hash goes with the request, and only the tab that started
// the sign-in can finish it. Once signed in on the platform, every other app signs in without a prompt.

import { clearAuth, getAuth, setAuth, type Auth } from "./auth";

import { PLATFORM_URL as PLATFORM } from "./fetch";
const KEY = "platform.sso.pending";
// "openid" asks for an ID token, which the platform issues only where its OIDC key is set (production); a dev
// platform without one refuses the scope, so it is left out there
export const SSO_SCOPE = (process.env.NEXT_PUBLIC_PLATFORM_OIDC === "0" ? "" : "openid ") + "email read write";

const b64url = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s: string) => b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

/** The OAuth client id of the app on this host: "<app>-web", from the app's env, else from the host name. */
export function clientId(): string {
  const fromEnv = process.env.NEXT_PUBLIC_PLATFORM_CLIENT_ID;
  if (fromEnv) return fromEnv;
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const app = host.split(".")[0].replace(/^www$/, "");
  return `${app && app !== "localhost" ? app : "minetrace"}-web`;
}

export function callbackUrl(): string {
  return `${window.location.origin}/auth/callback`;
}

/** Send the browser to the platform to sign in; it comes back to /auth/callback and then to `returnTo`. */
export async function signIn(returnTo: string = window.location.pathname + window.location.search): Promise<void> {
  const verifier = random(48), state = random(16);
  sessionStorage.setItem(KEY, JSON.stringify({ verifier, state, returnTo }));
  const q = new URLSearchParams({
    response_type: "code", client_id: clientId(), redirect_uri: callbackUrl(), scope: SSO_SCOPE,
    code_challenge: await sha256(verifier), code_challenge_method: "S256", state,
  });
  window.location.assign(`${PLATFORM}/o/authorize/?${q}`);
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; id_token?: string; error?: string };

async function tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${PLATFORM}/o/token/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) throw new Error(data.error || `token request failed (${res.status})`);
  return data;
}

async function authFromTokens(t: TokenResponse, prev?: Partial<Auth>): Promise<Auth> {
  const me = await fetch(`${PLATFORM}/authenticate/api/me/`, { headers: { Authorization: `Bearer ${t.access_token}` } });
  const m = me.ok ? ((await me.json()) as { id: number | string; email: string; verified?: boolean }) : null;
  return {
    userId: String(m?.id ?? prev?.userId ?? ""), email: m?.email ?? prev?.email ?? "",
    token: t.access_token, refresh: t.refresh_token ?? prev?.refresh, verified: m?.verified ?? true,
    kind: "oauth", clientId: clientId(), exp: Math.floor(Date.now() / 1000) + (t.expires_in ?? 3600),
  };
}

/** On /auth/callback: finish the sign-in. Returns where to go next. Throws if the callback is not ours. */
export async function completeSignIn(): Promise<string> {
  const q = new URLSearchParams(window.location.search);
  const pending = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { verifier: string; state: string; returnTo: string } | null;
  sessionStorage.removeItem(KEY);
  const code = q.get("code"), state = q.get("state");
  if (q.get("error")) throw new Error(q.get("error_description") || q.get("error") || "sign-in refused");
  if (!code || !pending || state !== pending.state) throw new Error("This sign-in did not start in this tab. Start again.");
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: callbackUrl(), client_id: clientId(), code_verifier: pending.verifier });
  setAuth(await authFromTokens(t));
  return pending.returnTo && pending.returnTo.startsWith("/") ? pending.returnTo : "/";
}

/** A fresh access token from the refresh token, or null (the session is over: the caller signs out). */
export async function refreshOAuth(auth: Auth): Promise<string | null> {
  if (!auth.refresh) return null;
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: auth.refresh, client_id: auth.clientId ?? clientId() });
    setAuth(await authFromTokens(t, auth));
    return t.access_token;
  } catch {
    clearAuth();
    return null;
  }
}

/** Sign out of this app: forget the tokens here and tell the platform to revoke them. The platform's own
 * session stays (another app may be using it); signing out there is /o/logout on the platform. */
export async function signOut(): Promise<void> {
  const a = getAuth(); clearAuth();
  if (a?.kind !== "oauth") return;
  for (const [tok, hint] of [[a.refresh, "refresh_token"], [a.token, "access_token"]] as const) {
    if (!tok) continue;
    try { await fetch(`${PLATFORM}/o/revoke_token/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: tok, token_type_hint: hint, client_id: a.clientId ?? clientId() }).toString() }); } catch { /* best effort */ }
  }
}
