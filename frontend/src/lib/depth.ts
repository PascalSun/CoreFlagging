/** The depth axis of a hole: the levels it snaps to and the arithmetic of windows on it. */

export type Window = [number, number];

/** The levels the depth axis snaps to, by window length. */
export const LEVELS: { id: string; label: string; span: number | null }[] = [
  { id: "hole", label: "Whole hole", span: null }, { id: "10m", label: "10 m", span: 10 }, { id: "1m", label: "1 m", span: 1 }, { id: "10cm", label: "10 cm", span: 0.3 },
];
export const MIN_SPAN = 0.3;

/** Which level a window is at: the finest whose span it fits. */
export function levelOf(win: Window | null): string {
  if (!win) return "hole";
  const s = win[1] - win[0];
  return s <= 0.5 ? "10cm" : s <= 2.5 ? "1m" : s <= 25 ? "10m" : "hole";
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** A window of `span` metres about `centre`, kept inside the hole and on tenths of a metre. */
export function windowAbout(centre: number, span: number, hole0: number, hole1: number): Window {
  const s = Math.max(MIN_SPAN, Math.min(hole1 - hole0, span));
  const a = Math.max(hole0, Math.min(hole1 - s, centre - s / 2));
  return [r1(a), r1(a + s)];
}

/** The window at a level about a centre: null for the whole hole. */
export function windowAt(level: string, centre: number, hole0: number, hole1: number): Window | null {
  const sp = LEVELS.find((l) => l.id === level)?.span ?? null;
  return sp === null ? null : windowAbout(centre, sp, hole0, hole1);
}

/** "238.4–238.7 m" / "230–240 m": a window written at the precision its length calls for. */
export function fmtWindow(w: Window): string {
  const s = w[1] - w[0], d = s < 1 ? 2 : s < 10 ? 1 : 0;
  return `${w[0].toFixed(d)}–${w[1].toFixed(d)} m`;
}

/** "30 cm" / "2.4 m" / "10 m". */
export function fmtSpan(s: number): string {
  return s >= 1 ? `${s < 10 ? s.toFixed(1).replace(/\.0$/, "") : Math.round(s)} m` : `${Math.round(s * 100)} cm`;
}
