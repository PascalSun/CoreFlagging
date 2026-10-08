"use client";

import { useEffect } from "react";
import { signIn } from "@ntlp/platform-client";

/** /auth/signin?next=/where: the one way into the platform's sign-in from this app. */
export default function SignInPage() {
  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get("next") ?? "/";
    signIn(next.startsWith("/") ? next : "/");
  }, []);
  return <main className="grid min-h-dvh place-items-center bg-slate-50 text-sm text-slate-600">Taking you to sign in…</main>;
}
