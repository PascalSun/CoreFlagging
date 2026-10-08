// Thin wrapper over GA4's gtag — safe to call anywhere (no-op on the server or before gtag loads).
type Params = Record<string, string | number | boolean | undefined>;

export function track(event: string, params?: Params) {
  if (typeof window === "undefined") return;
  const g = (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag;
  if (typeof g === "function") g("event", event, params ?? {});
}
