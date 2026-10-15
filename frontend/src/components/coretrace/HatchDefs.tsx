import { coreTypeFill } from "@/components/coretrace/palette";

// The rock-class fills as SVG patterns, for the SVG drawings (Compare's middle view, the report's strip): one
// <pattern> per class that has a fill over its colour, and `hatchFill` gives each class's fill.
const INK = "rgba(15,23,42,0.5)";
const pid = (prefix: string, name: string) => { const f = coreTypeFill(name); return `${prefix}-${[f.base, f.stripe ?? "", f.dot ?? "", f.rule ? 1 : 0].join("").replace(/#/g, "")}`; };
const plain = (name: string) => { const f = coreTypeFill(name); return !f.stripe && !f.dot && !f.rule; };

export function HatchDefs({ prefix, names }: { prefix: string; names: (string | undefined)[] }) {
  const seen = new Map<string, string>();
  for (const n of names) if (n && !plain(n)) seen.set(pid(prefix, n), n);
  return <>{[...seen].map(([id, n]) => { const f = coreTypeFill(n); return (
    <pattern key={id} id={id} width={6} height={6} patternUnits="userSpaceOnUse">
      <rect width={6} height={6} fill={f.base} />
      {f.stripe && <path d="M1,-1 L-1,1 M7,-1 L-1,7 M13,-1 L-1,13" stroke={f.stripe} strokeWidth={1.7} />}
      {f.dot && <circle cx={3} cy={3} r={1.2} fill={f.dot} stroke={INK} strokeWidth={0.5} />}
      {f.rule && <rect width={6} height={0.8} fill={INK} />}
    </pattern>); })}</>;
}

/** A class's SVG fill: its pattern (defined by HatchDefs with the same prefix), or its plain colour. */
export const hatchFill = (prefix: string, name: string | undefined) => (name && !plain(name) ? `url(#${pid(prefix, name)})` : coreTypeFill(name).base);
