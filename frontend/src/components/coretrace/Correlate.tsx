"use client";

// Two holes matched by what they are made of. Each metre of a hole is a vector: the share of each of HyFormer's
// rock classes (RC) over the 5 m around it, or, when either hole has no model reading, the TSG group shares of its
// SWIR and TIR (the spectral log). A metre of hole A is linked to the metre of hole B it is most like. The links are
// drawn between the two holes, each as a fine strip (RC by the metre) and a chunk strip (the auto log).
//   match: the mean likeness of the links (1 = every metre of A has its twin in B)
//   ρ:     Spearman's rank correlation of the linked depths: near 1 when B holds A's sequence in the same order
//          (stretched or shifted), near 0 when the matches are scattered, negative when B runs the other way up

import { useEffect, useMemo, useRef, useState } from "react";
import type { HoleDetail, ModelView, SpectralLog } from "@/lib/coreScan";
import { coreTypeColor, groupColor } from "@/components/coretrace/palette";

export type CorrSide = { hole: HoleDetail; mv?: ModelView; spectral?: SpectralLog };
export type Link = { a: number; b: number; sim: number };
export type Correlation = { links: Link[]; score: number; rho: number; basis: "minerals" | "rock class" };

export const CORR_TIP = {
  score: "Match: how alike the two holes are, metre for metre. Every metre of the left hole is linked to the metre of the right hole it is most like, by the rock classes HyFormer reads over the 5 m around it (or the mineral groups the scanner reads, without a model reading), once the make-up the two holes share is taken out; this is the mean likeness of those links, 0 (no more alike than any two metres) to 1 (identical).",
  rho: "ρ (Spearman): whether the matches keep their order. Near 1, the right hole holds the left one's sequence top to bottom, even stretched or shifted; near 0, the matches are scattered; below 0, it runs the other way up.",
};

function unit(v: Float64Array): Float64Array {
  let s = 0; for (const x of v) s += x * x;
  const n = Math.sqrt(s); if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** Each metre of a hole as a vector, smoothed over the 2 m either side (null where there is nothing read). */
function vectors(s: CorrSide, spec: boolean, groups: string[], types: number[]): (Float64Array | null)[] {
  const rows = new Map((s.spectral?.rows ?? []).map((r) => [Math.round(r.from_m), r]));
  const midx = new Map((s.mv?.m ?? []).map((m, i) => [m, i]));
  const dim = spec ? groups.length * 2 : types.length;
  const raw = s.hole.metres.m.map((m) => {
    const v = new Float64Array(dim);
    if (spec) {
      const r = rows.get(m);
      if (r) groups.forEach((g, i) => { v[i] = r.swir?.mix[g] ?? 0; v[groups.length + i] = r.tir?.mix[g] ?? 0; });
    } else {
      const j = midx.get(m); const k = j === undefined ? -1 : types.indexOf(s.mv!.core[j]);
      if (k >= 0) v[k] = 1;
    }
    return v;
  });
  return raw.map((own, i) => {
    if (!own.some((x) => x > 0)) return null;
    const v = new Float64Array(dim);
    for (let d = -2; d <= 2; d++) { const w = raw[i + d]; if (w) for (let k = 0; k < dim; k++) v[k] += w[k] * (3 - Math.abs(d)); }
    return v;
  });
}

function ranks(xs: number[]): number[] {
  const o = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]); const r = new Array<number>(xs.length);
  for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; }
  return r;
}
function spearman(xs: number[], ys: number[]): number {
  if (xs.length < 3) return 0;
  const a = ranks(xs), b = ranks(ys), n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let c = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
  return va && vb ? c / Math.sqrt(va * vb) : 0;
}

/** Link every metre of A (every few, past 90 metres) to its likeliest metre of B. Likeness is the cosine of the two
 * metres once the make-up both holes share is taken out (so a hole that is chlorite throughout does not match
 * everything everywhere). The pick is by CSLS (cross-domain similarity local scaling: twice the cosine, less each
 * side's mean likeness to its 10 nearest on the other side), so a bland metre that is a little like everything
 * does not draw every link to itself; among near-equal picks the one at the same relative depth wins. Null when
 * there is nothing to compare by (no spectral log on both, nor a model reading on both). */
