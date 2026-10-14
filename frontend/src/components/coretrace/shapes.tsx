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
export const iconId = (shape: Shape, fill: string, edge: string, w: number, glyph = "", dashed = false) => `ct|${shape}|${fill}|${edge}|${w}|${glyph}|${dashed ? 1 : 0}`;
const BADGE = 30;      // css px across for a mark that carries letters (room for the rim, the shadow and the shoulder dot)

/** Black or white, whichever reads on this fill. */
export function inkOn(fill: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(fill); if (!m) return "#ffffff";
  const v = parseInt(m[1], 16), r = v >> 16, g = (v >> 8) & 255, b = v & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? "#0f172a" : "#ffffff";
}

/** The status dot a badge wears at its shoulder for the second attribute (a shape has no room on a badge). */
const ACCENT: Record<Shape, string | null> = { circle: null, triangle: "#facc15", square: "#94a3b8", diamond: "#38bdf8" };

/** Draw the icon a map image id names, or null if the id is not one of ours. */
export function drawIcon(id: string): { width: number; height: number; data: Uint8ClampedArray } | null {
  const [tag, shape, fill, edge, w, glyph = "", dashedS = "0"] = id.split("|"); const dashed = dashedS === "1";
  if (tag !== "ct" || typeof document === "undefined") return null;
  const n = (glyph ? BADGE : SIZE) * PX, cv = document.createElement("canvas"); cv.width = cv.height = n;
  const ctx = cv.getContext("2d"); if (!ctx) return null;
  if (glyph) {
    // a badge: a disc with a faint sheen from the top, a hairline white rim and a soft shadow; the symbol in
    // black or white on it; a small dot at the shoulder for the shape attribute (gold assay, assayed, offshore)
    const c = n / 2, r = 10 * PX;
    ctx.save(); ctx.shadowColor = "rgba(2,6,23,0.38)"; ctx.shadowBlur = 5 * PX; ctx.shadowOffsetY = 1.5 * PX;
    ctx.beginPath(); ctx.arc(c, c, r + 1.25 * PX, 0, Math.PI * 2); ctx.fillStyle = edge === "#111111" ? "#111111" : "rgba(255,255,255,0.96)"; ctx.fill(); ctx.restore();
    if (dashed) {   // an inferred target: the rim is a dashed dark ring instead of a solid white one
      ctx.beginPath(); ctx.arc(c, c, r + 0.9 * PX, 0, Math.PI * 2); ctx.setLineDash([2.2 * PX, 1.8 * PX]); ctx.lineWidth = 1.5 * PX; ctx.strokeStyle = "rgba(15,23,42,0.75)"; ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    const sheen = ctx.createLinearGradient(0, c - r, 0, c + r); sheen.addColorStop(0, "rgba(255,255,255,0.28)"); sheen.addColorStop(0.55, "rgba(255,255,255,0)"); sheen.addColorStop(1, "rgba(2,6,23,0.12)");
    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fillStyle = sheen; ctx.fill();
    ctx.beginPath(); ctx.arc(c, c, r - 0.6 * PX, 0, Math.PI * 2); ctx.lineWidth = 1.2 * PX; ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.stroke();   // an inner hairline, as glass has
    const px = (glyph.length >= 3 ? 7.6 : glyph.length === 2 ? 10 : 11.5) * PX;
    ctx.font = `600 ${px}px -apple-system, BlinkMacSystemFont, "SF Pro Text", ui-sans-serif, system-ui, "Segoe UI", Helvetica, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = inkOn(fill); ctx.fillText(glyph, c, c + 0.6 * PX);
    const acc = ACCENT[shape as Shape];
    if (acc) { const ax = c + r * 0.74, ay = c - r * 0.74; ctx.beginPath(); ctx.arc(ax, ay, 3.4 * PX, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.beginPath(); ctx.arc(ax, ay, 2.2 * PX, 0, Math.PI * 2); ctx.fillStyle = acc; ctx.fill(); }
    return { width: n, height: n, data: ctx.getImageData(0, 0, n, n).data };
  }
  const lw = Number(w) * PX, r = 6 * PX - lw;
  // a soft dark shadow lifts the mark off the imagery, as the halo does for the dots
  ctx.save(); ctx.shadowColor = "rgba(2,6,23,0.55)"; ctx.shadowBlur = 3 * PX;
  ctx.beginPath(); path(ctx, shape as Shape, n / 2, r);
  ctx.fillStyle = fill; ctx.fill(); ctx.restore();
  ctx.beginPath(); path(ctx, shape as Shape, n / 2, r);
  if (lw > 0) { ctx.lineJoin = "round"; ctx.lineWidth = lw; ctx.strokeStyle = edge; ctx.stroke(); }
  return { width: n, height: n, data: ctx.getImageData(0, 0, n, n).data };
}
export const ICON_PIXEL_RATIO = PX;

/** The same mark as a small inline SVG, for the legend and the list. */
export function Mark({ shape = "circle", color, ring, size = 12, title, glyph, dashed }: { shape?: Shape; color: string; ring?: string; size?: number; title?: string; glyph?: string; dashed?: boolean }) {
  if (glyph) {
    const S = Math.max(size, 20), c = S / 2, r = S / 2 - 1.5, acc = ACCENT[shape];
    return (
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} className="flex-none" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
        {title && <title>{title}</title>}
        <circle cx={c} cy={c} r={r} fill={color} stroke={dashed ? "rgba(15,23,42,.75)" : "#fff"} strokeWidth={1.5} strokeDasharray={dashed ? "2 1.6" : undefined} />
        <text x={c} y={c + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={glyph.length >= 3 ? S * 0.36 : glyph.length === 2 ? S * 0.5 : S * 0.58} fontWeight={700} fill={inkOn(color)} style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>{glyph}</text>
        {acc && <><circle cx={c + r * 0.72} cy={c - r * 0.72} r={3.2} fill="#fff" /><circle cx={c + r * 0.72} cy={c - r * 0.72} r={2.1} fill={acc} /></>}
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
