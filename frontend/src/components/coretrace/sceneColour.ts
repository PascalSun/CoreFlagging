import type { HoleDetail, SpectralLog, Trace } from "@/lib/coreScan";
import { groupColor, groupName, lithColor } from "@/components/coretrace/palette";

// How the scene and the section colour a hole: every 10 cm from its spectral log, the mineral groups' TSG colours mixed by share.

export const STEP = 0.1;                                               // the scene is coloured every 10 cm (a 1 m log paints its 10 pieces alike)

const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)] as const;
/** Each interval's colour: the mineral groups' TSG colours mixed by their shares (a metre half chlorite, half white mica is
 * the green and the yellow blended), keyed by the interval's top in decimetres; the mix's groups ranked, for the key. */
export type Mix = { colour: Map<number, string>; text: Map<number, string>; rank: string[] };
export function mixed(log: SpectralLog | undefined, side: "swir" | "tir"): { colour: Map<number, string>; text: Map<number, string>; rank: string[] } {
  const colour = new Map<number, string>(); const text = new Map<number, string>(); const tot = new Map<string, number>();
  const step = log?.step ?? 1; const per = Math.round(step / STEP);
  for (const r of log?.rows ?? []) {
    const mix = r[side]?.mix; if (!mix) continue;
    let R = 0, G = 0, B = 0, W = 0;
    for (const [g, v] of Object.entries(mix)) { const [cr, cg, cb] = hex(groupColor(g)); R += cr * v; G += cg * v; B += cb * v; W += v; tot.set(g, (tot.get(g) ?? 0) + v); }
    if (W <= 0) continue;
    const c = `rgb(${Math.round(R / W)},${Math.round(G / W)},${Math.round(B / W)})`;
    const t = Object.entries(mix).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g, v]) => `${groupName(g)} ${Math.round(v * 100)}%`).join(", ");   // "Chlorite 62%, White mica 30%"
    const d0 = Math.round(r.from_m / STEP);
    for (let i = 0; i < per; i++) { colour.set(d0 + i, c); text.set(d0 + i, t); }
  }
  return { colour, text, rank: [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g) };
}
/** A trace's points every 10 cm: the stored points (every 1 or 2 m) with the pieces between them interpolated. */
export function fine(P: Trace["points"]): Trace["points"] {
  const out: Trace["points"] = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1]; const n = Math.max(1, Math.round((b.m - a.m) / STEP));
    for (let j = 0; j < n; j++) { const f = j / n; out.push({ ...a, m: a.m + f * (b.m - a.m), e: a.e + f * (b.e - a.e), n: a.n + f * (b.n - a.n), u: a.u + f * (b.u - a.u) }); }
  }
  if (P.length) out.push(P[P.length - 1]);
  return out;
}

/** A hole and its neighbours as lines in space, in metres from this hole's collar (east, north, up). The hole is
 * coloured every 10 cm by the HyLogger data itself (the mineral groups TSG read, their colours mixed by share); the neighbours are grey, or coloured the same way when "colour the neighbours" is on; the flagged
 * metres and the log disagreements are drawn thick. A click on a point opens that depth on the map. */

/** The logged rock per metre in GSWA's map colours (the hole's own log, mapped to GSWA's rock families), every 10 cm of
 * the metre alike: the way the industry colours a drillhole in 3D. Empty where the log has no family for the metre. */
export function logged(h: HoleDetail | undefined): Mix {
  const colour = new Map<number, string>(); const text = new Map<number, string>(); const tot = new Map<string, number>();
  const ms = h?.metres; if (!ms) return { colour, text, rank: [] };
  ms.m.forEach((m, i) => {
    const l = ms.lith[i]; if (!l) return;
    tot.set(l, (tot.get(l) ?? 0) + 1); const raw = ms.lith_raw[i];
    const d0 = m * 10; const c = lithColor(l); const t = raw && raw !== l ? `${l} · logged "${raw}"` : l;
    for (let k = 0; k < 10; k++) { colour.set(d0 + k, c); text.set(d0 + k, t); }
  });
  return { colour, text, rank: [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g) };
}
