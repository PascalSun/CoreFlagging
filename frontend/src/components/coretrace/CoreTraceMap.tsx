"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, HelpCircle, MessageCircle, SlidersHorizontal, Upload, X } from "lucide-react";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { EmailGate } from "@ntlp/geodata-web/email-gate";
import { VerifyEmailDialog } from "@/components/auth/VerifyEmailDialog";
import { CoreChat, type OpenTarget } from "@/components/coretrace/CoreChat";
import { CoreMap, OVERLAYS, type Basemap, type Overlay } from "@/components/coretrace/CoreMap";
import { HolePanel } from "@/components/coretrace/HolePanel";
import { UploadDialog } from "@/components/coretrace/UploadDialog";
import { isAuthed, isVerified } from "@/lib/auth";
import { ACTIVE, coreScan, STATES } from "@/lib/coreScan";
import { COLOUR_MODES, SHAPE_MODES, classify, shapeOf, type ColourMode, type ShapeMode } from "@/components/coretrace/mapColour";
import { Mark, type Shape } from "@/components/coretrace/shapes";
import { ColourNote } from "@/components/coretrace/ColourNote";
import { HoleTable } from "@/components/coretrace/HoleTable";
import { holeCard } from "@/components/coretrace/mapCard";
import { Tour, tourSeen, type TourStep } from "@/components/coretrace/Tour";
import { Picker } from "@/components/coretrace/Picker";
import { LegendSheet } from "@/components/coretrace/LegendSheet";
import { HoleSheet } from "@/components/coretrace/HoleSheet";
import { coretraceBase } from "@/lib/sites";
import { useIsMobile } from "@/lib/useIsMobile";
import { cn } from "@/lib/utils";

type Filter = "all" | "mine" | "again" | "issues" | "notir" | "assays";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" }, { id: "mine", label: "My scans" }, { id: "again", label: "Worth a second look" }, { id: "assays", label: "With assays" }, { id: "issues", label: "With issues" }, { id: "notir", label: "No TIR" },
];
const glass = "rounded-2xl border border-white/60 bg-white/80 shadow-glass backdrop-blur-xl";

/** The CoreTrace map: every scanned hole in the State, and the way into any one of them.
 * What is open lives in the address (?hole=&m=&model=&full=1), so a view can be shared. */
