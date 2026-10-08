"use client";

// app-side hooks the package still leans on; Phase 2 makes these injectable so the package has no app imports
import { track } from "@/lib/analytics";
import { site } from "@/lib/landing-site";

// Client-side "session": sign-in returns a userId + token which we cache in localStorage.
// Signed in == holding a live (or revivable) token. Whether the token carries the
// verified-email claim (`ver`) is a separate question (isVerified): an email-only sign-in
// opens an unverified session in a grace period, and the assistant / private data stay
// closed until the emailed link is used.
const KEY = "gg_auth";

// `token` is the short-lived access token; `refresh` is the long-lived (90d) refresh token used to
// silently mint new access tokens so the user isn't unexpectedly logged out.
export type Auth = {
  userId: string; email: string; token: string; refresh?: string; verified?: boolean;
  /** ISO time by which an unverified session must verify (grace period end), if known. */
  verificationDueAt?: string | null;
  /** "oauth": tokens from the platform's sign-in (see sso.ts), opaque, with their own expiry and refresh. */
  kind?: "jwt" | "oauth"; clientId?: string; exp?: number;
};

export function getAuth(): Auth | null {
  if (typeof window === "undefined") return null;
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as Auth) : null;
  } catch {
    return null;
  }
}

export function setAuth(a: Auth): void {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* ignore */ }
}

export function clearAuth(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Seconds since the epoch this JWT stops being accepted, or null if it is not one. */
function expiryOf(token: string | undefined | null): number | null {
  if (!token) return null;
  try {
    const claims = JSON.parse(atob(token.split(".")[1] ?? "")) as { exp?: number };
    return typeof claims.exp === "number" ? claims.exp : null;
  } catch { return null; }
}

/** A token we can still do something with: either it is live, or a refresh can revive it.
 *
 *  Presence used to be the whole test, and presence outlives usefulness: the access token
 *  lasts an hour, so an hour in the UI still said "signed in" while every data call came
 *  back "sign in to browse the data". The reader is told to do the one thing they already
 *  did. Worse for a session predating refresh tokens (`refresh` is optional), where there
 *  is nothing to revive it with and the state never resolves itself. */
export function isAuthed(): boolean {
  const a = getAuth();
  if (!a?.token) return false;
  const now = Date.now() / 1000;
  if (a.kind === "oauth") return (a.exp ?? 0) > now || !!a.refresh;
  const access = expiryOf(a.token);
  if (access === null || access > now) return true;      // live, or not a JWT we can read
  const refresh = expiryOf(a.refresh);
  return refresh !== null && refresh > now;              // dead, but revivable
}

export function authToken(): string | null {
  return getAuth()?.token ?? null;
}

export function refreshToken(): string | null {
  return getAuth()?.refresh ?? null;
}

const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_URL ?? "";

/** Exchange the stored refresh token for a fresh access token (updates the cache). Returns the new
 *  access token, or null if there's no refresh token or the refresh failed (→ caller logs out). */
export async function refreshAccessToken(): Promise<string | null> {
  const auth = getAuth();
  if (auth?.kind === "oauth") return (await import("./sso")).refreshOAuth(auth);
  if (!auth?.refresh) {
    // A session from before refresh tokens existed. Nothing can revive it, and keeping it
    // only sustains the illusion of being signed in.
    if (auth) clearAuth();
    return null;
  }
  try {
    const res = await fetch(`${PLATFORM}/authenticate/api/token/refresh/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh: auth.refresh }),
    });
    if (!res.ok) {
      // The refresh token is spent. Leaving the stale auth in place is what kept the UI
      // claiming a session that no endpoint would honour — drop it so the app can ask for
      // a sign-in instead of repeating "sign in" at someone who believes they are.
      clearAuth();
      return null;
    }
    const data = (await res.json()) as { access: string };
    setAuth({ ...auth, token: data.access });
    return data.access;
  } catch {
    return null;
  }
}

/** Re-exported from the site config so the address has exactly one definition. */
export const SUPPORT_EMAIL_FALLBACK = site.email;

export type EmailSignInResult =
  | { status: "in"; auth: Auth; linkSent: boolean; supportEmail: string }
  /** The address already has an account: no session was opened. A one-time CODE went by
   *  mail (unless rate-limited) — not a link, which on a corporate Microsoft tenant is the
   *  thing that does not arrive. The user types the code, uses the password, or asks
   *  support; a link can still be requested explicitly. */
  | { status: "exists"; email: string; codeSent: boolean; linkSent: boolean; supportEmail: string };

/** Sign in with an email alone. A NEW address gets a session at once (unverified, in its
 *  grace period) plus the welcome mail with link + password. An existing account is never
 *  opened by its address alone — see EmailSignInResult. */
export async function signInWithEmail(email: string): Promise<EmailSignInResult> {
  const res = await fetch(`${PLATFORM}/authenticate/api/email-signin/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error === "invalid_email" ? "Please enter a valid email." : "Sign-in failed. Please try again.");
  }
  const data = (await res.json()) as Auth & { exists: boolean; codeSent?: boolean; linkSent: boolean; supportEmail?: string };
  const supportEmail = data.supportEmail || SUPPORT_EMAIL_FALLBACK;
  if (data.exists) return { status: "exists", email: data.email, codeSent: !!data.codeSent, linkSent: data.linkSent, supportEmail };
  const auth: Auth = { userId: data.userId, email: data.email, token: data.token, refresh: data.refresh,
    verified: false, verificationDueAt: data.verificationDueAt ?? null };
  setAuth(auth);
  track("sign_in", { method: "email" });
  return { status: "in", auth, linkSent: data.linkSent, supportEmail };
}

/** The button in the email: turn the link token into a verified session (any browser).
 *  `newPassword` is set when this link created the account password (it is also mailed). */
export async function verifyWithLink(token: string): Promise<{ auth: Auth; newPassword: string | null }> {
  const res = await fetch(`${PLATFORM}/authenticate/api/verify-link/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error("This link is invalid or has expired.");
  const data = (await res.json()) as Auth & { newPassword?: string | null };
  const auth: Auth = { userId: data.userId, email: data.email, token: data.token, refresh: data.refresh, verified: true };
  setAuth(auth);
  track("email_verified", { method: "link" });
  return { auth, newPassword: data.newPassword ?? null };
}

/** Send the sign-in link again. `reset` makes the link land on the change-password form
 *  (the "forgot password" flow: the link proves the address, then a new password is set). */
export async function resendVerifyLink(email: string, opts: { reset?: boolean } = {}): Promise<void> {
  const res = await fetch(`${PLATFORM}/authenticate/api/resend-link/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, reset: !!opts.reset }),
  });
  if (res.ok) return;
  if (res.status === 429) throw new Error("Too many emails requested. Please wait a while and try again.");
  if (res.status === 502) throw new Error("We could not send the email. Please try again later.");
  throw new Error("Could not send the link. Please try again.");
}

