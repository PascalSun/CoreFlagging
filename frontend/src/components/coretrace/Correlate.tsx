"use client";

// Two holes matched by what they are made of. Each metre of a hole is a vector: the share of each of HyFormer's
// rock classes (RC) over the 5 m around it, or, when either hole has no model reading, the TSG group shares of its
// SWIR and TIR (the spectral log). A metre of hole A is linked to the metre of hole B it is most like. The links are
// drawn between the two holes' RC strips, each with a column of the reader's choice outside it.
//   match: the mean likeness of the links (1 = every metre of A has its twin in B)
//   ρ:     Spearman's rank correlation of the linked depths: near 1 when B holds A's sequence in the same order
//          (stretched or shifted), near 0 when the matches are scattered, negative when B runs the other way up

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { HoleDetail, ModelView, SpectralLog } from "@/lib/coreScan";
import { SERIES, coreTypeColor, groupColor } from "@/components/coretrace/palette";
import { TIP, groupOrder } from "@/components/coretrace/StripLog";

export type CorrSide = { hole: HoleDetail; mv?: ModelView; spectral?: SpectralLog };
export type Link = { a: number; b: number; sim: number };
export type Correlation = { links: Link[]; score: number; rho: number; basis: "representation" | "minerals" | "rock class" };

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
/** The column drawn beside RC in the middle view, each side. */
export type CorrShow = "swir" | "tir" | "anom" | "bd";
export const CORR_SHOW: { id: CorrShow; label: string }[] = [{ id: "swir", label: "SWIR" }, { id: "tir", label: "TIR" }, { id: "anom", label: "Unusual" }, { id: "bd", label: "BD" }];
const PICK = " Here: point at a metre of the left hole to light its link; click it to mark it and its match.";
const SHOW_TIP: Record<CorrShow, string> = { swir: TIP.swir, tir: TIP.tir, anom: TIP.unusual, bd: TIP.bd };

type Side = { s: CorrSide; win: [number, number] | null; h0: number; h1: number; r: [number, number]; y: (d: number) => number; k: number };

/** The two holes on one depth axis (or, once either log has a window, each on its own), mirrored about the links
 * between them: from the outside in, the chosen column (SWIR, TIR, Unusual or BD, its depths marked on it) and RC,
 * whose metres the links join. The metre under the pointer (or the selected one) and its link in
 * gold; click a metre to mark it and its match. */
