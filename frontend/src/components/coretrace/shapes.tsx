// Point shapes for the Core Flagging map: colour carries one attribute of a hole, shape a second. Mapbox circles
// cannot change shape, so each (shape, fill, edge) is drawn once on a canvas the first time the map asks for it.

import { useId } from "react";

export type Shape = "circle" | "triangle" | "square" | "diamond";

const PX = 2;          // icons are drawn at twice their size, for sharp edges on high-density screens
const SIZE = 17;       // css px across, at icon-size 1 (room for the soft shadow round the mark)

function path(ctx: CanvasRenderingContext2D | Path2D, shape: Shape, c: number, r: number) {
  if (shape === "circle") { ctx.arc(c, c, r, 0, Math.PI * 2); return; }
  if (shape === "square") { const s = r * 0.86; ctx.rect(c - s, c - s, 2 * s, 2 * s); return; }
  if (shape === "diamond") { ctx.moveTo(c, c - r * 1.08); ctx.lineTo(c + r * 1.08, c); ctx.lineTo(c, c + r * 1.08); ctx.lineTo(c - r * 1.08, c); ctx.closePath(); return; }
  const h = r * 1.15; ctx.moveTo(c, c - h); ctx.lineTo(c + h * 0.95, c + h * 0.62); ctx.lineTo(c - h * 0.95, c + h * 0.62); ctx.closePath();
}

/** A badge's body: a disc, or a rounded square for a hole the models could not read. */
function body(ctx: CanvasRenderingContext2D, shape: Shape, c: number, r: number) {
  if (shape !== "square") { ctx.arc(c, c, r, 0, Math.PI * 2); return; }
  const s = r * 0.9; ctx.roundRect(c - s, c - s, 2 * s, 2 * s, r * 0.34);
}

/** An inferred target: white diagonal stripes over the fill, clipped to the path just traced. */
function hatch(ctx: CanvasRenderingContext2D, n: number, gap: number, width = 1.3 * PX) {
  ctx.save(); ctx.clip(); ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = width;
  ctx.beginPath();
  for (let x = gap / 2 - Math.ceil(n / gap) * gap; x < n; x += gap) { ctx.moveTo(x, n); ctx.lineTo(x + n, 0); }
  ctx.stroke(); ctx.restore();
}

/** The image id the map asks for: "ct|<shape>|<fill>|<edge>|<edge width>|<glyph>|<hatched>". */
export const iconId = (shape: Shape, fill: string, edge: string, w: number, glyph = "", hatched = false) => `ct|${shape}|${fill}|${edge}|${w}|${glyph}|${hatched ? 1 : 0}`;
const BADGE = 30;      // css px across for a mark that carries letters (room for the rim and the shadow)

/** Black or white, whichever reads on this fill. */
export function inkOn(fill: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(fill); if (!m) return "#ffffff";
  const v = parseInt(m[1], 16), r = v >> 16, g = (v >> 8) & 255, b = v & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? "#0f172a" : "#ffffff";
}

