import type { HoleDetail, SpectralLog, Trace } from "@/lib/coreScan";
import { groupColor, groupName, lithColor } from "@/components/coretrace/palette";

// How the scene and the section colour a hole: every 10 cm from its spectral log, the group TSG read most of there, in TSG's colours.

export const STEP = 0.1;                                               // the scene is coloured every 10 cm (a 1 m log paints its 10 pieces alike)

/** What colours each 10 cm piece, keyed by the piece's top in decimetres: `parts` is the piece's colours with their shares
 * along it. For the minerals it is one colour, the group TSG read most of in the piece, as TSG's own Grp log and the NVCL
 * reports draw it (a piece 60 % chlorite, 30 % white mica is chlorite green; hover gives the shares); `text` names the
 * groups; `rank` is the hole's groups, most core first, for the key. */
export type Mix = { parts: Map<number, [string, number][]>; text: Map<number, string>; rank: string[] };
export function mixed(log: SpectralLog | undefined, side: "swir" | "tir"): Mix {
  const parts = new Map<number, [string, number][]>(); const text = new Map<number, string>(); const tot = new Map<string, number>();
  const step = log?.step ?? 1; const per = Math.round(step / STEP);
  for (const r of log?.rows ?? []) {
    const mix = r[side]?.mix; if (!mix) continue;
    const ranked = Object.entries(mix).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) continue;
    for (const [g, v] of ranked) tot.set(g, (tot.get(g) ?? 0) + v);
    const ps: [string, number][] = [[groupColor(ranked[0][0]), 1]];           // the leading group alone
    const t = ranked.slice(0, 3).map(([g, v]) => `${groupName(g)} ${Math.round(v * 100)}%`).join(", ");   // "Chlorite 62%, White mica 30%"
    const d0 = Math.round(r.from_m / STEP);
    for (let i = 0; i < per; i++) { parts.set(d0 + i, ps); text.set(d0 + i, t); }
  }
  return { parts, text, rank: [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g) };
}
/** The pieces of a hole, each with one colour: every 10 cm piece between two of `P`'s points, split along its length by
 * the shares of its colours; a piece with nothing read is one grey (null) piece. `m` is the top of the 10 cm it belongs to. */
export type Piece = { a: Trace["points"][number]; b: Trace["points"][number]; c: string | null; m: number };
export function pieces(P: Trace["points"], mix: Mix | null): Piece[] {
  const out: Piece[] = [];
  const lerp = (a: Trace["points"][number], b: Trace["points"][number], f: number) => ({ ...a, m: a.m + f * (b.m - a.m), e: a.e + f * (b.e - a.e), n: a.n + f * (b.n - a.n), u: a.u + f * (b.u - a.u) });
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1]; const ps = mix?.parts.get(Math.round(a.m / STEP));
    if (!ps) { out.push({ a, b, c: null, m: a.m }); continue; }
    const W = ps.reduce((s, [, v]) => s + v, 0); let f0 = 0;
    for (const [c, v] of ps) { const f1 = Math.min(1, f0 + v / W); out.push({ a: f0 === 0 ? a : lerp(a, b, f0), b: f1 >= 1 ? b : lerp(a, b, f1), c, m: a.m }); f0 = f1; }
  }
  return out;
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
  const parts = new Map<number, [string, number][]>(); const text = new Map<number, string>(); const tot = new Map<string, number>();
  const ms = h?.metres; if (!ms) return { parts, text, rank: [] };
  ms.m.forEach((m, i) => {
    const l = ms.lith[i]; if (!l) return;
    tot.set(l, (tot.get(l) ?? 0) + 1); const raw = ms.lith_raw[i];
    const d0 = m * 10; const c = lithColor(l); const t = raw && raw !== l ? `${l} · logged "${raw}"` : l;
    for (let k = 0; k < 10; k++) { parts.set(d0 + k, [[c, 1]]); text.set(d0 + k, t); }
  });
  return { parts, text, rank: [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g) };
}
