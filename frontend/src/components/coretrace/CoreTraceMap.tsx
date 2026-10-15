"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, HelpCircle, Layers, MessageCircle, Minus, Plus, ScanSearch, Upload, X } from "lucide-react";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { EmailGate } from "@ntlp/geodata-web/email-gate";
import { VerifyEmailDialog } from "@/components/auth/VerifyEmailDialog";
import { CoreChat, type OpenTarget } from "@/components/coretrace/CoreChat";
import { BASEMAPS, CoreMap, type Basemap, type MapApi, type Overlay } from "@/components/coretrace/CoreMap";
import { HolePanel } from "@/components/coretrace/HolePanel";
import { UploadDialog } from "@/components/coretrace/UploadDialog";
import { isAuthed, isVerified } from "@/lib/auth";
import { ACTIVE, coreScan } from "@/lib/coreScan";
import { classify, shapeOf } from "@/components/coretrace/mapColour";
import { MapKey, MapKeyBody, NO_HIDDEN, PANEL_W, facet, filtering, passes, type Facet, type Hidden } from "@/components/coretrace/MapKey";
import { HoleTable } from "@/components/coretrace/HoleTable";
import { holeCard } from "@/components/coretrace/mapCard";
import { Tour, tourSeen, type TourStep } from "@/components/coretrace/Tour";
import { LegendSheet } from "@/components/coretrace/LegendSheet";
import { HoleSheet } from "@/components/coretrace/HoleSheet";
import { coretraceBase } from "@/lib/sites";
import { useIsMobile } from "@/lib/useIsMobile";
import { cn } from "@/lib/utils";

const glass = "rounded-2xl border border-white/60 bg-white/80 shadow-glass backdrop-blur-xl";