/** Days left in the grace period of the cached unverified session (null once verified).
 *
 *  An unverified session with no due date is OVER, not unknown. Sessions cached before the
 *  grace period existed carry no `verificationDueAt`, and returning null for them meant
 *  every `graceDaysLeft() === 0` guard missed the very users it was written for: they sat
 *  signed in, unverified, shown "? days left", until some call came back 403. A session
 *  that cannot prove it is still inside a grace period is not inside one. */
export function graceDaysLeft(): number | null {
  const a = getAuth();
  if (!a || isVerified()) return null;
  if (!a.verificationDueAt) return 0;
  return Math.max(0, Math.ceil((new Date(a.verificationDueAt).getTime() - Date.now()) / 86_400_000));
}

/** A cached session that can no longer be used: signed in, never verified, and out of its
 *  grace period. Such a session is dropped and the visitor sent back through sign-in —
 *  there is nothing it can still do, and the landing page is where a fresh verification
 *  link (or the account password) is obtained. */
export function mustReverify(): boolean {
  return isAuthed() && !isVerified() && graceDaysLeft() === 0;
}

/** Does the cached token carry the verified-email claim (`ver`)? The assistant and private
 *  data require it. The claim rides on the refresh token, so a session that verified once
 *  stays verified through refreshes; an email-only session never gains it by itself. */
export function isVerified(): boolean {
  const a = getAuth();
  if (!a?.token) return false;
  try {
    const claims = JSON.parse(atob(a.token.split(".")[1] ?? "")) as { ver?: number };
    return typeof claims.ver === "number";
  } catch { return false; }
}