export function correlate(a: CorrSide, b: CorrSide): Correlation | null {
  // by HyFormer's rock class when both holes have one (what the strips show), else by the TSG mineral groups
  const spec = !(a.mv && b.mv) && !!a.spectral?.rows.length && !!b.spectral?.rows.length;
  if (!spec && (!a.mv || !b.mv)) return null;
  const groups = spec ? [...new Set([a, b].flatMap((s) => s.spectral!.rows.flatMap((r) => [...Object.keys(r.swir?.mix ?? {}), ...Object.keys(r.tir?.mix ?? {})])))] : [];
  const types = spec ? [] : [...new Set([...a.mv!.core, ...b.mv!.core])];
  const rawA = vectors(a, spec, groups, types), rawB = vectors(b, spec, groups, types);
  const all = [...rawA, ...rawB].filter((v): v is Float64Array => !!v); if (!all.length) return null;
  const dim = all[0].length, mean = new Float64Array(dim);
  for (const v of all) { const n = v.reduce((t, x) => t + x, 0) || 1; for (let k = 0; k < dim; k++) mean[k] += v[k] / n / all.length; }
  const centre = (v: Float64Array | null) => { if (!v) return null; const n = v.reduce((t, x) => t + x, 0) || 1; const c = new Float64Array(dim); for (let k = 0; k < dim; k++) c[k] = v[k] / n - mean[k]; return unit(c); };
  // the metres in play on each side: every few past 90 (left) and 400 (right), where there is something read
  const pick = (raw: (Float64Array | null)[], ms: number[], cap: number) => {
    const st = Math.max(1, Math.ceil(raw.length / cap)), out: { i: number; m: number; v: Float64Array }[] = [];
    for (let i = 0; i < raw.length; i += st) { const v = centre(raw[i]); if (v) out.push({ i, m: ms[i], v }); }
    return out;
  };
  const A = pick(rawA, a.hole.metres.m, 90), B = pick(rawB, b.hole.metres.m, 400);
  if (!A.length || !B.length) return null;
  const S = A.map((x) => B.map((y) => { let d = 0; for (let k = 0; k < dim; k++) d += x.v[k] * y.v[k]; return d; }));
  const K = Math.min(10, A.length, B.length);
  const topk = (xs: number[]) => [...xs].sort((p, q) => q - p).slice(0, K).reduce((t, x) => t + x, 0) / K;
  const rA = S.map(topk), rB = B.map((_, j) => topk(S.map((row) => row[j])));
  const nA = Math.max(1, rawA.length - 1), nB = Math.max(1, rawB.length - 1), TIE = 0.03; const links: Link[] = [];
  A.forEach((x, i) => {
    const c = S[i].map((sv, j) => 2 * sv - rA[i] - rB[j]); const best = Math.max(...c);
    let bj = 0, off = Infinity; const rel = x.i / nA;
    c.forEach((cv, j) => { if (cv >= best - TIE) { const o = Math.abs(B[j].i / nB - rel); if (o < off) { off = o; bj = j; } } });
    links.push({ a: x.m, b: B[bj].m, sim: Math.max(0, S[i][bj]) });
  });
  return { links, score: links.reduce((s, l) => s + l.sim, 0) / links.length, rho: spearman(links.map((l) => l.a), links.map((l) => l.b)), basis: spec ? "minerals" : "rock class" };
}

const GOLD = "#c9a24a", LINE = "#94a3b8";

/** The two holes, each a fine strip (rock class by the metre) and a chunk strip (the auto log), on one scale,
 * the right one shifted so its matches sit level with the left; the links between them, the chunk under the
 * pointer (or the one holding the selected metre) in gold. Click a chunk to go to it and its match. */