export function CorrelationView({ a, b, corr, cursorA, onPick, winA = null, winB = null, show }: {
  a: CorrSide; b: CorrSide; corr: Correlation; cursorA: number | null; onPick: (aM: number, bM: number) => void;
  /** each log's window: the strips draw just that, on that side's own depths */
  winA?: [number, number] | null; winB?: [number, number] | null;
  show: CorrShow;
}) {
  const ref = useRef<HTMLDivElement>(null); const cid = useId().replace(/:/g, "");
  const [box, setBox] = useState({ w: 320, h: 600 });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const [hover, setHover] = useState<number | null>(null);
  const order = useMemo(() => { const o = groupOrder(a.spectral); for (const g of groupOrder(b.spectral)) if (!o.includes(g)) o.push(g); return o; }, [a.spectral, b.spectral]);

  const PAD = 30, FOOT = 16, H = Math.max(1, box.h - PAD - FOOT);
  const ends = (s: CorrSide) => [s.hole.metres.m[0] ?? 0, (s.hole.metres.m[s.hole.metres.m.length - 1] ?? 0) + 1] as const;
  const [a0, a1] = ends(a), [b0, b1] = ends(b);
  // no window on either: one depth axis for both, so a metre sits at the same height in either hole; with a window, each its own
  const shared = !winA && !winB;
  const side = (s: CorrSide, win: [number, number] | null, h0: number, h1: number): Side => {
    const r: [number, number] = win ?? (shared ? [Math.min(a0, b0), Math.max(a1, b1)] : [h0, h1]);
    const k = H / Math.max(0.1, r[1] - r[0]);
    return { s, win, h0, h1, r, k, y: (d: number) => PAD + (d - r[0]) * k };
  };
  const A = side(a, winA, a0, a1), B = side(b, winB, b0, b1);
  const EDGE = 2, SHOWW = 64, RCW = 14, GAP = 6;
  // left hole, outside in: the chosen column (its depths marked on it), RC; the right hole the mirror of it
  const xShA = EDGE, xRcA = xShA + SHOWW + GAP;
  const xShB = box.w - EDGE - SHOWW, xRcB = xShB - GAP - RCW;
  const x1 = xRcA + RCW + 2, x2 = xRcB - 2;
  const inR = (S: Side, d: number) => d >= S.r[0] && d < S.r[1];

  // the metre lit in gold, with its link: under the pointer, else the selected one when it is in view
  const lit = hover ?? (cursorA !== null && inR(A, cursorA) ? cursorA : null);
  const inLit = (l: Link) => lit !== null && l.a === lit;
  const metreAt = (clientY: number, el: SVGGraphicsElement) => {
    const d = A.r[0] + (clientY - el.ownerSVGElement!.getBoundingClientRect().top - PAD) / A.k; const m = Math.floor(d);
    return d >= A.r[0] && d < A.r[1] && corr.links.some((l) => l.a === m) ? m : null;
  };

  // one column of a hole, metre by metre, over its side's range
  const column = (S: Side, kind: CorrShow | "rc", x: number, w: number) => {
    const { s, y, k, r } = S; const mv = s.mv; const out: React.ReactNode[] = [];
    const midx = new Map((mv?.m ?? []).map((m, i) => [m, i])); const names = new Map((mv?.core_types ?? []).map((c) => [c.k, c.name]));
    const vis = (m: number, h = 1) => m + h > r[0] && m < r[1];
    if (kind === "anom" || kind === "bd") out.push(<rect key="bg" x={x} y={PAD} width={w} height={H} fill="#f8fafc" />);
    if (kind === "bd") { for (const g of mv?.segments ?? []) if (g.from_m > r[0] && g.from_m < r[1]) out.push(<rect key={g.seg} x={x} y={y(g.from_m) - 0.75} width={w} height={1.5} fill="#0f172a" />); return out; }
    if ((kind === "swir" || kind === "tir") && s.spectral?.rows.length) {
      const hh = Math.max(s.spectral.step * k, 0.6);
      for (const row of s.spectral.rows) {
        const sd = row[kind]; if (!sd?.n_result || !vis(row.from_m, s.spectral.step)) continue;
        let at = 0;
        for (const g of [...order, ...Object.keys(sd.mix).filter((q) => !order.includes(q))]) { const v = sd.mix[g]; if (!v) continue; out.push(<rect key={`${row.from_m}${g}`} x={x + at * w} y={y(row.from_m)} width={v * w} height={hh} fill={groupColor(g)} />); at += v; }
      }
      return out;
    }
    const rawTop = mv ? Math.max(mv.anomaly.flag_raw * 1.4, 1e-6) : 1;
    s.hole.metres.m.forEach((m, i) => {
      if (!vis(m)) return; const j = midx.get(m); const hh = Math.max(k, 0.6);
      if (kind === "swir") out.push(<rect key={m} x={x} y={y(m)} width={w} height={hh} fill={groupColor(s.hole.metres.gs[i])} />);
      else if (kind === "tir") out.push(<rect key={m} x={x} y={y(m)} width={w} height={hh} fill={groupColor(s.hole.metres.gt[i])} />);
      else if (kind === "rc") out.push(<rect key={m} x={x} y={y(m)} width={w} height={hh} fill={j !== undefined && mv ? coreTypeColor(names.get(mv.core[j])) : groupColor(s.hole.metres.gs[i])} />);
      else if (kind === "anom" && mv && j !== undefined) {
        const flag = mv.anom_raw[j] >= mv.anomaly.flag_raw && mv.anom[j] >= mv.anomaly.flag_at;
        out.push(<rect key={m} x={x} y={y(m)} width={Math.max(1, Math.min(1, mv.anom_raw[j] / rawTop) * w)} height={hh} fill={flag ? SERIES.orange : "#9ca3af"} />);
      }
    });
    return out;
  };
  const fmtM = (d: number) => (Number.isInteger(d) ? String(d) : d.toFixed(1));
  const label = (x: number, y: number, t: string, anchor: "start" | "end" | "middle") => <text x={x} y={y} textAnchor={anchor} className="fill-slate-500 font-mono text-[9px]">{t}</text>;
  const head = (x: number, t: string, tip: string) => <text x={x} y={12} textAnchor="middle" data-keytip={tip} className="cursor-help fill-slate-600 text-[9.5px] font-semibold">{t}</text>;
  // the depths, marked on the chosen column itself: a fine line across it and the depth at its outer edge, haloed in white
  const axis = (S: Side, x: number, right: boolean) => {
    const step = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].find((t) => t * S.k >= 40) ?? 1000; const ts: number[] = [];
    const lo = Math.max(S.r[0], S.h0), hi = Math.min(S.r[1], S.h1);   // only where the hole has core, not past its foot on a shared axis
    for (let d = Math.ceil(lo / step) * step; d < hi - 1e-6; d += step) ts.push(d);
    return <g className="pointer-events-none">{ts.map((d) => <g key={d}>
      <line x1={x} x2={x + SHOWW} y1={S.y(d)} y2={S.y(d)} stroke="#0f172a" strokeOpacity={0.45} strokeWidth={0.8} />
      <text x={right ? x + SHOWW - 2 : x + 2} y={S.y(d) + 9} textAnchor={right ? "end" : "start"} stroke="#fff" strokeWidth={2.5} paintOrder="stroke" className="fill-slate-800 font-mono text-[9px] font-medium">{step < 1 ? d.toFixed(1) : String(Math.round(d))}</text>
    </g>)}</g>;
  };
  // a link's end outside the other window is drawn at that window's edge, dashed
  const clampY = (S: Side, d: number) => Math.min(PAD + H, Math.max(PAD, S.y(d)));
  const showLabel = CORR_SHOW.find((c) => c.id === show)!.label;
  return (
    <div ref={ref} className="relative h-full w-full">
      <svg width={box.w} height={box.h} className="block">
        <defs>
          <clipPath id={`${cid}a`}><rect x={0} y={PAD} width={x1} height={H} /></clipPath>
          <clipPath id={`${cid}b`}><rect x={x2} y={PAD} width={box.w - x2} height={H} /></clipPath>
        </defs>
        {corr.links.filter((l) => !inLit(l) && inR(A, l.a) && inR(B, l.b)).map((l) => <line key={`${l.a}`} x1={x1} y1={A.y(l.a + 0.5)} x2={x2} y2={B.y(l.b + 0.5)} stroke={LINE} strokeOpacity={0.25 + 0.5 * l.sim} strokeWidth={0.8} />)}
        {corr.links.filter(inLit).map((l) => <line key={`g${l.a}`} x1={x1} y1={A.y(l.a + 0.5)} x2={x2} y2={clampY(B, l.b + 0.5)} stroke={GOLD} strokeWidth={2.6} strokeLinecap="round" strokeDasharray={inR(B, l.b) ? undefined : "4 3"} />)}
        <g clipPath={`url(#${cid}a)`}>{column(A, show, xShA, SHOWW)}{column(A, "rc", xRcA, RCW)}</g>
        <g clipPath={`url(#${cid}b)`}>{column(B, "rc", xRcB, RCW)}{column(B, show, xShB, SHOWW)}</g>
        {axis(A, xShA, false)}{axis(B, xShB, true)}
        {/* the left hole, metre by metre: hover lights a metre and its link, a click marks it and its match */}
        <rect x={xShA} y={PAD} width={xRcA + RCW - xShA} height={H} fill="transparent" className="cursor-pointer"
          onMouseMove={(e) => setHover(metreAt(e.clientY, e.currentTarget))} onMouseLeave={() => setHover(null)}
          onClick={(e) => { const m = metreAt(e.clientY, e.currentTarget); const l = m === null ? undefined : corr.links.find((x) => x.a === m); if (l) onPick(l.a, l.b); }} />
        {lit !== null && <g clipPath={`url(#${cid}a)`}><rect x={xShA - 1} y={A.y(lit)} width={xRcA + RCW - xShA + 2} height={Math.max(A.k, 2)} fill="none" stroke={GOLD} strokeWidth={2} className="pointer-events-none" /></g>}
        {head(xShA + SHOWW / 2, showLabel, SHOW_TIP[show])}{head(xRcA + RCW / 2, "RC", TIP.rc + PICK)}
        {head(xRcB + RCW / 2, "RC", TIP.rc)}{head(xShB + SHOWW / 2, showLabel, SHOW_TIP[show])}
        {label(xShA + (xRcA + RCW - xShA) / 2, PAD + H + 11, `${fmtM(Math.min(A.r[1], a1))} m`, "middle")}
        {label(xRcB + (xShB + SHOWW - xRcB) / 2, PAD + H + 11, `${fmtM(Math.min(B.r[1], b1))} m`, "middle")}
      </svg>
    </div>
  );
}
