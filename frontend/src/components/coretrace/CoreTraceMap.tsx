"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, HelpCircle, Layers, LogIn, MessageCircle, Minus, MoreHorizontal, Plus, ScanSearch, Upload, X } from "lucide-react";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { EmailGate } from "@ntlp/geodata-web/email-gate";
import { VerifyEmailDialog } from "@/components/auth/VerifyEmailDialog";
import { CoreChat, type OpenTarget } from "@/components/coretrace/CoreChat";
import { BASEMAPS, CoreMap, type Basemap, type MapApi } from "@/components/coretrace/CoreMap";
import { HolePanel } from "@/components/coretrace/HolePanel";
import { UploadDialog } from "@/components/coretrace/UploadDialog";
import { isAuthed, isVerified } from "@/lib/auth";
import { ACTIVE, coreScan } from "@/lib/coreScan";
import { classify, shapeOf } from "@/components/coretrace/mapColour";
import { ComparePanel } from "@/components/coretrace/Compare";
import { KeyTips, MapKey, MapKeyBody, NO_HIDDEN, PANEL_W, facet, filtering, passes, type Facet, type Hidden } from "@/components/coretrace/MapKey";
import { HoleTable } from "@/components/coretrace/HoleTable";
import { holeCard } from "@/components/coretrace/mapCard";
import { Tour, tourSeen, useViewTour, type TourId, type TourStep } from "@/components/coretrace/Tour";
import { TOUR_READY, viewTour } from "@/components/coretrace/tours";
import { LegendSheet } from "@/components/coretrace/LegendSheet";
import { HoleSheet } from "@/components/coretrace/HoleSheet";
import { coretraceBase } from "@/lib/sites";
import { useIsMobile } from "@/lib/useIsMobile";
import { cn } from "@/lib/utils";

const glass = "rounded-2xl border border-white/60 bg-white/80 shadow-glass backdrop-blur-xl";

/** "230-240" from the address as a depth window, or null. */
function parseWin(w: string | null): [number, number] | null {
  if (!w) return null; const [a, b] = w.split("-").map(Number);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : null;
}

/** The CoreFlagging map: every scanned hole in the State, and the way into any one of them.
 * What is open lives in the address (?hole=&m=&model=&full=1), so a view can be shared. */
