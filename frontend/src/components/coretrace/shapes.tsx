// Point shapes for the CoreTrace map: colour carries one attribute of a hole, shape a second. Mapbox circles
// cannot change shape, so each (shape, fill, edge) is drawn once on a canvas the first time the map asks for it.

export type Shape = "circle" | "triangle" | "square" | "diamond";

const PX = 2;          // icons are drawn at twice their size, for sharp edges on high-density screens
const SIZE = 17;       // css px across, at icon-size 1 (room for the soft shadow round the mark)

function path(ctx: CanvasRenderingContext2D | Path2D, shape: Shape, c: number, r: number) {
  if (shape === "circle") { ctx.arc(c, c, r, 0, Math.PI * 2); return; }
  if (shape === "square") { const s = r * 0.86; ctx.rect(c - s, c - s, 2 * s, 2 * s); return; }
  if (shape === "diamond") { ctx.moveTo(c, c - r * 1.08); ctx.lineTo(c + r * 1.08, c); ctx.lineTo(c, c + r * 1.08); ctx.lineTo(c - r * 1.08, c); ctx.closePath(); return; }
  const h = r * 1.15; ctx.moveTo(c, c - h); ctx.lineTo(c + h * 0.95, c + h * 0.62); ctx.lineTo(c - h * 0.95, c + h * 0.62); ctx.closePath();
}

/** The image id the map asks for: "ct|<shape>|<fill>|<edge>|<edge width>|<glyph>". */
export const iconId = (shape: Shape, fill: string, edge: string, w: number, glyph = "") => `ct|${shape}|${fill}|${edge}|${w}|${glyph}`;
const BADGE = 26;      // css px across for a mark that carries letters

/** Draw the icon a map image id names, or null if the id is not one of ours. */
export function drawIcon(id: string): { width: number; height: number; data: Uint8ClampedArray } | null {
  const [tag, shape, fill, edge, w, glyph = ""] = id.split("|");
  if (tag !== "ct" || typeof document === "undefined") return null;
  const n = (glyph ? BADGE : SIZE) * PX, cv = document.createElement("canvas"); cv.width = cv.height = n;
  const ctx = cv.getContext("2d"); if (!ctx) return null;
  const lw = Number(w) * PX, r = (glyph ? 10.5 : 6) * PX - lw;
  // a soft dark shadow lifts the mark off the imagery, as the halo does for the dots
  ctx.save(); ctx.shadowColor = "rgba(2,6,23,0.55)"; ctx.shadowBlur = 3 * PX;
  ctx.beginPath(); path(ctx, shape as Shape, n / 2, r);
  ctx.fillStyle = fill; ctx.fill(); ctx.restore();
  ctx.beginPath(); path(ctx, shape as Shape, n / 2, r);
  if (lw > 0) { ctx.lineJoin = "round"; ctx.lineWidth = lw; ctx.strokeStyle = edge; ctx.stroke(); }
  if (glyph) {
    // the letters in white, with a thin dark edge so they read on the pale fills too; a triangle's text sits lower
    const px = (glyph.length >= 3 ? 7.5 : glyph.length === 2 ? 9.5 : 11) * PX;
    ctx.font = `700 ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const y = n / 2 + (shape === "triangle" ? 2.5 * PX : 0.5 * PX);
    ctx.lineJoin = "round"; ctx.lineWidth = 2.2 * PX; ctx.strokeStyle = "rgba(2,6,23,0.55)"; ctx.strokeText(glyph, n / 2, y);
    ctx.fillStyle = "#ffffff"; ctx.fillText(glyph, n / 2, y);
  }
  return { width: n, height: n, data: ctx.getImageData(0, 0, n, n).data };
}
export const ICON_PIXEL_RATIO = PX;

/** The same mark as a small inline SVG, for the legend and the list. */
export function Mark({ shape = "circle", color, ring, size = 12, title, glyph }: { shape?: Shape; color: string; ring?: string; size?: number; title?: string; glyph?: string }) {
  if (glyph) size = Math.max(size, 18);
  const c = size / 2, r = size / 2 - 1.5;
  const d = shape === "circle" ? undefined
    : shape === "square" ? `M${c - r * 0.86} ${c - r * 0.86}h${r * 1.72}v${r * 1.72}h${-r * 1.72}z`
    : shape === "diamond" ? `M${c} ${c - r * 1.05}L${c + r * 1.05} ${c}L${c} ${c + r * 1.05}L${c - r * 1.05} ${c}z`
    : `M${c} ${c - r * 1.1}L${c + r * 1.05} ${c + r * 0.7}L${c - r * 1.05} ${c + r * 0.7}z`;
  const style = { fill: ring ? "#fff" : color, stroke: ring ?? "rgba(15,23,42,.45)", strokeWidth: ring ? 1.6 : 0.8, strokeLinejoin: "round" as const };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-none" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {d ? <path d={d} style={style} /> : <circle cx={c} cy={c} r={r} style={style} />}
      {glyph && <text x={c} y={c + (shape === "triangle" ? size * 0.12 : size * 0.02)} textAnchor="middle" dominantBaseline="central" fontSize={glyph.length >= 3 ? size * 0.36 : glyph.length === 2 ? size * 0.46 : size * 0.54} fontWeight={700} fill="#fff" stroke="rgba(2,6,23,.5)" strokeWidth={0.8} paintOrder="stroke" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>{glyph}</text>}
    </svg>
  );
}
