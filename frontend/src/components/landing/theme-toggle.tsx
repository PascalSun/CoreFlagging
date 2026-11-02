"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_EVENT, applyTheme, savedTheme, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "light" };
const LABEL: Record<ThemeChoice, string> = { system: "Theme: night", light: "Theme: day", dark: "Theme: night" };

function subscribe(cb: () => void) {
  window.addEventListener(THEME_EVENT, cb);
  window.addEventListener("storage", cb);              // another tab changed it
  return () => { window.removeEventListener(THEME_EVENT, cb); window.removeEventListener("storage", cb); };
}

/** Night (the default) or day; a press switches to the other. The icon shows the current choice; the label says it
 * and what a press does. The choice is saved and applied before paint on the next visit (lib/theme.ts). */
export function ThemeToggle({ className }: { className?: string }) {
  // the saved choice, read after hydration (the server renders night); a press re-reads it through the event
  const choice = useSyncExternalStore(subscribe, savedTheme, () => "dark" as ThemeChoice);
  const Icon = choice === "light" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => applyTheme(NEXT[choice])}
      aria-label={`${LABEL[choice]}. Switch to ${LABEL[NEXT[choice]].replace("Theme: ", "")}`}
      title={LABEL[choice]}
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-full border border-line text-ink transition-colors hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan",
        className
      )}
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}
