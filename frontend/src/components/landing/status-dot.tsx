"use client";

/* Quiet backend-liveness indicator for the landing navbar: a lone green dot
 * while everything is up; an amber pulsing dot plus a tiny caps label while
 * the stack is redeploying. Same /healthz probe cadence as the workspace's
 * BackendStatus pill, restyled for the landing chrome. */
import { useEffect, useRef, useState } from "react";

const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_URL ?? "";
const UP_MS = 30_000;
const DOWN_MS = 5_000;

type Status = "checking" | "live" | "down";

export function StatusDot() {
  const [status, setStatus] = useState<Status>("checking");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      let next: Status = "down";
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const res = await fetch(`${PLATFORM}/healthz/`, { signal: ctl.signal, cache: "no-store" });
        clearTimeout(t);
        if (res.ok) {
          const body = (await res.json()) as { research?: boolean };
          next = body.research === false ? "down" : "live";
        }
      } catch {
        next = "down";
      }
      if (cancelled) return;
      setStatus(next);
      timer.current = setTimeout(probe, next === "live" ? UP_MS : DOWN_MS);
    };
    probe();
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, []);

  if (status === "checking") return null;
  const live = status === "live";
  return (
    <span
      title={live ? "Platform online" : "Deploying — back soon"}
      className="flex items-center gap-2"
    >
      <span className="relative flex size-2">
        {!live && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange/60" />
        )}
        <span
          className={`relative inline-flex size-2 rounded-full ${live ? "bg-emerald-500" : "bg-orange"}`}
        />
      </span>
      {!live && (
        <span className="label-caps text-[10px] text-orange">Back soon</span>
      )}
    </span>
  );
}