export function CorrelationView({ a, b, corr, cursorA, onPick }: {
  a: CorrSide; b: CorrSide; corr: Correlation; cursorA: number | null; onPick: (aM: number, bM: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 320, h: 600 });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const [hover, setHover] = useState<number | null>(null);

  const a0 = a.hole.metres.m[0] ?? 0, a1 = (a.hole.metres.m[a.hole.metres.m.length - 1] ?? 0) + 1;
  const b0 = b.hole.metres.m[0] ?? 0, b1 = (b.hole.metres.m[b.hole.metres.m.length - 1] ?? 0) + 1;
  // the right hole slides so the median link is level
  const shift = useMemo(() => { const d = corr.links.map((l) => (l.a - a0) - (l.b - b0)).sort((x, y) => x - y); return d[Math.floor(d.length / 2)] ?? 0; }, [corr, a0, b0]);
  const top = Math.min(0, shift), bot = Math.max(a1 - a0, b1 - b0 + shift);
  const PAD = 22, k = Math.max(0.05, (box.h - 2 * PAD) / Math.max(1, bot - top));
  const yA = (d: number) => PAD + (d - a0 - top) * k, yB = (d: number) => PAD + (d - b0 + shift - top) * k;
  const FINE = 12, CHUNK = 22, GAP = 3, colW = FINE + GAP + CHUNK;
  const xA = 4, xB = box.w - 4 - colW, x1 = xA + colW + 2, x2 = xB - 2;

  const segsA = useMemo(() => a.mv?.segments ?? [], [a.mv]);
  // the chunk in gold: under the pointer, else the one holding the selected metre, else the best-matched one
  const lit = useMemo(() => {
    if (hover !== null) return hover;
    if (cursorA !== null) { const i = segsA.findIndex((s) => cursorA >= s.from_m && cursorA < s.to_m); if (i >= 0) return i; }
    let bi = -1, bs = -1;
    segsA.forEach((s, i) => { const ls = corr.links.filter((l) => l.a >= s.from_m && l.a < s.to_m); if (ls.length >= 2) { const m = ls.reduce((t, l) => t + l.sim, 0) / ls.length; if (m > bs) { bs = m; bi = i; } } });
    return bi;
  }, [hover, cursorA, segsA, corr]);
  const inLit = (l: Link) => lit >= 0 && segsA[lit] && l.a >= segsA[lit].from_m && l.a < segsA[lit].to_m;

  const fine = (s: CorrSide, x: number, y: (d: number) => number) => {
    const midx = new Map((s.mv?.m ?? []).map((m, i) => [m, i])); const names = new Map((s.mv?.core_types ?? []).map((c) => [c.k, c.name]));
    return s.hole.metres.m.map((m, i) => { const j = midx.get(m);
      return <rect key={m} x={x} y={y(m)} width={FINE} height={Math.max(k, 0.6)} fill={j !== undefined && s.mv ? coreTypeColor(names.get(s.mv.core[j])) : groupColor(s.hole.metres.gs[i])} />; });
  };
  const chunks = (s: CorrSide, x: number, y: (d: number) => number, side: "a" | "b") => (s.mv?.segments ?? []).map((g, i) => (
    <rect key={g.seg} x={x} y={y(g.from_m)} width={CHUNK} height={Math.max((g.to_m - g.from_m) * k, 0.8)} fill={coreTypeColor(g.core_type_name)}
      stroke={side === "a" && i === lit ? GOLD : "#fff"} strokeWidth={side === "a" && i === lit ? 2 : 0.5}
      className={side === "a" ? "cursor-pointer" : undefined}
      onMouseEnter={side === "a" ? () => setHover(i) : undefined} onMouseLeave={side === "a" ? () => setHover(null) : undefined}
      onClick={side === "a" ? () => { const ls = corr.links.filter((l) => l.a >= g.from_m && l.a < g.to_m).sort((p, q) => q.sim - p.sim); onPick(Math.floor(g.from_m), ls[0]?.b ?? b0); } : undefined}>
      <title>{`${g.from_m.toFixed(1)}–${g.to_m.toFixed(1)} m · ${g.core_type_name}`}</title>
    </rect>));

  const label = (x: number, y: number, t: string, anchor: "start" | "end") => <text x={x} y={y} textAnchor={anchor} className="fill-slate-500 font-mono text-[9px]">{t}</text>;
  return (
    <div ref={ref} className="relative h-full w-full">
      <svg width={box.w} height={box.h} className="block">
        {corr.links.filter((l) => !inLit(l)).map((l) => <line key={`${l.a}`} x1={x1} y1={yA(l.a + 0.5)} x2={x2} y2={yB(l.b + 0.5)} stroke={LINE} strokeOpacity={0.25 + 0.5 * l.sim} strokeWidth={0.8} />)}
        {corr.links.filter(inLit).map((l) => <line key={`g${l.a}`} x1={x1} y1={yA(l.a + 0.5)} x2={x2} y2={yB(l.b + 0.5)} stroke={GOLD} strokeWidth={2.6} strokeLinecap="round" />)}
        <g>{fine(a, xA, yA)}{chunks(a, xA + FINE + GAP, yA, "a")}</g>
        <g>{fine(b, xB, yB)}{chunks(b, xB + FINE + GAP, yB, "b")}</g>
        {label(xA, yA(a0) - 6, `${Math.round(a0)} m`, "start")}{label(xA, yA(a1) + 12, `${Math.round(a1)} m`, "start")}
        {label(xB + colW, yB(b0) - 6, `${Math.round(b0)} m`, "end")}{label(xB + colW, yB(b1) + 12, `${Math.round(b1)} m`, "end")}
      </svg>
    </div>
  );
}
