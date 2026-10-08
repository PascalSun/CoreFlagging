// Where the core actually lies in each row of a tray photograph.
//
// The HyLogger records each row as a band from the photograph's left edge to the end of the tray, top to the next
// row: that takes in the depth-label strip, the tray wall and the rail under the core. This reads the photograph
// itself: the core's lines are mid-tone or textured, rails bright and flat, shadows dark and flat, so each row's
// core is the run of core lines over its band. Rows decide together (one tray, one geometry); a tray whose rows
// cannot be read (dark rails, pale core on a pale tray) takes the core's typical place in the band.

import { useEffect, useState } from "react";
import type { Tray } from "@/lib/coreScan";

const cache = new Map<string, Tray>();
const TYPICAL: [number, number] = [0.02, 0.78];

function lum(d: Uint8ClampedArray, i: number) { return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }

function refine(t: Tray, img: HTMLImageElement): Tray {
  const W = 600, H = Math.round((W * img.naturalHeight) / img.naturalWidth);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true }); if (!ctx) return t;
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const L = (x: number, y: number) => lum(px, (y * W + x) * 4);

  // the core's rows: per line of pixels, its brightness and how much it varies along the row. Core is mid-tone or
  // textured; a rail is bright and flat, a shadow dark and flat. Each row of the tray takes the run of core lines that
  // overlaps its recorded band most.
  const fitRow = (bx0: number, by0: number, bx1: number, by1: number): [number, number] | null => {
    const Y0 = Math.round(by0 * H), Y1 = Math.min(H, Math.round(by1 * H)), h = Y1 - Y0; if (h < 8) return null;
    const a = Math.max(0, Y0 - Math.round(0.3 * h)), b = Math.min(H, Y1 + Math.round(0.3 * h));
    const xa = Math.round((bx0 + 0.1 * (bx1 - bx0)) * W), xb = Math.round((bx0 + 0.9 * (bx1 - bx0)) * W);
    const mean: number[] = [], rough: number[] = [];
    for (let y = a; y < b; y++) {
      let s = 0, d = 0, d2 = 0, prev = L(xa, y);
      for (let x = xa; x < xb; x++) { const v = L(x, y); s += v; if (x > xa) { const k = v - prev; d += k; d2 += k * k; } prev = v; }
      const n = xb - xa; mean.push(s / n); const m = d / (n - 1); rough.push(Math.sqrt(Math.max(0, d2 / (n - 1) - m * m)));
    }
    const flat = [...rough].sort((p, q) => p - q)[Math.floor(rough.length * 0.25)] ?? 0;
    const on = mean.map((m, i) => ((m > 40 && m < 185) || rough[i] > Math.max(8, flat * 2.2)) && !(m > 200 && rough[i] < flat * 2.5));
    let best: [number, number] | null = null, bestOv = 0, st = -1;
    for (let i = 0; i <= on.length; i++) {
      if (i < on.length && on[i]) { if (st < 0) st = i; continue; }
      if (st >= 0) {
        const r: [number, number] = [a + st, a + i];
        const ov = Math.min(r[1], Y1) - Math.max(r[0], Y0);
        if (r[1] - r[0] >= 0.25 * h && ov > bestOv) { best = r; bestOv = ov; }
        st = -1;
      }
    }
    // a run taller than the row has swallowed its neighbours (no rail between them): no fit
    return best && bestOv > 0.3 * h && best[1] - best[0] <= 1.05 * h ? best : null;
  };

  // every row of a tray has the same geometry, so the tray's rows decide together: where at least half of them fit
  // and agree, each row takes the tray's median place in its band; otherwise the place the core typically has in
  // the band (its top four fifths; the rest is the rail and the gap under the core), measured over 500 rows in
  // trays from every State
  const rows = t.rows.filter((r) => r.box);
  const frac = rows.map((r) => {
    const [bx0, by0, bx1, by1] = r.box as [number, number, number, number]; const f = fitRow(bx0, by0, bx1, by1);
    return f ? [(f[0] / H - by0) / (by1 - by0), (f[1] / H - by0) / (by1 - by0)] : null;
  }).filter((f): f is number[] => f !== null);
  const q = (v: number[], p: number) => { const a = [...v].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))]; };
  let place: [number, number] = TYPICAL;
  if (frac.length >= Math.max(2, rows.length / 2)) {
    const tops = frac.map((f) => f[0]), bots = frac.map((f) => f[1]);
    if (q(tops, 0.75) - q(tops, 0.25) < 0.12 && q(bots, 0.75) - q(bots, 0.25) < 0.12) place = [q(tops, 0.5), q(bots, 0.5)];
  }
  return { ...t, rows: t.rows.map((r) => {
    if (!r.box) return r;
    const [bx0, by0, bx1, by1] = r.box, h = by1 - by0;
    // only the height changes: along the row a depth is placed from the scan's own positions (see marks)
    return { ...r, box: [bx0, Math.max(0, by0 + place[0] * h), bx1, Math.min(1, by0 + place[1] * h)] as [number, number, number, number] };
  }) };
}

/** The tray with each row's box fitted to the core in its photograph (`src`), once the photograph has loaded. */
export function useCoreBands(t: Tray | null, src: string | undefined): Tray | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!t || !src || cache.has(t.id)) return;
    let gone = false; const img = new Image();
    img.onload = () => { if (gone) return; try { cache.set(t.id, refine(t, img)); } catch { cache.set(t.id, t); } bump((n) => n + 1); };
    img.src = src;
    return () => { gone = true; };
  }, [t, src]);
  return t ? cache.get(t.id) ?? t : null;
}
