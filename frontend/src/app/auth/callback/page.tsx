"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { completeSignIn } from "@ntlp/platform-client";

/** Where the platform sends the browser back after signing in. Finishes the sign-in and goes on. */
export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    completeSignIn().then((to) => window.location.replace(to)).catch((e: Error) => setError(e.message));
  }, []);
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-6 text-center text-sm text-slate-600">
      {error ? (
        <div className="max-w-sm">
          <p className="font-medium text-slate-900">Sign-in did not finish</p>
          <p className="mt-1">{error}</p>
          <Link href="/" className="mt-4 inline-block rounded-full bg-slate-900 px-4 py-2 text-white">Back to the app</Link>
        </div>
      ) : "Signing you in…"}
    </main>
  );
}
