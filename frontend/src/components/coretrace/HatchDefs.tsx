import { coreTypeColor, coreTypeHatch, type Hatch } from "@/components/coretrace/palette";

// The rock-class hatches as SVG patterns, for the SVG drawings (Compare's middle view, the report's strip):
// one <pattern> per class that is not solid, and `fill` gives each class's fill.
const INK = "rgba(15,23,42,0.42)";
const MARK: Record<Exclude<Hatch, "solid">, React.ReactNode> = {
  diag: <path d="M-1,5 L5,-1 M-1,1 L1,-1 M3,5 L5,3" stroke={INK} strokeWidth={0.9} />,
  back: <path d="M-1,-1 L5,5 M3,-1 L5,1 M-1,3 L1,5" stroke={INK} strokeWidth={0.9} />,
  horiz: <path d="M0,0.5 H4" stroke={INK} strokeWidth={0.9} />,
  vert: <path d="M0.5,0 V4" stroke={INK} strokeWidth={0.9} />,
  grid: <path d="M0,0.5 H4 M0.5,0 V4" stroke={INK} strokeWidth={0.9} />,
  dots: <circle cx={2} cy={2} r={0.8} fill={INK} />,
};
const pid = (prefix: string, name: string) => `${prefix}-${coreTypeColor(name).slice(1)}-${coreTypeHatch(name)}`;

export function HatchDefs({ prefix, names }: { prefix: string; names: (string | undefined)[] }) {
  const seen = new Map<string, string>();
  for (const n of names) if (n && coreTypeHatch(n) !== "solid") seen.set(pid(prefix, n), n);
  return <>{[...seen].map(([id, n]) => (
    <pattern key={id} id={id} width={4} height={4} patternUnits="userSpaceOnUse">
      <rect width={4} height={4} fill={coreTypeColor(n)} />{MARK[coreTypeHatch(n) as Exclude<Hatch, "solid">]}
    </pattern>))}</>;
}

/** A class's SVG fill: its pattern (defined by HatchDefs with the same prefix), or its plain colour. */
export const hatchFill = (prefix: string, name: string | undefined) => (name && coreTypeHatch(name) !== "solid" ? `url(#${pid(prefix, name)})` : coreTypeColor(name));