export function CoreTraceMap() {
  const pathname = usePathname(); const sp = useSearchParams(); const qc = useQueryClient();
  const mobile = useIsMobile(); const base = coretraceBase(pathname);
  const holeKey = sp.get("hole"); const wide = sp.get("full") === "1";
  // on a phone the hole is a bottom sheet: half height when a hole opens, full screen when pulled up
  const [sheetFull, setSheetFull] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSheetFull(false); }, [holeKey]);
  // two tabs, as in the platform's workspace: the map, and every hole as a table
  const view = sp.get("view") === "holes" ? "holes" : "map";
  const metre = sp.get("m") !== null && /^\d+$/.test(sp.get("m") as string) ? Number(sp.get("m")) : null;
  // the depth window the reader has zoomed to, "from-to" in metres
  const win = useMemo<[number, number] | null>(() => { const w = sp.get("w"); if (!w) return null; const [a, b] = w.split("-").map(Number); return Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : null; }, [sp]);
  // the assistant is a column on the right, as in the platform's map workspace; open by default on a wide screen
  const [chatOpen, setChatOpen] = useState(true);
  // the chat column's width: dragged at its left edge, remembered on this browser
  const [CHAT_W, setChatWidth] = useState(420);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { const w = Number(localStorage.getItem("coretrace.chat_w")); if (w >= 320) setChatWidth(w); } catch { /* storage blocked */ } }, []);
  const dragChat = (e: React.PointerEvent) => {
    e.preventDefault(); const x0 = e.clientX, w0 = CHAT_W; let w = w0;
    const max = Math.min(760, Math.round(window.innerWidth * 0.6));
    const move = (ev: PointerEvent) => { w = Math.max(320, Math.min(max, w0 + (x0 - ev.clientX))); setChatWidth(w); };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      document.body.style.cursor = ""; document.body.style.userSelect = "";
      try { localStorage.setItem("coretrace.chat_w", String(w)); } catch { /* storage blocked */ }
    };
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  // on a phone the column would cover the map: start closed there
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (mobile) setChatOpen(false); }, [mobile]);
  // a search can be linked to (the regions page does)
  const [q, setQ] = useState(sp.get("q") ?? ""); const [filter, setFilter] = useState<Filter>("all"); const [state, setState] = useState("");
  const [upload, setUpload] = useState(false); const [verify, setVerify] = useState(false);
  const [authed, setAuthed] = useState(false);
  // the session lives in localStorage, which the server render cannot see
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setAuthed(isAuthed()); }, []);

  // What is open lives in the query string, changed in place with the browser's own history (Next keeps
  // useSearchParams in step). Not router.replace: on CoreTrace's own host /map is a rewrite of /coretrace/map,
  // and the router took a query-only change there for the same page and kept the old query, so a hole could
  // not be closed. The path is the one in the address bar for the same reason.
  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) { if (v === null) p.delete(k); else p.set(k, v); }
    const s = p.toString(); window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
  };

  const mq = useQuery({ queryKey: ["core-models"], queryFn: coreScan.models, staleTime: 10 * 60_000 });
  const models = useMemo(() => mq.data ?? [], [mq.data]);
  const run = sp.get("model") || models.find((m) => m.default)?.run || models[0]?.run || "";
  // the list is kept a minute: moving between the map, a hole and the list must not fetch six thousand rows again
  const hq = useQuery({ queryKey: ["core-holes", authed], queryFn: coreScan.holes, staleTime: 60_000, refetchInterval: (qq) => (qq.state.data?.holes.some((h) => h.mine && ACTIVE.includes(h.status)) ? 4000 : false), refetchIntervalInBackground: true });
  const holes = useMemo(() => hq.data?.holes ?? [], [hq.data]);
  const typeName = useMemo(() => new Map((hq.data?.core_types ?? []).map((c) => [c.k, c.name])), [hq.data]);
  const tab = sp.get("tab") || "metre";
  /** The assistant names holes as readers do; find the one it means and open it. */
  const openFromChat = (t: OpenTarget): boolean => {
    const n = t.hole.trim().toLowerCase();
    const h = holes.find((x) => x.key.toLowerCase() === n || x.name.toLowerCase() === n) ?? holes.find((x) => x.name.toLowerCase().replace(/[^a-z0-9]/g, "") === n.replace(/[^a-z0-9]/g, ""));
    if (!h) return false;
    set({ hole: h.key, m: t.m === undefined ? null : String(t.m), full: h.status === "ready" && (t.m !== undefined || t.tab) ? "1" : null, tab: t.tab && t.tab !== "metre" ? t.tab : null, view: null });   // the hole is shown on the map, whichever tab was open
    return true;
  };
  const selected = holes.find((h) => h.key === holeKey) ?? null;

  // the State and the filter chips decide what is on the map; the search only finds holes among them
  const onMap = useMemo(() => holes.filter((h) => {
    if (state && h.state !== state && !h.mine) return false;
    if (filter === "mine" && !h.mine) return false;
    if (filter === "again" && !h.n_again) return false;
    if (filter === "issues" && !h.n_issues) return false;
    if (filter === "notir" && (h.status !== "ready" || h.tir === "ok")) return false;
    if (filter === "assays" && !h.au_m) return false;
    return true;
  }), [holes, filter, state]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return onMap.filter((h) => !s || h.name.toLowerCase().includes(s) || h.key.toLowerCase().includes(s) || h.operator.toLowerCase().includes(s) || h.project.toLowerCase().includes(s) || h.region.toLowerCase().includes(s))
      .sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.status === "ready") - Number(a.status === "ready") || a.name.localeCompare(b.name));
  }, [onMap, q]);
  // what the hole was drilled for by default: the question an explorer asks first; core type and "look again" are views to switch to
  // context layers from the platform (DMIRS interim data), off until asked for
  const [overlays, setOverlays] = useState<Partial<Record<Overlay, boolean>>>({});
  const toggleOverlay = (id: Overlay) => setOverlays((o) => ({ ...o, [id]: !o[id] }));
  // the neighbours' ring, when the hole page asks for one (reset when the hole changes)
  const [ringKm, setRingKm] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setRingKm(null); }, [holeKey]);
  const [mode, setMode] = useState<ColourMode>("target"); const [focus, setFocus] = useState<string | null>(null);
  const [shapeMode, setShapeMode] = useState<ShapeMode>("gold"); const [filtersOpen, setFiltersOpen] = useState(false); const [legendOpen, setLegendOpen] = useState(true);
  // on a phone the legend starts folded to its one line of pickers, so the map keeps the screen
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (mobile) setLegendOpen(false); }, [mobile]);
  // the tour runs once, on a first visit with a wide screen, after the holes have arrived; "?" in the top bar replays it
  // the basemap, remembered on this browser
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { if (localStorage.getItem("coretrace.basemap") === "map") setBasemap("map"); } catch { /* storage blocked */ } }, []);
  const pickBasemap = (b: Basemap) => { setBasemap(b); try { localStorage.setItem("coretrace.basemap", b); } catch { /* storage blocked */ } };
  const [touring, setTouring] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!mobile && !holeKey && hq.data && !tourSeen()) setTouring(true); }, [hq.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const tour: TourStep[] = [
    { title: "Welcome to CoreTrace", body: `Every HyLogger-scanned drillhole in Australia's core libraries, ${holes.length ? holes.length.toLocaleString() + " of them, " : ""}read metre by metre by a model trained on scanned drill core. Five quick steps.` },
    { target: "legend", title: "Each point is a drillhole", body: "Colour is what the hole was drilled for (gold, copper, nickel\u2026 from the survey's record of the hole; WA, SA and Victoria carry it); shape is whether its assays found gold. Switch the colour to \u201cCore type\u201d for what the model reads, or \u201cLook again\u201d for where it differs from the geologist's log. Click a row to show only those holes." },
    { target: "tabs", title: "Map, or every hole as a table", body: "The Holes tab lists every hole: search by name, company or region and sort by depth or gold. The State and filter beside it apply to both." },
    ...(chatOpen && !mobile ? [{ target: "chat", title: "Ask in plain words", body: "\u201cHoles with gold in NSW\u201d, \u201cwhat is unusual in MND036?\u201d. The assistant answers from the same data, and opens the holes it talks about on the map." }] : []),
    { target: "upload", title: "Bring your own scan", body: "Upload a TSG package from a HyLogger: it gets the same checks, log and model reading as the library holes, and stays private to you." },
    { title: "Open any hole", body: "Click a point. You get its tray photographs, a strip log down the hole, and what the model reads at each metre. Hover the log to move through it." },
  ];
  const colour = useMemo(() => (h: (typeof holes)[number]) => {
    const c = classify(h, mode, typeName), sh = shapeOf(h, shapeMode);
    return { ...c, shape: sh?.shape, shapeLabel: sh?.label, dim: focus !== null && c.label !== focus && sh?.label !== focus };
  }, [mode, shapeMode, typeName, focus]);
  const shapes = useMemo(() => {
    const c = new Map<string, { shape: Shape; n: number; order: number }>();
    for (const h of onMap) {
      if (h.lat === null) continue;
      const k = shapeOf(h, shapeMode); if (!k) continue;
      const e = c.get(k.label) ?? { shape: k.shape, n: 0, order: k.order }; e.n++; c.set(k.label, e);
    }
    return [...c.entries()].sort((a, b) => a[1].order - b[1].order);
  }, [onMap, shapeMode]);
  // the legend counts what is on the map, so it changes with the State picked
  const legend = useMemo(() => {
    const c = new Map<string, { color: string; n: number; order: number; ring?: string; wait?: boolean; glyph?: string }>();
    for (const h of onMap) {
      if (h.lat === null) continue;
      const k = classify(h, mode, typeName); const e = c.get(k.label) ?? { color: k.color, n: 0, order: k.order, ring: k.ring, wait: k.wait, glyph: k.glyph }; e.n++; c.set(k.label, e);
    }
    return [...c.entries()].sort((a, b) => a[1].order - b[1].order || b[1].n - a[1].n);
  }, [onMap, mode, typeName]);
  const perState = useMemo(() => { const c = new Map<string, number>(); for (const h of holes) if (h.state) c.set(h.state, (c.get(h.state) ?? 0) + 1); return c; }, [holes]);
  const mine = holes.filter((h) => h.mine).length;

  // sign-in is the platform's: /auth/signin sends the browser there and back here (one sign-in for every app)
  // Sign-in happens right here, in the platform's shared dialog (no trip to another site).
  const [gate, setGate] = useState(false);
  const toSignIn = () => setGate(true);;
  const openUpload = () => { if (!isAuthed()) toSignIn(); else if (!isVerified()) setVerify(true); else setUpload(true); };
  // "?upload=1" (the landing page's link) opens the upload flow once
  const wantUpload = sp.get("upload") === "1";
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (wantUpload) { openUpload(); set({ upload: null }); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantUpload]);

  const chatW = chatOpen && !mobile ? CHAT_W : 0;
  // the screen's width is read after the page has hydrated (the server cannot know it), and followed on resize
  const [vw, setVw] = useState(1440); const [vh, setVh] = useState(900);
  useEffect(() => { const f = () => { setVw(window.innerWidth); setVh(window.innerHeight); }; f(); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  // the top bar's room: the screen less the chat column; pickers and labels fold away as it narrows
  const barW = vw - chatW;
  const panelW = !holeKey ? 0 : wide ? Math.max(560, Math.min(1180, vw - chatW - 60 - 24)) : 420;

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-50 text-slate-900">
      <div className="absolute inset-0 z-0"><CoreMap holes={onMap} basemap={basemap} colour={colour} card={(h) => holeCard(h, colour(h), typeName, COLOUR_MODES.find((m) => m.id === mode)?.label)} fitTo={state} selected={selected} ringKm={ringKm} overlays={overlays} onSelect={(k) => set({ hole: k, m: null, full: null })} padRight={mobile ? 0 : panelW + chatW} padBottom={mobile && holeKey ? Math.round(vh * 0.56) : 0} /></div>

      {/* the legend: what colour and shape mean, each switchable, in as little room as the map can spare.
          A row picked here leaves every other hole faint; the card folds away to a single line. */}
      {view === "map" && holes.length > 0 && !mobile && (() => {
        const shown = legend.filter(([, e]) => !e.wait); const waiting = legend.find(([, e]) => e.wait)?.[1].n ?? 0;
        const row = (label: string, mark: React.ReactNode, n: number) => {
          const on = focus === label, off = focus !== null && !on;
          return (
            <button key={label} type="button" onClick={() => setFocus(on ? null : label)} aria-pressed={on} title={on ? "Show every hole" : `Show only: ${label}`}
              className={cn("flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-white", on && "bg-white font-semibold text-slate-900", off ? "opacity-35" : "text-slate-700")}>
              {mark}<span className="min-w-0 flex-1 truncate">{label}</span><span className="font-mono text-[10px] tabular-nums text-slate-400">{n.toLocaleString()}</span>
            </button>
          );
        };
        return (
          <div data-tour="legend" className={cn(glass, "absolute bottom-8 left-3 z-10 w-[calc(100vw-24px)] max-w-[332px] sm:bottom-3 sm:left-[52px]")}>
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="text-[11px] font-medium text-slate-500">Colour</span>
              <div className="w-[118px]"><Picker value={mode} label="Colour the holes by" side="top" options={COLOUR_MODES.map((m) => ({ id: m.id, label: m.label }))} onChange={(v) => { setMode(v); setFocus(null); }} /></div>
              <span className="text-[11px] font-medium text-slate-500">Shape</span>
              <div className="w-[104px]"><Picker value={shapeMode} label="Shape the holes by" side="top" options={SHAPE_MODES.map((m) => ({ id: m.id, label: m.short }))} onChange={(v) => { setShapeMode(v); setFocus(null); }} /></div>
              <button type="button" onClick={() => setLegendOpen((o) => !o)} aria-label={legendOpen ? "Fold the legend" : "Open the legend"} className="ml-auto grid size-6 place-items-center rounded text-slate-500 hover:bg-white">
                {legendOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
            </div>
            {legendOpen && (
              <div className="border-t border-white/70 px-2 pb-2 pt-1.5">
                <div className="grid grid-cols-2 gap-x-1">{shown.map(([label, e]) => row(label, <Mark color={e.color} ring={e.ring} glyph={e.glyph} size={11} />, e.n))}</div>
                {shapes.length > 0 && <div className="mt-1 grid grid-cols-2 gap-x-1 border-t border-white/70 pt-1">{shapes.map(([label, e]) => row(label, <Mark shape={e.shape} color="#64748b" size={11} />, e.n))}</div>}
                <div className="mt-1 border-t border-white/70 pt-1.5">
                  <p className="px-1 text-[10.5px] font-medium text-slate-500">Also show</p>
                  {OVERLAYS.map((o) => (
                    <label key={o.id} title={o.hint} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs text-slate-700 hover:bg-white">
                      <input type="checkbox" checked={!!overlays[o.id]} onChange={() => toggleOverlay(o.id)} className="size-3 accent-slate-900" />
                      <i className="inline-block size-2.5 rounded-full" style={{ background: o.color }} /><span className="min-w-0 flex-1 truncate">{o.label}</span><span className="text-[10px] text-slate-400">interim</span>
                    </label>
                  ))}
                </div>
                <p className="mt-1.5 flex items-center justify-between px-1 text-[10.5px] text-slate-500">
                  <span>{focus ? "Showing one class" : "Click a row to show only those holes"}{waiting ? ` · ${waiting.toLocaleString()} still being processed` : ""}</span>
                  {focus && <button type="button" onClick={() => setFocus(null)} className="font-medium text-slate-800 hover:underline">Show all</button>}
                </p>
                {(mode === "target" || mode === "type") && <ColourNote kind={mode === "target" ? "target" : "mineral"} className="mt-0.5" />}
              </div>
            )}
          </div>
        );
      })()}

      {/* satellite or terrain map, bottom right of the map; on a phone both live in the legend sheet */}
      {view === "map" && !mobile && (
        <div className={cn(glass, "absolute bottom-3 z-10 flex gap-0.5 rounded-full p-1")} style={{ right: (holeKey ? panelW + 24 : 12) + chatW }} role="radiogroup" aria-label="Basemap">
          {([["satellite", "Satellite"], ["map", "Map"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={basemap === id} onClick={() => pickBasemap(id)}
              className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors", basemap === id ? "bg-ink text-white" : "text-slate-600 hover:text-slate-900")}>{label}</button>
          ))}
        </div>
      )}
      {view === "map" && mobile && !holeKey && holes.length > 0 && (
        <LegendSheet modes={COLOUR_MODES} mode={mode} onMode={setMode} shapeModes={SHAPE_MODES} shapeMode={shapeMode} onShapeMode={setShapeMode}
          overlays={OVERLAYS.map((o) => ({ id: o.id, label: o.label, color: o.color, on: !!overlays[o.id] }))} onOverlay={(id) => toggleOverlay(id as Overlay)}
          basemaps={[{ id: "satellite" as Basemap, label: "Satellite" }, { id: "map" as Basemap, label: "Map" }]} basemap={basemap} onBasemap={pickBasemap}
          legend={legend} shapes={shapes} focus={focus} onFocus={setFocus} />
      )}

      {touring && <Tour steps={tour} onClose={() => setTouring(false)} />}

      {/* top bar: brand left, session right */}
      <div className="pointer-events-none absolute top-0 left-0 z-20 flex items-start justify-between gap-2 p-3 sm:gap-3" style={{ right: chatW }}>
        {/* on a phone the mark alone, as a round button; on a wide screen the mark and the name in a pill */}
        <Link href={base || "/"} aria-label="CoreTrace home" className="pointer-events-auto flex-none rounded-full shadow-glass sm:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/coretrace-mark.svg" alt="CoreTrace" className="size-11 rounded-full ring-1 ring-white/60" />
        </Link>
        <Link href={base || "/"} className={cn(glass, "pointer-events-auto hidden h-11 flex-none items-center gap-2 rounded-full pr-4 pl-1.5 font-display text-sm font-bold tracking-tight text-ink sm:flex")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/coretrace-mark.svg" alt="" className="size-8 rounded-full" />CORETRACE
        </Link>
        <div className="pointer-events-auto mr-auto flex min-w-0 items-center gap-2">
          <div data-tour="tabs" className={cn(glass, "flex h-11 items-center gap-0.5 rounded-full p-1")} role="tablist" aria-label="View">
            {(["map", "holes"] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => set({ view: id === "map" ? null : id })}
                className={cn("flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-semibold transition-colors sm:px-4", view === id ? "bg-ink text-white" : "text-slate-600 hover:text-slate-900")}>
                {id === "map" ? "Map" : "Holes"}
                {id === "holes" && !hq.isLoading && <span className={cn("hidden rounded-full px-1.5 sm:inline font-mono text-[10px] font-medium", view === id ? "bg-white/20" : "bg-slate-200/70")}>{onMap.length.toLocaleString()}</span>}
              </button>
            ))}
          </div>
          {/* the State and which-holes pickers: inline when the bar has room, behind a Filter button when it has not */}
          {barW >= 1000 ? (
            <div className={cn(glass, "flex h-11 items-center gap-2 rounded-full px-3.5")}>
            <div className="w-[11rem]"><Picker value={state} label="State" className="border-transparent bg-transparent text-sm hover:border-transparent" menuClassName="max-h-[70vh] overflow-y-auto"
              options={[{ id: "", label: "All of Australia" }, ...STATES.filter((x) => perState.get(x.id)).map((x) => ({ id: x.id, label: `${x.name} (${(perState.get(x.id) ?? 0).toLocaleString()})` }))]} onChange={setState} /></div>
            <span className="h-5 w-px bg-slate-200" aria-hidden />
            <div className="w-[8rem]"><Picker value={filter} label="Which holes" className="border-transparent bg-transparent text-sm hover:border-transparent"
              options={FILTERS.filter((f) => f.id !== "mine" || mine > 0).map((f) => ({ id: f.id, label: f.id === "all" ? "Every hole" : `${f.label}${f.id === "mine" ? ` (${mine})` : ""}` }))} onChange={setFilter} /></div>
            </div>
          ) : !mobile && (
            <div className="relative">
              <button type="button" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}
                className={cn(glass, "flex h-11 items-center gap-2 rounded-full px-3.5 text-sm font-medium text-slate-700 hover:bg-white")}>
                <SlidersHorizontal size={15} />Filter
                {(state || filter !== "all") && <span className="rounded-full bg-ink px-1.5 text-[10px] font-semibold text-white">{(state ? 1 : 0) + (filter !== "all" ? 1 : 0)}</span>}
              </button>
              {filtersOpen && (
                <div className={cn(glass, "absolute top-[calc(100%+8px)] left-0 z-30 flex w-64 flex-col gap-2 p-3")}>
                  <p className="text-[11px] font-medium text-slate-500">State</p>
            <div className="w-full"><Picker value={state} label="State" className="py-1.5 text-sm" menuClassName="max-h-[70vh] overflow-y-auto"
              options={[{ id: "", label: "All of Australia" }, ...STATES.filter((x) => perState.get(x.id)).map((x) => ({ id: x.id, label: `${x.name} (${(perState.get(x.id) ?? 0).toLocaleString()})` }))]} onChange={setState} /></div>
                  <p className="text-[11px] font-medium text-slate-500">Which holes</p>
            <div className="w-full"><Picker value={filter} label="Which holes" className="py-1.5 text-sm"
              options={FILTERS.filter((f) => f.id !== "mine" || mine > 0).map((f) => ({ id: f.id, label: f.id === "all" ? "Every hole" : `${f.label}${f.id === "mine" ? ` (${mine})` : ""}` }))} onChange={setFilter} /></div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          {!mobile && <button type="button" onClick={() => { set({ view: null, hole: null }); setTouring(true); }} aria-label="Show the guided tour" title="Show the guided tour" className={cn(glass, "grid size-11 place-items-center rounded-full text-slate-600 hover:bg-white hover:text-slate-900")}><HelpCircle size={18} /></button>}
          {!chatOpen && <button type="button" onClick={() => setChatOpen(true)} aria-label="Ask about the core" className={cn(glass, "flex h-11 items-center gap-2 rounded-full px-3.5 text-sm font-semibold text-slate-800 hover:bg-white sm:px-4")}><MessageCircle size={15} /><span className="hidden sm:inline">Ask</span></button>}
          <button type="button" data-tour="upload" onClick={openUpload} aria-label="Upload a scan" className="flex h-11 items-center gap-2 whitespace-nowrap rounded-full bg-ink px-3.5 text-sm font-semibold sm:px-4 text-white shadow-glass-sm hover:bg-ink-soft"><Upload size={15} />{!mobile && <span>{barW >= 1120 ? "Upload a scan" : "Upload"}</span>}</button>
          {authed ? <div className={cn(glass, "grid h-11 place-items-center rounded-full px-1.5")}><AccountMenu /></div>
            : <button type="button" onClick={toSignIn} className={cn(glass, "h-11 whitespace-nowrap rounded-full px-3 text-sm font-medium text-slate-700 hover:bg-white sm:px-4")}>Sign in</button>}
        </div>
      </div>

      {/* the holes tab: every hole on the map as a table */}
      {view === "holes" && (
        <div className={cn(glass, "absolute top-[68px] bottom-3 left-3 z-20 overflow-hidden bg-white/92")} style={{ right: chatW + 12 }}>
          <HoleTable holes={list} q={q} onQ={setQ} look={colour} typeName={typeName} loading={hq.isLoading} sheet={{ state, q }} onOpen={(k) => set({ hole: k, m: null, full: null, view: null })}
            onAsk={chatOpen ? undefined : () => setChatOpen(true)} />
        </div>
      )}

      {/* the hole: a panel at the right on a wide screen, a bottom sheet on a phone */}
      {holeKey && !mobile && (
        <aside className="absolute z-30 overflow-hidden rounded-2xl border border-white/60 bg-white/90 shadow-glass backdrop-blur-xl" style={{ top: 68, bottom: 12, width: panelW, right: chatW + 12 }}>
          <HolePanel key={holeKey} holeKey={holeKey} tab={tab} onTab={(t) => set({ tab: t === "metre" ? null : t })} models={models} run={run} onRun={(r) => set({ model: r })} metre={metre} onMetre={(m) => set({ m: m === null ? null : String(m) })}
            wide={wide} onWide={(w) => set({ full: w ? "1" : null })} onClose={() => set({ hole: null, m: null, full: null, tab: null, w: null })} win={win} onWindow={(r) => set({ w: r ? `${r[0]}-${r[1]}` : null, full: r ? "1" : null, tab: r ? "window" : null })}
            onOpenHole={(k, m) => set({ hole: k, m: m === undefined ? null : String(m), full: "1" })}
            onDeleted={() => set({ hole: null, m: null, full: null })} onRing={setRingKm} />
        </aside>
      )}
      {holeKey && mobile && (
        <HoleSheet full={wide || sheetFull} onFull={(f) => { setSheetFull(f); if (!f && wide) set({ full: null }); }} onClose={() => set({ hole: null, m: null, full: null, tab: null })}>
          <HolePanel key={holeKey} holeKey={holeKey} tab={tab} onTab={(t) => set({ tab: t === "metre" ? null : t })} models={models} run={run} onRun={(r) => set({ model: r })} metre={metre} onMetre={(m) => set({ m: m === null ? null : String(m) })}
            wide={wide} onWide={(w) => set({ full: w ? "1" : null })} onClose={() => set({ hole: null, m: null, full: null, tab: null, w: null })} win={win} onWindow={(r) => set({ w: r ? `${r[0]}-${r[1]}` : null, full: r ? "1" : null, tab: r ? "window" : null })}
            onOpenHole={(k, m) => set({ hole: k, m: m === undefined ? null : String(m), full: "1" })}
            onDeleted={() => set({ hole: null, m: null, full: null })} onRing={setRingKm} />
        </HoleSheet>
      )}

      {/* right: the assistant, a full-height column like the platform's chat */}
      {chatOpen && (
        <aside data-tour="chat" className="absolute inset-0 z-40 flex flex-col border-l border-slate-200 bg-white shadow-glass sm:inset-y-0 sm:right-0 sm:left-auto" style={mobile ? undefined : { width: CHAT_W }}>
          {!mobile && (
            <div onPointerDown={dragChat} onDoubleClick={() => { setChatWidth(420); try { localStorage.removeItem("coretrace.chat_w"); } catch { /* storage blocked */ } }}
              role="separator" aria-orientation="vertical" aria-label="Resize the chat" title="Drag to resize · double-click to reset"
              className="group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize">
              <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors group-hover:bg-cyan group-active:bg-cyan" />
              <span className="absolute top-1/2 left-1/2 h-10 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div className="min-w-0">
              <h2 className="font-display text-[15px] font-semibold text-slate-900">Ask about the core</h2>
              <p className="truncate text-xs text-slate-500">{selected ? `Talking about ${selected.name}${metre !== null ? `, ${metre} m` : ""}` : "Any hole, metre or model, in any language"}</p>
            </div>
            <button type="button" onClick={() => setChatOpen(false)} aria-label="Close the assistant" className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={16} /></button>
          </div>
          <CoreChat context={{ hole: selected?.key ?? null, m: metre, model: sp.get("model") }} onOpen={openFromChat} signedIn={authed} onSignIn={toSignIn} />
        </aside>
      )}

      <UploadDialog open={upload} onClose={() => setUpload(false)} onNeedVerify={() => { setUpload(false); setVerify(true); }}
        onQueued={(h) => { setUpload(false); qc.invalidateQueries({ queryKey: ["core-holes"] }); setFilter("mine"); set({ hole: h.key, m: null, full: null }); }} />
      <EmailGate open={gate} onClose={() => setGate(false)} onAuthed={() => { setGate(false); setAuthed(true); }} />
      <VerifyEmailDialog open={verify} onClose={() => setVerify(false)} onVerified={() => { setVerify(false); setUpload(true); }} />
    </div>
  );
}
