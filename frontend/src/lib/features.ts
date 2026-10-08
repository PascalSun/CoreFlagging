"use client";

/**
 * Which features the platform is currently offering.
 *
 * The answer rides on /healthz, which the status indicator already polls every 30
 * seconds, so a switch thrown in the admin reaches an open tab without a deploy and
 * without a second endpoint. One request per page load serves every caller: the fetch is
 * a module-level promise, so ten components asking make one call between them.
 *
 * Everything defaults to ON. A flag that fails open is a feature that works when the
 * probe is slow or the platform is mid-deploy; a flag that fails closed is a button that
 * vanishes for everyone the moment a health check times out.
 */

import { useEffect, useState } from "react";

const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_URL ?? "";

export type FeatureName = "feedback" | "share_email";

let inFlight: Promise<Record<string, boolean>> | null = null;

function load(): Promise<Record<string, boolean>> {
  inFlight ??= (async () => {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 4000);
      const res = await fetch(`${PLATFORM}/healthz/`, { signal: ctl.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!res.ok) return {};
      const body = (await res.json()) as { features?: Record<string, boolean> };
      return body.features ?? {};
    } catch {
      return {};
    }
  })();
  return inFlight;
}

/** True until the platform says otherwise. */
export function useFeature(name: FeatureName): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    let alive = true;
    void load().then((f) => { if (alive && f[name] === false) setOn(false); });
    return () => { alive = false; };
  }, [name]);
  return on;
}