export function CoreTraceMap() {
  const pathname = usePathname(); const urlSp = useSearchParams(); const qc = useQueryClient();
  // What is open: the query string, with the changes not yet written to it laid over it (see set below). Readers
  // use sp.get as before.
  const [over, setOver] = useState<Record<string, string | null>>({});
  const sp = useMemo(() => {
    const p = new URLSearchParams(urlSp.toString());
    for (const [k, v] of Object.entries(over)) { if (v === null) p.delete(k); else p.set(k, v); }
    return p;
  }, [urlSp, over]);
  // once the address bar holds a change, it no longer needs laying over
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setOver((o) => { const n = Object.fromEntries(Object.entries(o).filter(([k, v]) => (urlSp.get(k) ?? null) !== v)); return Object.keys(n).length === Object.keys(o).length ? o : n; }); }, [urlSp]);
  const mobile = useIsMobile(); const base = coretraceBase(pathname);
  const holeKey = sp.get("hole"); const wide = sp.get("full") === "1";
  // a second hole to compare the open one with (?cmp=), in a panel over the map
  const cmp = sp.get("cmp"); const comparing = !!holeKey && !!cmp;
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
  // a phone's top bar: the brand, Map/Table, Ask and one menu with the rest (upload, second look, sign in)
  const [menu, setMenu] = useState(false);
  const [authed, setAuthed] = useState(false);
  // the session lives in localStorage, which the server render cannot see
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setAuthed(isAuthed()); }, []);

  // What is open lives in the query string, changed in place with the browser's own history (Next keeps
  // useSearchParams in step). Not router.replace: on CoreFlagging's own host /map is a rewrite of /coretrace/map,
  // and the router took a query-only change there for the same page and kept the old query, so a hole could
  // not be closed. The path is the one in the address bar for the same reason.
  // The page follows a change at once (it is laid over the query string); the address bar follows at most every
  // 250 ms. Dragging the depth navigator changes the window on every pointer move, and Safari throws once a page calls
  // history.replaceState more than 100 times in 10 seconds, which took the whole app down on a phone.
  const pending = useRef<Record<string, string | null>>({});
  const flushAt = useRef<number | null>(null); const lastWrite = useRef(0);
  const flush = () => {
    flushAt.current = null; lastWrite.current = Date.now();
    const p = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(pending.current)) { if (v === null) p.delete(k); else p.set(k, v); }
    pending.current = {};
    const s = p.toString();
    try { window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`); } catch { /* refused by the browser: the page state still holds it */ }
  };
  const set = (patch: Record<string, string | null>) => {
    pending.current = { ...pending.current, ...patch };
    setOver((o) => ({ ...o, ...patch }));
    const wait = 250 - (Date.now() - lastWrite.current);
    if (wait <= 0 && flushAt.current === null) flush();
    else if (flushAt.current === null) flushAt.current = window.setTimeout(flush, Math.max(0, wait));
  };
  useEffect(() => () => { if (flushAt.current !== null) window.clearTimeout(flushAt.current); }, []);

  const mq = useQuery({ queryKey: ["core-models"], queryFn: coreScan.models, staleTime: 10 * 60_000 });
  const models = useMemo(() => mq.data ?? [], [mq.data]);
  const run = sp.get("model") || models.find((m) => m.default)?.run || models[0]?.run || "";
  // the list is kept a minute: moving between the map, a hole and the list must not fetch six thousand rows again
  const hq = useQuery({ queryKey: ["core-holes", authed], queryFn: coreScan.holes, staleTime: 60_000, refetchInterval: (qq) => (qq.state.data?.holes.some((h) => h.mine && ACTIVE.includes(h.status)) ? 4000 : false), refetchIntervalInBackground: true });
  const holes = useMemo(() => hq.data?.holes ?? [], [hq.data]);
  const typeName = useMemo(() => new Map((hq.data?.core_types ?? []).map((c) => [c.k, c.name])), [hq.data]);
  const tab = sp.get("tab") || "window";
  /** The assistant names holes as readers do; find the one it means and open it. */
  const openFromChat = (t: OpenTarget): boolean => {
    const n = t.hole.trim().toLowerCase();
    const h = holes.find((x) => x.key.toLowerCase() === n || x.name.toLowerCase() === n) ?? holes.find((x) => x.name.toLowerCase().replace(/[^a-z0-9]/g, "") === n.replace(/[^a-z0-9]/g, ""));
    if (!h) return false;
    // a metre (with no other tab) opens in the Window tab at 1 m, where This metre used to be
    const atMetre = t.m !== undefined && (!t.tab || t.tab === "metre");
    set({ hole: h.key, m: t.m === undefined ? null : String(t.m), full: h.status === "ready" && (t.m !== undefined || t.tab) ? "1" : null, tab: t.tab && t.tab !== "metre" ? t.tab : null,
      w: atMetre && t.m !== undefined ? `${t.m}-${t.m + 1}` : null, view: null });   // the hole is shown on the map, whichever tab was open
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
  // what the hole was drilled for by default: the question an explorer asks first; rock class and "look again" are views to switch to
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
  const [touring, setTouring] = useState<TourId | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!mobile && !holeKey && hq.data && !tourSeen()) setTouring("map"); }, [hq.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the view in use, whose own tour opens the first time it is used (a hole, its full log, the table, two holes compared);
  // the "?" in the top bar replays the tour of what is on screen, the map's when nothing else is open
  const here: Exclude<TourId, "map"> | null = comparing ? "compare" : holeKey ? (wide ? "log" : "hole") : view === "holes" ? "table" : null;
  useViewTour(mobile ? null : here, here ? TOUR_READY[here] : undefined, setTouring);
  // the tour's demo: open a gold hole with core worth a second look (the most gold logged), as a click on it would
  const demoHole = () => {
    const ready = holes.filter((h) => h.status === "ready" && h.lat !== null);
    const pick = ready.filter((h) => h.n_again > 0).sort((a, b) => b.au_pos_m - a.au_pos_m)[0] ?? ready[0];
    if (pick) set({ hole: pick.key, m: null, full: null, view: null });
  };
  const tour: TourStep[] = [
    { title: "Welcome to CoreFlagging", body: `Every HyLogger-scanned drillhole in Australia's core libraries, ${holes.length ? holes.length.toLocaleString() + " of them, " : ""}read metre by metre by a model trained on scanned drill core. A few quick steps.` },
    { target: "legend", title: "Each point is a drillhole", body: "Colour is what the hole was drilled for \u2014 gold, copper, nickel\u2026 from the survey's record of the hole in WA, SA and Victoria, from its exploration report or the nearest known deposit elsewhere (a hatched fill). A square is a scan the models could not read. Hover a row in the key to show only those holes or hide them, by rock class, commodity, source or model reading; every count follows what is shown." },
    { target: "tabs", title: "Map, or every hole as a table", body: "The Table tab lists every hole: search by name, company or region and sort by depth or gold. The map key on the left decides which holes the map draws." },
    // the tour opens a real hole rather than describing one: a gold hole with core worth a second look
    { title: "Open any hole", body: "Click a point for its strip log, its tray photographs and what the model reads at each metre. Next opens one for you: a gold hole with core worth a second look." },
    { target: "trays", optional: true, later: "full-log", act: "hole", title: "The core, tray by tray", body: "Every core tray photographed, top to bottom. The lit tray holds the metre the model finds most unusual; click any tray to see it full screen." },
    { target: "found", optional: true, later: "full-log", title: "Where to look again", body: "Where the model's reading disagrees with the company's log, and the metres that stand out from the core around them." },
    { target: "hole-docs", optional: true, later: "full-log", title: "Read the hole's reports", body: "The hole's HyLogger PDFs, and the exploration report it was logged in, with its abstract." },
    { target: "full-log", later: "full-log", title: "Go metre by metre", body: "The full log zooms from the whole hole down to 10 cm, finds similar core across the State, and prints a report. Next opens it." },
    // and the tour opens it: the log's own tour, walked on the same hole
    { target: "strip", later: "strip", click: "full-log", title: "Zoom down the hole", body: "Drag the box in the Scale column, or its ends, to go from the whole hole to 10 m, 1 m and 10 cm. Hover a column head for what it shows." },
    { target: "tab-window", optional: true, later: "strip", title: "Read one metre", body: "Click a metre on the log: Window shows its tray photograph, its spectra against the core around it, and what the model read there." },
    { target: "tab-again", optional: true, later: "strip", title: "Jump to the unusual core", body: "Unusual lists where the model disagrees with the log and where the core stands out. Click a row to open that stretch on the log." },
    { target: "tab-similar", optional: true, later: "strip", title: "Find core like this", body: "Similar core looks for core like the stretch in view: in this hole, within 10 km, the region or the whole State. \u201cCompare\u201d sets two holes side by side." },
    { target: chatOpen && !mobile ? "chat" : undefined, title: "Ask in plain words", body: "\u201cWhat is unusual between 120 and 140 m?\u201d about the hole you are on, or \u201choles with gold in NSW\u201d. The assistant is a language model with this site's own tools: it queries the same holes, reads their logs and the exploration reports behind them, and opens the holes it talks about on the map." },
    { target: chatOpen && !mobile ? "model" : undefined, title: "Cloud or Local", body: "Cloud is the default: a fast hosted model (Gemini), best at long answers with many tool calls. Local runs an open model (Qwen) on our own GPU, so your questions never leave our servers; it is slower, and the pill shows how many are ahead of you. Switch in the chat bar at any time; every answer is labelled with the model that wrote it." },
    { target: "upload", title: "Bring your own scan", body: "Upload a TSG package from a HyLogger: it gets the same checks, log and model reading as the library holes, and stays private to you." },
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
  const keyBody = { rows: faceted, hidden, onHidden, years, onYears: setYears, again };

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
  // the zoom and basemap buttons keep the right edge and the hole's panel sits left of them; the full log takes the
  // page's whole width, over the map and its buttons
  const ctlW = view === "map" && !mobile && !(holeKey && wide) && !comparing ? 38 + 8 : 0;
  const panelW = !holeKey ? 0 : wide ? vw - chatW - 24 : 420;

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-50 text-slate-900">
      {/* the map is pushed aside by the chat column, not covered by it */}
      <div className="absolute inset-y-0 left-0 z-0" style={{ right: chatW }}><CoreMap holes={drawn} basemap={basemap} colour={colour} card={(h) => holeCard(h, colour(h), typeName, "Target")} selected={selected} ringKm={ringKm} onSelect={(k) => set({ hole: k, m: null, full: null })}
        padRight={mobile ? 0 : panelW + ctlW} padLeft={!mobile && view === "map" && holes.length > 0 && !keyFolded ? PANEL_W + 22 : 6} padBottom={mobile && holeKey ? Math.round(vh * 0.56) : 0} apiRef={mapApi} /></div>

      {/* the key: a single column down the left edge; every row can be shown alone or hidden, and every count
          follows what the other sections let through */}
      {view === "map" && holes.length > 0 && !mobile && (
        <MapKey {...keyBody} shown={drawn.filter((h) => h.status === "ready").length} waiting={waitingN} folded={keyFolded} onFold={setKeyFolded} onReset={resetKey} />
      )}

      {/* zoom, and under it the basemap behind a layers button, at the right edge whether or not a hole is open; on a
          phone the map is pinched and the basemap lives in the key's sheet */}
      {view === "map" && !mobile && !(holeKey && wide) && !comparing && (
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

      {/* one bubble for every [data-keytip] on the page: the map key, the full log's column heads and key */}
      <KeyTips />
      {touring && <Tour key={touring} id={touring} steps={touring === "map" ? tour : viewTour(touring, { chatOpen })} onClose={() => setTouring(null)} onDemo={touring === "map" ? demoHole : undefined} />}

      {/* top bar: brand left, session right */}
      <div className="pointer-events-none absolute top-0 left-0 z-20 flex items-start justify-between gap-2 p-3 sm:gap-3" style={{ right: chatW }}>
        {/* on a phone the mark alone, as a round button; on a wide screen the mark and the name in a pill */}
        <Link href={base || "/"} aria-label="CoreFlagging home" className="pointer-events-auto flex-none rounded-full shadow-glass sm:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/coretrace-mark.svg" alt="CoreFlagging" className="size-11 rounded-full ring-1 ring-white/60" />
        </Link>
        <Link href={base || "/"} className={cn(glass, "pointer-events-auto hidden h-11 flex-none items-center gap-2 rounded-full pr-4 pl-1.5 font-display text-sm font-bold tracking-tight text-ink sm:flex")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/coretrace-mark.svg" alt="" className="size-8 rounded-full" />CoreFlagging
        </Link>
        {/* who it is made with, as on the landing page and with its links: the lab, the ARC training centre, the survey */}
        <div className={cn(glass, "pointer-events-auto hidden h-11 flex-none items-center gap-2.5 rounded-full px-2 lg:flex")}>
          <a href="https://nlp-tlp.org/" target="_blank" rel="noopener noreferrer" aria-label="UWA Centre for Natural and Technical Language Processing" title="UWA Centre for Natural and Technical Language Processing (NTLP)">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ntlp-logo.png" alt="" className="size-8 rounded-full" />
          </a>
          <span className="h-6 w-px bg-slate-900/15" aria-hidden />
          <a href="https://criticalresources.org.au/" target="_blank" rel="noopener noreferrer" aria-label="ARC Training Centre in Critical Resources for the Future" title="ARC Training Centre in Critical Resources for the Future">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/critical-resources-logo.svg" alt="" className="h-6 w-auto" />
          </a>
          <span className="h-6 w-px bg-slate-900/15" aria-hidden />
          <a href="https://www.dmirs.wa.gov.au/gswa" target="_blank" rel="noopener noreferrer" aria-label="Geological Survey of Western Australia, Department of Mines, Petroleum and Exploration" title="Geological Survey of Western Australia">
            {/* the seal on a white disc, as the NTLP mark is: its square white ground would show on the glass */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <span className="grid size-8 place-items-center rounded-full bg-white ring-1 ring-slate-900/10"><img src="/gswa-logo.png" alt="" className="size-[26px]" /></span>
          </a>
        </div>
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
          {againN > 0 && !mobile && (
            <button type="button" role="switch" data-tour="second-look" aria-checked={again} onClick={() => setAgain((a) => !a)} aria-label="Worth a second look"
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
        {mobile && (
          <div className="pointer-events-auto relative flex flex-none items-center gap-2">
            {!chatOpen && <button type="button" onClick={() => setChatOpen(true)} aria-label="Ask about the core" className={cn(glass, "grid size-11 place-items-center rounded-full text-slate-800")}><MessageCircle size={17} /></button>}
            {authed && <div className={cn(glass, "grid size-11 place-items-center rounded-full")}><AccountMenu /></div>}
            <button type="button" onClick={() => setMenu((m) => !m)} aria-label="More" aria-expanded={menu} className={cn(glass, "relative grid size-11 place-items-center rounded-full text-slate-800", menu && "bg-white")}>
              <MoreHorizontal size={18} />
              {again && <span className="absolute top-2 right-2 size-2 rounded-full bg-cyan ring-2 ring-white" aria-hidden />}
            </button>
            {menu && <>
              <button type="button" aria-label="Close the menu" onClick={() => setMenu(false)} className="fixed inset-0 z-0 cursor-default" />
              <div role="menu" className={cn(glass, "absolute top-[52px] right-0 z-10 w-72 overflow-hidden bg-white/95 p-1.5")}>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); openUpload(); }} className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-slate-800 active:bg-slate-100"><Upload size={16} className="text-slate-500" />Upload a scan</button>
                {againN > 0 && <button type="button" role="menuitemcheckbox" aria-checked={again} onClick={() => setAgain((a) => !a)} className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-slate-800 active:bg-slate-100">
                  <ScanSearch size={16} className={again ? "text-cyan" : "text-slate-500"} /><span className="whitespace-nowrap">Worth a second look</span>
                  <span className="ml-auto rounded-full bg-slate-200/70 px-1.5 font-mono text-[10px]">{againN.toLocaleString()}</span>
                  <span className={cn("relative h-5 w-9 flex-none rounded-full transition-colors", again ? "bg-ink" : "bg-slate-300")}><span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", again ? "left-[18px]" : "left-0.5")} /></span>
                </button>}
                {!authed && <>
                  <div className="my-1 h-px bg-slate-200" />
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); toSignIn(); }} className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-900 active:bg-slate-100"><LogIn size={16} className="text-slate-500" />Sign in</button>
                </>}
              </div>
            </>}
          </div>
        )}
        <div className={cn("pointer-events-auto flex items-center gap-2", mobile && "hidden")}>
          {!mobile && <button type="button" onClick={() => setTouring(here ?? "map")} aria-label="Show the guided tour" title="Show the guided tour" className={cn(glass, "grid size-11 place-items-center rounded-full text-slate-600 hover:bg-white hover:text-slate-900")}><HelpCircle size={18} /></button>}
          {!chatOpen && <button type="button" data-tour="ask" onClick={() => setChatOpen(true)} aria-label="Ask about the core" className={cn(glass, "flex h-11 items-center gap-2 rounded-full px-3.5 text-sm font-semibold text-slate-800 hover:bg-white sm:px-4")}><MessageCircle size={15} /><span className="hidden sm:inline">Ask</span></button>}
          <button type="button" data-tour="upload" onClick={openUpload} aria-label="Upload a scan" className={cn(glass, "flex h-11 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold text-slate-800 hover:bg-white hover:text-slate-900 sm:px-4")}><Upload size={15} />{!mobile && <span>{barW >= 1120 ? "Upload a scan" : "Upload"}</span>}</button>
          {authed ? <div className={cn(glass, "grid h-11 place-items-center rounded-full px-1.5")}><AccountMenu /></div>
            : <button type="button" onClick={toSignIn} className={cn(glass, "h-11 whitespace-nowrap rounded-full px-3 text-sm font-medium text-slate-700 hover:bg-white sm:px-4")}>Sign in</button>}
        </div>
      </div>

      {/* the holes tab: every hole on the map as a table */}
      {view === "holes" && (
        <div className={cn(glass, "absolute top-[68px] bottom-3 left-3 z-[32] overflow-hidden bg-white/92")} style={{ right: chatW + 12 }}>
          <HoleTable holes={list} q={q} onQ={setQ} look={colour} typeName={typeName} loading={hq.isLoading} sheet={{ state: "", q }} onOpen={(k) => set({ hole: k, m: null, full: null, view: null })}
            onAsk={chatOpen ? undefined : () => setChatOpen(true)} />
        </div>
      )}

      {/* the hole: a panel at the right on a wide screen, a bottom sheet on a phone */}
      {holeKey && !mobile && (
        <aside className="absolute z-30 overflow-hidden rounded-2xl border border-white/60 bg-white/90 shadow-glass backdrop-blur-xl" style={{ top: 68, bottom: 12, width: panelW, right: chatW + ctlW + 12 }}>
          <HolePanel key={holeKey} holeKey={holeKey} tab={tab} onTab={(t) => set({ tab: t === "window" ? null : t })} models={models} run={run} metre={metre} onMetre={(m) => set({ m: m === null ? null : String(m) })}
            wide={wide} onWide={(w) => set({ full: w ? "1" : null })} onClose={() => set({ hole: null, m: null, full: null, tab: null, w: null, cmp: null, wa: null, wb: null })} win={win} onWindow={(r) => set(r ? { w: `${r[0]}-${r[1]}`, full: "1", tab: "window" } : { w: null, tab: null })}
            onOpenHole={(k, m) => set({ hole: k, m: m === undefined ? null : String(m), full: "1" })}
            onDeleted={() => set({ hole: null, m: null, full: null })} onTour={mobile ? undefined : () => setTouring(wide ? "log" : "hole")} onRing={setRingKm} onCompare={(k, w) => set({ cmp: k, wa: w ? `${w.a[0]}-${w.a[1]}` : null, wb: w ? `${w.b[0]}-${w.b[1]}` : null })} />
        </aside>
      )}
      {holeKey && mobile && (
        <HoleSheet full={wide || sheetFull} onFull={(f) => { setSheetFull(f); if (!f && wide) set({ full: null }); }} onClose={() => set({ hole: null, m: null, full: null, tab: null, cmp: null })}>
          <HolePanel key={holeKey} holeKey={holeKey} tab={tab} onTab={(t) => set({ tab: t === "window" ? null : t })} models={models} run={run} metre={metre} onMetre={(m) => set({ m: m === null ? null : String(m) })}
            wide={wide} onWide={(w) => set({ full: w ? "1" : null })} onClose={() => set({ hole: null, m: null, full: null, tab: null, w: null, cmp: null, wa: null, wb: null })} win={win} onWindow={(r) => set(r ? { w: `${r[0]}-${r[1]}`, full: "1", tab: "window" } : { w: null, tab: null })}
            onOpenHole={(k, m) => set({ hole: k, m: m === undefined ? null : String(m), full: "1" })}
            onDeleted={() => set({ hole: null, m: null, full: null })} onTour={mobile ? undefined : () => setTouring(wide ? "log" : "hole")} onRing={setRingKm} onCompare={(k, w) => set({ cmp: k, wa: w ? `${w.a[0]}-${w.a[1]}` : null, wb: w ? `${w.b[0]}-${w.b[1]}` : null })} />
        </HoleSheet>
      )}

      {/* two holes side by side: as big as the full log, over the map and the hole's panel; closing it goes back to them */}
      {comparing && (
        <aside className={mobile ? "fixed inset-0 z-50 overflow-hidden bg-white" : "absolute z-[35] overflow-hidden rounded-2xl border border-white/60 bg-white/90 shadow-glass backdrop-blur-xl"}
          style={mobile ? undefined : { top: 68, bottom: 12, left: 12, right: chatW + 12 }}>
          <ComparePanel key={`${holeKey}|${cmp}`} a={holeKey!} b={cmp!} winA={parseWin(sp.get("wa"))} winB={parseWin(sp.get("wb"))} onClose={() => set({ cmp: null, wa: null, wb: null })}
            onOpenHole={(k) => set({ hole: k, cmp: null, wa: null, wb: null, m: null, w: null, tab: null })} />
        </aside>
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
