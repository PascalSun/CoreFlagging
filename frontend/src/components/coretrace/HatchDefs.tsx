import { coreTypeColor, coreTypeHatch } from "@/components/coretrace/palette";

// The rock-class hatches as SVG patterns, for the SVG drawings (Compare's middle view, the report's strip): one
// <pattern> per hatched class, and `hatchFill` gives each class's fill.
const INK = "rgba(15,23,42,0.38)";
const pid = (prefix: string, name: string) => `${prefix}-${coreTypeColor(name).slice(1)}-${coreTypeHatch(name)}`;

export function HatchDefs({ prefix, names }: { prefix: string; names: (string | undefined)[] }) {
  const seen = new Map<string, string>();
  for (const n of names) if (n && coreTypeHatch(n) !== "solid") seen.set(pid(prefix, n), n);
  return <>{[...seen].map(([id, n]) => (
    <pattern key={id} id={id} width={6} height={6} patternUnits="userSpaceOnUse">
      <rect width={6} height={6} fill={coreTypeColor(n)} />
      <path d={`M1,-1 L-1,1 M7,-1 L-1,7 M13,-1 L-1,13${coreTypeHatch(n) === "cross" ? " M-7,-1 L1,7 M-1,-1 L7,7 M5,-1 L13,7" : ""}`} stroke={INK} strokeWidth={1} />
    </pattern>))}</>;
}

/** A class's SVG fill: its pattern (defined by HatchDefs with the same prefix), or its plain colour. */
export const hatchFill = (prefix: string, name: string | undefined) => (name && coreTypeHatch(name) !== "solid" ? `url(#${pid(prefix, name)})` : coreTypeColor(name));