/** Draw the icon a map image id names, or null if the id is not one of ours. */
export function drawIcon(id: string): { width: number; height: number; data: Uint8ClampedArray } | null {
  const [tag, shapeS, fill, edge, w, glyph = "", hatchedS = "0"] = id.split("|"); const hatched = hatchedS === "1"; const shape = shapeS as Shape;
  if (tag !== "ct" || typeof document === "undefined") return null;
  const n = (glyph ? BADGE : SIZE) * PX, cv = document.createElement("canvas"); cv.width = cv.height = n;
  const ctx = cv.getContext("2d"); if (!ctx) return null;
  if (glyph) {
    // a badge: a disc (or a rounded square) with a faint sheen from the top, a hairline white rim and a soft shadow;
    // white stripes over the fill for an inferred target; the symbol in black or white on it
    const c = n / 2, r = 10 * PX;
    ctx.save(); ctx.shadowColor = "rgba(2,6,23,0.38)"; ctx.shadowBlur = 5 * PX; ctx.shadowOffsetY = 1.5 * PX;
    ctx.beginPath(); body(ctx, shape, c, r + 1.25 * PX); ctx.fillStyle = edge === "#111111" ? "#111111" : "rgba(255,255,255,0.96)"; ctx.fill(); ctx.restore();
    ctx.beginPath(); body(ctx, shape, c, r); ctx.fillStyle = fill; ctx.fill();
    if (hatched) { ctx.beginPath(); body(ctx, shape, c, r); hatch(ctx, n, 3.6 * PX); }
    const sheen = ctx.createLinearGradient(0, c - r, 0, c + r); sheen.addColorStop(0, "rgba(255,255,255,0.28)"); sheen.addColorStop(0.55, "rgba(255,255,255,0)"); sheen.addColorStop(1, "rgba(2,6,23,0.12)");
    ctx.beginPath(); body(ctx, shape, c, r); ctx.fillStyle = sheen; ctx.fill();
    ctx.beginPath(); body(ctx, shape, c, r - 0.6 * PX); ctx.lineWidth = 1.2 * PX; ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.stroke();   // an inner hairline, as glass has
    const px = (glyph.length >= 3 ? 7.6 : glyph.length === 2 ? 10 : 11.5) * PX;
    ctx.font = `600 ${px}px -apple-system, BlinkMacSystemFont, "SF Pro Text", ui-sans-serif, system-ui, "Segoe UI", Helvetica, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (glyph === "+") {   // drawn, not set in type: a font's plus sits off the middle
      const a = r * 0.5; ctx.beginPath(); ctx.moveTo(c - a, c); ctx.lineTo(c + a, c); ctx.moveTo(c, c - a); ctx.lineTo(c, c + a);
      ctx.lineCap = "round"; ctx.lineWidth = 2.2 * PX; ctx.strokeStyle = inkOn(fill); ctx.stroke();
      return { width: n, height: n, data: ctx.getImageData(0, 0, n, n).data };
    }
    if (hatched) { ctx.lineWidth = 2.4 * PX; ctx.strokeStyle = fill; ctx.lineJoin = "round"; ctx.strokeText(glyph, c, c + 0.6 * PX); }   // a halo of the fill keeps the symbol clear of the stripes
    // the symbol is always white; on a light fill (gold, uranium, diamonds) a faint dark edge keeps it legible
    if (inkOn(fill) !== "#ffffff") { ctx.lineWidth = 1.6 * PX; ctx.strokeStyle = "rgba(2,6,23,0.38)"; ctx.lineJoin = "round"; ctx.strokeText(glyph, c, c + 0.6 * PX); }
    ctx.fillStyle = "#ffffff"; ctx.fillText(glyph, c, c + 0.6 * PX);
    return { width: n, height: n, data: ctx.getImageData(0, 0, n, n).data };
  }
  const lw = Number(w) * PX, r = 6 * PX - lw;
  // a soft dark shadow lifts the mark off the imagery, as the halo does for the dots
  ctx.save(); ctx.shadowColor = "rgba(2,6,23,0.55)"; ctx.shadowBlur = 3 * PX;
  ctx.beginPath(); path(ctx, shape, n / 2, r);
  ctx.fillStyle = fill; ctx.fill(); ctx.restore();
  if (hatched) { ctx.beginPath(); path(ctx, shape, n / 2, r); hatch(ctx, n, 3.6 * PX, 0.9 * PX); }   // fine stripes: on a dot this small, bold ones wash the colour out
  ctx.beginPath(); path(ctx, shape, n / 2, r);
  if (lw > 0) { ctx.lineJoin = "round"; ctx.lineWidth = lw; ctx.strokeStyle = edge; ctx.stroke(); }
  return { width: n, height: n, data: ctx.getImageData(0, 0, n, n).data };
}
export const ICON_PIXEL_RATIO = PX;

/** The same mark as a small flat SVG (no shadow), for the key and the list. A badge (`glyph` set; a blank glyph
 * gives a neutral badge with no letters) is a disc or a rounded square; `hatched` lays white stripes over it. */
export function Mark({ shape = "circle", color, ring, size = 12, title, glyph, hatched }: { shape?: Shape; color: string; ring?: string; size?: number; title?: string; glyph?: string; hatched?: boolean }) {
  const clip = useId();
  if (glyph) {
    const S = Math.max(size, 20), c = S / 2, r = S / 2 - 1.5, sq = shape === "square", s = r * 0.9;
    const outline = sq ? <rect x={c - s} y={c - s} width={2 * s} height={2 * s} rx={r * 0.34} /> : <circle cx={c} cy={c} r={r} />;
    const gap = S * 0.29;   // three or four bold stripes across the mark
    return (
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} className="flex-none" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
        {title && <title>{title}</title>}
        {hatched && <defs><clipPath id={clip}>{outline}</clipPath></defs>}
        <g fill={color}>{outline}</g>
        {hatched && <g clipPath={`url(#${clip})`} stroke="rgba(255,255,255,0.92)" strokeWidth={S * 0.11}>
          {[-3, -2, -1, 0, 1, 2].map((i) => { const x = (i + 0.5) * gap; return <line key={i} x1={x} y1={S} x2={x + S} y2={0} />; })}
        </g>}
        <g fill="none" stroke="#fff" strokeWidth={1.5}>{outline}</g>
        {glyph === "+" ? <path d={`M${c - r * 0.5} ${c}h${r}M${c} ${c - r * 0.5}v${r}`} stroke={inkOn(color)} strokeWidth={S * 0.1} strokeLinecap="round" />
          : glyph.trim() && <text x={c} y={c + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={glyph.length >= 3 ? S * 0.36 : glyph.length === 2 ? S * 0.5 : S * 0.58} fontWeight={700} fill="#fff"
          stroke={hatched ? color : inkOn(color) !== "#ffffff" ? "rgba(2,6,23,0.38)" : undefined} strokeWidth={hatched ? S * 0.1 : S * 0.05} paintOrder="stroke" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>{glyph}</text>}
      </svg>);
  }
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
    </svg>
  );
}