/** The Core Flagging map: every scanned hole in the State, and the way into any one of them.
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
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [upload, setUpload] = useState(false); const [verify, setVerify] = useState(false);
  const [authed, setAuthed] = useState(false);
  // the session lives in localStorage, which the server render cannot see
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setAuthed(isAuthed()); }, []);

  // What is open lives in the query string, changed in place with the browser's own history (Next keeps
  // useSearchParams in step). Not router.replace: on Core Flagging's own host /map is a rewrite of /coretrace/map,
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

  // every hole is on the map; the key decides which are drawn, and the search only finds holes in the list
  const onMap = holes;
  // "worth a second look": only the holes where the model's reading disagrees with the geologist's log, on the map
  // and in the table alike (switched in the top bar)
  const [again, setAgain] = useState(false);
  const againN = useMemo(() => holes.filter((h) => h.n_again > 0).length, [holes]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return onMap.filter((h) => (!again || h.n_again > 0) && (!s || h.name.toLowerCase().includes(s) || h.key.toLowerCase().includes(s) || h.operator.toLowerCase().includes(s) || h.project.toLowerCase().includes(s) || h.region.toLowerCase().includes(s)))
      .sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.status === "ready") - Number(a.status === "ready") || a.name.localeCompare(b.name));
  }, [onMap, q, again]);
  // what the hole was drilled for by default: the question an explorer asks first; core type and "look again" are views to switch to
  // context layers from the platform (DMIRS interim data), off until asked for
  const [overlays, setOverlays] = useState<Partial<Record<Overlay, boolean>>>({});
  const toggleOverlay = (id: Overlay) => setOverlays((o) => ({ ...o, [id]: !o[id] }));
  // the neighbours' ring, when the hole page asks for one (reset when the hole changes)
  const [ringKm, setRingKm] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setRingKm(null); }, [holeKey]);
  // the map key: rows hidden in each of its sections, and a range of years drilled; together they decide which
  // of the holes on the map are drawn
  const [hidden, setHidden] = useState<Hidden>(NO_HIDDEN); const [years, setYears] = useState<[number, number] | null>(null);
  const onHidden = (f: Facet, s: Set<string>) => setHidden((h) => ({ ...h, [f]: s }));
  const [keyFolded, setKeyFolded] = useState(false);
  const mapApi = useRef<MapApi | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
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
    { title: "Welcome to Core Flagging", body: `Every HyLogger-scanned drillhole in Australia's core libraries, ${holes.length ? holes.length.toLocaleString() + " of them, " : ""}read metre by metre by a model trained on scanned drill core. Five quick steps.` },
    { target: "legend", title: "Each point is a drillhole", body: "Colour is what the hole was drilled for \u2014 gold, copper, nickel\u2026 from the survey's record of the hole in WA, SA and Victoria, from its exploration report or the nearest known deposit elsewhere (a hatched fill). A square is a scan the models could not read. Hover a row in the key to show only those holes or hide them, by core type, commodity, source or model reading; every count follows what is shown." },
    { target: "tabs", title: "Map, or every hole as a table", body: "The Table tab lists every hole: search by name, company or region and sort by depth or gold. The map key on the left decides which holes the map draws." },
    ...(chatOpen && !mobile ? [{ target: "chat", title: "Ask in plain words", body: "\u201cHoles with gold in NSW\u201d, \u201cwhat is unusual in MND036?\u201d. The assistant answers from the same data, and opens the holes it talks about on the map." }] : []),
    { target: "upload", title: "Bring your own scan", body: "Upload a TSG package from a HyLogger: it gets the same checks, log and model reading as the library holes, and stays private to you." },
    { title: "Open any hole", body: "Click a point. You get its strip log, its tray photographs, and what the model reads at each metre. Zoom the log from the whole hole down to 10 cm, open \u201cLook again\u201d for where the scan is worth a second look, and \u201cSimilar core\u201d for core like it anywhere in the State." },
  ];
  // colour is always the target commodity; shape is whether the models read the hole
  const colour = useMemo(() => (h: (typeof holes)[number]) => {
    const c = classify(h), sh = shapeOf(h);
    return { ...c, shape: sh?.shape, shapeLabel: sh?.label };
  }, []);
  // the key counts the processed holes, facet by facet
  const faceted = useMemo(() => onMap.filter((h) => h.lat !== null && h.status === "ready").map((h) => facet(h, typeName)), [onMap, typeName]);
  const keyOn = filtering(hidden, years, again);
  // what is drawn: the holes the key lets through; holes still waiting only while the key filters nothing
  const drawn = useMemo(() => {
    if (!keyOn) return onMap;
    const pass = new Set(faceted.filter((f) => passes(f, hidden, years, again)).map((f) => f.h.key));
    return onMap.filter((h) => pass.has(h.key));
  }, [onMap, faceted, hidden, years, again, keyOn]);
  const waitingN = useMemo(() => onMap.filter((h) => h.lat !== null && h.status !== "ready").length, [onMap]);
  const resetKey = () => { setHidden(NO_HIDDEN); setYears(null); setAgain(false); };
  const keyBody = { rows: faceted, hidden, onHidden, years, onYears: setYears, again, overlays, onOverlay: toggleOverlay };

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
  const ctlW = view === "map" && !mobile ? 38 + 8 : 0;   // the zoom and basemap buttons keep the right edge; the hole's panel sits left of them
  const panelW = !holeKey ? 0 : wide ? Math.max(560, Math.min(1180, vw - chatW - ctlW - 60 - 24)) : 420;

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-50 text-slate-900">
      <div className="absolute inset-0 z-0"><CoreMap holes={drawn} basemap={basemap} colour={colour} card={(h) => holeCard(h, colour(h), typeName, "Target")} selected={selected} ringKm={ringKm} overlays={overlays} onSelect={(k) => set({ hole: k, m: null, full: null })}
        padRight={mobile ? 0 : panelW + chatW + ctlW} padLeft={!mobile && view === "map" && holes.length > 0 && !keyFolded ? PANEL_W + 22 : 6} padBottom={mobile && holeKey ? Math.round(vh * 0.56) : 0} apiRef={mapApi} /></div>

      {/* the key: a single column down the left edge; every row can be shown alone or hidden, and every count
          follows what the other sections let through */}
      {view === "map" && holes.length > 0 && !mobile && (
        <MapKey {...keyBody} shown={drawn.filter((h) => h.status === "ready").length} waiting={waitingN} folded={keyFolded} onFold={setKeyFolded} onReset={resetKey} />
      )}

      {/* zoom, and under it the basemap behind a layers button, at the right edge whether or not a hole is open; on a
          phone the map is pinched and the basemap lives in the key's sheet */}
      {view === "map" && !mobile && (
        <div className="absolute bottom-3 z-10 flex flex-col items-end gap-2" style={{ right: 12 + chatW }}>
          <div className={cn(glass, "flex flex-col overflow-hidden rounded-xl")} role="group" aria-label="Zoom">
            <button type="button" onClick={() => mapApi.current?.zoomIn()} aria-label="Zoom in" className="grid size-9 place-items-center text-slate-700 hover:bg-white hover:text-slate-900"><Plus size={15} /></button>
            <button type="button" onClick={() => mapApi.current?.zoomOut()} aria-label="Zoom out" className="grid size-9 place-items-center border-t border-slate-900/[0.08] text-slate-700 hover:bg-white hover:text-slate-900"><Minus size={15} /></button>
          </div>
          <div className="relative">
            <button type="button" onClick={() => setLayersOpen((o) => !o)} aria-label="Basemap" aria-expanded={layersOpen} data-tip="Basemap" data-tip-left=""
              className={cn(glass, "grid size-[38px] place-items-center rounded-xl text-slate-700 hover:bg-white hover:text-slate-900", layersOpen && "bg-white text-slate-900")}><Layers size={16} /></button>
            {layersOpen && <>
              <button type="button" aria-label="Close" onClick={() => setLayersOpen(false)} className="fixed inset-0 z-0 cursor-default" />
              <div role="radiogroup" aria-label="Basemap" className={cn(glass, "absolute right-[calc(100%+8px)] bottom-0 z-10 flex gap-2 bg-white/90 p-2")}>
                {BASEMAPS.map((b) => (
                  <button key={b.id} type="button" role="radio" aria-checked={basemap === b.id} onClick={() => { pickBasemap(b.id); setLayersOpen(false); }} className="group flex w-[92px] flex-col gap-1.5 text-left">
                    <span className={cn("relative block h-16 overflow-hidden rounded-lg ring-2 transition-shadow", basemap === b.id ? "ring-slate-900" : "ring-transparent group-hover:ring-slate-300")}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={b.thumb} alt="" className="size-full object-cover" />
                      {basemap === b.id && <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-slate-900 text-white"><Check size={11} /></span>}
                    </span>
                    <span className={cn("px-0.5 text-xs font-semibold", basemap === b.id ? "text-slate-900" : "text-slate-600")}>{b.label}</span>
                  </button>
                ))}
              </div>
            </>}
          </div>
        </div>
      )}
      {view === "map" && mobile && !holeKey && holes.length > 0 && (
        <LegendSheet basemaps={BASEMAPS} basemap={basemap} onBasemap={pickBasemap}
          dots={[...new Set(faceted.filter((f) => f.glyph && f.glyph !== "+").map((f) => f.color))]} label={keyOn ? `${drawn.filter((h) => h.status === "ready").length.toLocaleString()} of ${faceted.length.toLocaleString()} holes` : "Target commodity"}>
          <MapKeyBody {...keyBody} />
          {keyOn && <p className="flex justify-end px-2 pt-1 pb-2"><button type="button" onClick={resetKey} className="text-xs font-semibold text-slate-900">Show every hole</button></p>}
        </LegendSheet>
      )}

      {touring && <Tour steps={tour} onClose={() => setTouring(false)} />}

      {/* top bar: brand left, session right */}
      <div className="pointer-events-none absolute top-0 left-0 z-20 flex items-start justify-between gap-2 p-3 sm:gap-3" style={{ right: chatW }}>
        {/* on a phone the mark alone, as a round button; on a wide screen the mark and the name in a pill */}
        <Link href={base || "/"} aria-label="Core Flagging home" className="pointer-events-auto flex-none rounded-full shadow-glass sm:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/coretrace-mark.svg" alt="Core Flagging" className="size-11 rounded-full ring-1 ring-white/60" />
        </Link>
        <Link href={base || "/"} className={cn(glass, "pointer-events-auto hidden h-11 flex-none items-center gap-2 rounded-full pr-4 pl-1.5 font-display text-sm font-bold tracking-tight text-ink sm:flex")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/coretrace-mark.svg" alt="" className="size-8 rounded-full" />CORE FLAGGING
        </Link>
        <div className="pointer-events-auto mr-auto flex min-w-0 items-center gap-2">
          <div data-tour="tabs" className={cn(glass, "flex h-11 items-center gap-0.5 rounded-full p-1")} role="tablist" aria-label="View">
            {(["map", "holes"] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => set({ view: id === "map" ? null : id })}
                className={cn("flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-semibold transition-colors sm:px-4", view === id ? "bg-ink text-white" : "text-slate-600 hover:text-slate-900")}>
                {id === "map" ? "Map" : "Table"}
              </button>
            ))}
          </div>
          {/* "worth a second look": one switch for the map and the table, beside the tabs, so it holds across both. At rest
              it is the magnifier alone; hovering slides out its name and count; switched on it stays open, in ink */}
          {againN > 0 && (
            <button type="button" role="switch" aria-checked={again} onClick={() => setAgain((a) => !a)} aria-label="Worth a second look"
              className={cn("group flex h-11 items-center rounded-full border px-[13px] text-sm font-semibold whitespace-nowrap shadow-glass backdrop-blur-xl transition-colors duration-300",
                again ? "border-ink bg-ink text-white" : "border-white/60 bg-white/80 text-slate-700 hover:bg-white hover:text-slate-900")}>
              <ScanSearch size={16} className={cn("flex-none transition-colors", again ? "text-cyan" : "text-slate-600 group-hover:text-slate-900")} />
              <span className={cn("flex items-center gap-2 overflow-hidden transition-[max-width,opacity,margin] duration-300 ease-out",
                again ? "ml-2 max-w-60 opacity-100" : "ml-0 max-w-0 opacity-0 group-hover:ml-2 group-hover:max-w-60 group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-60 group-focus-visible:opacity-100")}>
                {!mobile && <span>Worth a second look</span>}
                <span className={cn("rounded-full px-1.5 font-mono text-[10px] font-medium", again ? "bg-white/20" : "bg-slate-200/70")}>{againN.toLocaleString()}</span>
              </span>
            </button>
          )}
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          {!mobile && <button type="button" onClick={() => { set({ view: null, hole: null }); setTouring(true); }} aria-label="Show the guided tour" title="Show the guided tour" className={cn(glass, "grid size-11 place-items-center rounded-full text-slate-600 hover:bg-white hover:text-slate-900")}><HelpCircle size={18} /></button>}
          {!chatOpen && <button type="button" onClick={() => setChatOpen(true)} aria-label="Ask about the core" className={cn(glass, "flex h-11 items-center gap-2 rounded-full px-3.5 text-sm font-semibold text-slate-800 hover:bg-white sm:px-4")}><MessageCircle size={15} /><span className="hidden sm:inline">Ask</span></button>}
          <button type="button" data-tour="upload" onClick={openUpload} aria-label="Upload a scan" className={cn(glass, "flex h-11 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold text-slate-800 hover:bg-white hover:text-slate-900 sm:px-4")}><Upload size={15} />{!mobile && <span>{barW >= 1120 ? "Upload a scan" : "Upload"}</span>}</button>
          {authed ? <div className={cn(glass, "grid h-11 place-items-center rounded-full px-1.5")}><AccountMenu /></div>
            : <button type="button" onClick={toSignIn} className={cn(glass, "h-11 whitespace-nowrap rounded-full px-3 text-sm font-medium text-slate-700 hover:bg-white sm:px-4")}>Sign in</button>}
        </div>
      </div>

      {/* the holes tab: every hole on the map as a table */}
      {view === "holes" && (
        <div className={cn(glass, "absolute top-[68px] bottom-3 left-3 z-20 overflow-hidden bg-white/92")} style={{ right: chatW + 12 }}>
          <HoleTable holes={list} q={q} onQ={setQ} look={colour} typeName={typeName} loading={hq.isLoading} sheet={{ state: "", q }} onOpen={(k) => set({ hole: k, m: null, full: null, view: null })}
            onAsk={chatOpen ? undefined : () => setChatOpen(true)} />
        </div>
      )}

      {/* the hole: a panel at the right on a wide screen, a bottom sheet on a phone */}
      {holeKey && !mobile && (
        <aside className="absolute z-30 overflow-hidden rounded-2xl border border-white/60 bg-white/90 shadow-glass backdrop-blur-xl" style={{ top: 68, bottom: 12, width: panelW, right: chatW + ctlW + 12 }}>
          <HolePanel key={holeKey} holeKey={holeKey} tab={tab} onTab={(t) => set({ tab: t === "metre" ? null : t })} models={models} run={run} metre={metre} onMetre={(m) => set({ m: m === null ? null : String(m) })}
            wide={wide} onWide={(w) => set({ full: w ? "1" : null })} onClose={() => set({ hole: null, m: null, full: null, tab: null, w: null })} win={win} onWindow={(r) => set({ w: r ? `${r[0]}-${r[1]}` : null, full: r ? "1" : null, tab: r ? "window" : null })}
            onOpenHole={(k, m) => set({ hole: k, m: m === undefined ? null : String(m), full: "1" })}
            onDeleted={() => set({ hole: null, m: null, full: null })} onRing={setRingKm} />
        </aside>
      )}
      {holeKey && mobile && (
        <HoleSheet full={wide || sheetFull} onFull={(f) => { setSheetFull(f); if (!f && wide) set({ full: null }); }} onClose={() => set({ hole: null, m: null, full: null, tab: null })}>
          <HolePanel key={holeKey} holeKey={holeKey} tab={tab} onTab={(t) => set({ tab: t === "metre" ? null : t })} models={models} run={run} metre={metre} onMetre={(m) => set({ m: m === null ? null : String(m) })}
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
        onQueued={(h) => { setUpload(false); qc.invalidateQueries({ queryKey: ["core-holes"] }); set({ hole: h.key, m: null, full: null }); }} />
      <EmailGate open={gate} onClose={() => setGate(false)} onAuthed={() => { setGate(false); setAuthed(true); }} />
      <VerifyEmailDialog open={verify} onClose={() => setVerify(false)} onVerified={() => { setVerify(false); setUpload(true); }} />
    </div>
  );
}
