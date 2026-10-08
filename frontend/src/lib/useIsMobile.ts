"use client";

// One definition of "phone", instead of `window.innerWidth < 640` written out at every
// call site. Three of those had drifted into ChatDock alone, and none of them re-ran when
// the window crossed the breakpoint — a desktop window dragged narrow kept the desktop
// behaviour until a reload.
//
// 640px is Tailwind's `sm`, so the JS answer and the CSS answer are the same answer.

import { useEffect, useState } from "react";

export const PHONE_QUERY = "(max-width: 639px)";

/**
 * True on phone-width viewports, live.
 *
 * Starts `false` on the server and on the first client paint, so the markup React hydrates
 * matches what the server sent; the real answer arrives in the effect, one frame later.
 * Anything that must be right in that first frame belongs in a CSS media query instead —
 * this hook is for behaviour (detents, drag handlers, focus moves), not for layout.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return mobile;
}
