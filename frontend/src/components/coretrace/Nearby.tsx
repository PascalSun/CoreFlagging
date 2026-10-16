"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Columns2 } from "lucide-react";
import { coreScan, type HoleDetail } from "@/lib/coreScan";
import { fmt } from "@/components/coretrace/palette";
import { cn } from "@/lib/utils";

const RINGS = [5, 10] as const;

/** The holes within 5 or 10 km, nearest first: what a geologist reads a hole against. Choosing a ring draws
 * it on the map; each neighbour opens on its own or side by side with this one. */
export function Nearby({ hole, onOpen, onRing, onCompare }: { hole: HoleDetail; onOpen: (key: string) => void; onRing?: (km: number | null) => void; onCompare?: (key: string) => void }) {
  const [km, setKm] = useState<number | null>(null);
  const q = useQuery({ queryKey: ["core-nearby", hole.key, km], queryFn: () => coreScan.nearby(hole.key, km as number), enabled: km !== null, staleTime: 5 * 60_000 });
  useEffect(() => { onRing?.(km); return () => onRing?.(null); }, [km, onRing]);
  const rows = q.data?.holes ?? [];
  return (
    <div className="flex flex-col gap-2 text-xs text-slate-700">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-slate-500">Within</span>
        {RINGS.map((r) => (
          <button key={r} type="button" onClick={() => setKm(km === r ? null : r)} aria-pressed={km === r}
            className={cn("rounded-full border px-2.5 py-0.5 pointer-coarse:py-1.5 text-[11px] font-medium", km === r ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>{r} km</button>
        ))}
        {km !== null && !q.isPending && <span className="text-[11px] text-slate-500">{rows.length ? `${rows.length} ${rows.length === 1 ? "hole" : "holes"}` : "no other scanned hole"}</span>}
      </div>
      {km === null && <p className="text-[11px] leading-relaxed text-slate-500">Pick a ring to list the scanned holes around this one and draw it on the map, or <Link href={`/scene?hole=${encodeURIComponent(hole.key)}`} className="font-medium text-slate-700 underline-offset-2 hover:underline">see them in 3D</Link>.</p>}
      {km !== null && q.isPending && <p className="text-[11px] text-slate-500">Looking around…</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {rows.slice(0, 12).map((n) => (
            <li key={n.key} className="flex items-center gap-2 px-2.5 py-1.5">
              <button type="button" onClick={() => onOpen(n.key)} className="min-w-0 flex-1 text-left hover:underline">
                <span className="font-medium text-slate-900">{n.name}</span>
                <span className="text-slate-500"> · {n.km < 1 ? `${Math.round(n.km * 1000)} m` : `${fmt(n.km, 1)} km`}</span>
                {n.depth_max !== null && <span className="text-slate-400"> · {fmt(n.depth_max, 0)} m deep</span>}
                {n.n_again > 0 && <span className="text-slate-500"> · look again {fmt(n.again_m, 0)} m</span>}
                {n.status === "ready" && n.message && <span className="text-slate-400"> · scan only</span>}
              </button>
              <button type="button" onClick={() => onCompare?.(n.key)} title={`${hole.name} and ${n.name} side by side`}
                className="inline-flex h-6 items-center gap-1 rounded-md border border-slate-200 px-1.5 text-[11px] text-slate-600 hover:border-slate-400 hover:text-slate-900"><Columns2 size={11} />Compare</button>
            </li>
          ))}
          {rows.length > 12 && <li className="px-2.5 py-1.5 text-[11px] text-slate-500">and {rows.length - 12} more, nearest first</li>}
        </ul>
      )}
    </div>
  );
}
