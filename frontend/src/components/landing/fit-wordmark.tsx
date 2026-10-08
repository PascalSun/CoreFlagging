import { cn } from "@/lib/utils";

type FitWordmarkProps = {
  text?: string;
  /**
   * The text's natural width in em for the styling applied via className
   * (measured once: "NLP-TLP" in Plus Jakarta Sans 600 at -0.06em tracking).
   * `textLength` force-fits the text regardless, so small inaccuracies only
   * cause invisible glyph-spacing adjustments — but keep this roughly right
   * if the text or font changes.
   */
  emWidth?: number;
  className?: string;
};

// SVG user units. Width is arbitrary; everything scales with the container.
const VIEW_WIDTH = 1000;
const BOTTOM_GAP = 16; // ≈1.6% of width — small gap to the container edge
const HEADROOM = 12; // absorbs cap-height metric differences at the top

/**
 * Wordmark that always spans exactly its container's width — the same
 * technique as the reference site: a fixed-proportion SVG that scales like
 * an image. Rendered fully on the server, so it paints once at its final
 * geometry (no hydration flash) and tracks window resizes for free.
 */
export function FitWordmark({
  text = "NLP-TLP",
  emWidth = 4.1455,
  className,
}: FitWordmarkProps) {
  const fontSize = VIEW_WIDTH / emWidth;
  const capHeight = 0.73 * fontSize;
  const viewHeight = Math.round(capHeight + HEADROOM + BOTTOM_GAP);
  const baselineY = viewHeight - BOTTOM_GAP;

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${viewHeight}`}
      className={cn("block w-full", className)}
      aria-hidden
      focusable="false"
    >
      <text
        x="0"
        y={baselineY}
        textLength={VIEW_WIDTH}
        lengthAdjust="spacingAndGlyphs"
        fontSize={fontSize}
        className="fill-current"
      >
        {text}
      </text>
    </svg>
  );
}
