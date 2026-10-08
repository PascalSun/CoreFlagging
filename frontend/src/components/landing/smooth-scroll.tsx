"use client";

import { useEffect } from "react";
import Lenis from "lenis";

// Module singleton so siblings (e.g. the features carousel's snap point) can
// drive the same instance — programmatic lenis.scrollTo wins over in-flight
// inertia, which native window.scrollTo(smooth) does not.
let activeLenis: Lenis | null = null;
/** The live Lenis instance for this page, or null when smoothing is off. */
export function getLenis(): Lenis | null {
  return activeLenis;
}

/** Lenis smooth scrolling, matching the landing template's scroll feel.
 * Mounted on the landing page only — the map workspace keeps native wheel
 * handling (mapbox zoom etc.). */
export function SmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({ lerp: 0.12 });
    activeLenis = lenis;
    let frame: number;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);
    return () => {
      cancelAnimationFrame(frame);
      activeLenis = null;
      lenis.destroy();
    };
  }, []);

  return null;
}