/** Step 1 of sign-in: have the platform email a one-time code. */
export async function requestEmailCode(email: string): Promise<void> {
  const res = await fetch(`${PLATFORM}/authenticate/api/code/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (res.ok) return;
  const err = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 429) throw new Error("Too many codes requested. Please wait a while and try again.");
  if (err.error === "invalid_email") throw new Error("Please enter a valid email.");
  if (err.error === "delivery_failed") throw new Error("We could not send the email. Please try again later.");
  throw new Error("Could not send the code. Please try again.");
}

/** Step 2: exchange email + code for a verified session (replaces the cached one). The user
 *  keeps the same account id as any earlier beta session for that email. This is the only
 *  way to open a session: the platform no longer issues tokens for an unproven address. */
export async function verifyEmailCode(email: string, code: string): Promise<Auth> {
  const res = await fetch(`${PLATFORM}/authenticate/api/verify/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error === "invalid_code" ? "That code is wrong or has expired." : "Verification failed. Please try again.");
  }
  const data = (await res.json()) as Auth;
  const auth: Auth = { userId: data.userId, email: data.email, token: data.token, refresh: data.refresh, verified: true };
  setAuth(auth);
  track("sign_in");
  track("email_verified");
  return auth;
}

/** Sign in with email + the account password (welcome mail / account card). The session
 *  this opens is verified: the password only ever reached the user by email. */
export async function signInWithPassword(email: string, password: string): Promise<Auth> {
  const res = await fetch(`${PLATFORM}/authenticate/api/password-signin/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 429) throw new Error("Too many attempts. Please wait a while and try again.");
    if (res.status === 401 || err.error === "invalid_credentials") throw new Error("Wrong email or password.");
    if (err.error === "invalid_request") throw new Error("Please enter your email and password.");
    throw new Error("Sign-in failed. Please try again.");
  }
  const data = (await res.json()) as Auth;
  const auth: Auth = { userId: data.userId, email: data.email, token: data.token, refresh: data.refresh, verified: true };
  setAuth(auth);
  track("sign_in", { method: "password" });
  return auth;
}

export type Me = {
  userId: number; email: string; verified: boolean;
  emailVerifiedAt: string | null; verificationDueAt: string | null; graceActive: boolean;
  passwordSet: boolean; dateJoined: string;
};

/** The platform's view of the current session (refreshing the access token once if needed). */
export async function fetchMe(): Promise<Me | null> {
  const attempt = async (tok: string) =>
    fetch(`${PLATFORM}/authenticate/api/me/`, { headers: { Authorization: `Bearer ${tok}` } });
  let tok = authToken();
  if (!tok) return null;
  let res = await attempt(tok);
  if (res.status === 401) {
    tok = await refreshAccessToken();
    if (!tok) return null;
    res = await attempt(tok);
  }
  if (!res.ok) return null;
  return (await res.json()) as Me;
}

/** Set a new account password (used for the MCP / OAuth login page). Needs a verified session;
 *  the platform validates strength and answers with the reasons when it refuses. */
export async function changePassword(newPassword: string): Promise<void> {
  const send = async (tok: string) =>
    fetch(`${PLATFORM}/authenticate/api/password/`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ new_password: newPassword }),
    });
  let tok = authToken();
  if (!tok) throw new Error("Please sign in first.");
  let res = await send(tok);
  if (res.status === 401) {
    tok = await refreshAccessToken();
    if (!tok) throw new Error("Please sign in first.");
    res = await send(tok);
  }
  if (res.ok) { track("password_changed"); return; }
  const err = (await res.json().catch(() => ({}))) as { error?: string; messages?: string[] };
  if (err.error === "weak_password" && err.messages?.length) throw new Error(err.messages.join(" "));
  if (res.status === 403) throw new Error("Please verify your email first.");
  throw new Error("Could not change the password. Please try again.");
}

/** Send feedback from inside the product. The page and the browser travel with it — the
 *  server reads the browser off the request, we send the page, and neither is something a
 *  person writing "it doesn't work" would think to include. */
export async function sendFeedback(kind: "problem" | "idea" | "other", message: string): Promise<void> {
  const body = JSON.stringify({ kind, message, page: typeof window !== "undefined" ? window.location.href : "" });
  const send = async (tok: string) =>
    fetch(`${PLATFORM}/authenticate/api/feedback/`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body,
    });
  let tok = authToken();
  if (!tok) throw new Error("signed_out");
  let res = await send(tok);
  if (res.status === 401) {
    tok = await refreshAccessToken();
    if (!tok) throw new Error("signed_out");
    res = await send(tok);
  }
  if (res.ok) { track("feedback_sent", { kind }); return; }
  const err = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(err.error === "rate_limited" ? "rate_limited" : "failed");
}
