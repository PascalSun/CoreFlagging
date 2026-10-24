import type { TourId, TourStep } from "@/components/coretrace/Tour";

// The tours of the data views, one per view, each shown once per browser the first time the view is used on a wide
// screen (the map's own tour is in CoreTraceMap). Short: a few steps, each lighting a real data-tour mark and saying what
// can be done there; one step per tour is the assistant, asked something that view raises.

/** The element a view's tour waits for before it opens: that view drawn with its data, not still loading. */
export const TOUR_READY: Record<Exclude<TourId, "map">, string> = {
  hole: "full-log", log: "strip", table: "table-search", compare: "compare-show", scene: "scene-title",
};

/** The assistant's step: the open chat when it is open, else the "Ask" button that opens it. */
const ask = (chatOpen: boolean, title: string, body: string): TourStep => ({ target: chatOpen ? "chat" : "ask", title, body });

export function viewTour(id: Exclude<TourId, "map">, { chatOpen }: { chatOpen: boolean }): TourStep[] {
  switch (id) {
    case "hole": return [
      { target: "trays", optional: true, title: "The core, tray by tray", body: "Every core tray photographed, top to bottom. The lit tray holds the metre the model finds most unusual; click any tray to see it full screen." },
      { target: "found", optional: true, title: "Where to look again", body: "Where the model's reading disagrees with the company's log, and the metres that stand out from the core around them. \u201cSee them under Unusual\u201d opens them on the log." },
      { target: "hole-docs", optional: true, title: "Read the hole's reports", body: "Open the hole's HyLogger PDFs and the exploration report it was logged in, with its abstract, or the other reports covering its ground." },
      { target: "full-log", title: "Go metre by metre", body: "Open the full log to zoom from the whole hole down to 10 cm, find similar core across the State, or print a report." },
      ask(chatOpen, "Ask about this hole", "The assistant knows this hole is open. Ask \u201cwhat is unusual between 120 and 140 m?\u201d or \u201cwhat does the report say about the ore zone?\u201d and it links back to the depths."),
    ];
    case "log": return [
      { target: "strip", title: "Zoom down the hole", body: "Drag the box in the Scale column, or its ends, to go from the whole hole to 10 m, 1 m and 10 cm. Hover a column head for what it shows." },
      { target: "tab-window", title: "Read one metre", body: "Click a metre on the log: Window shows its tray photograph, its spectra against the core around it, and what the model read there." },
      { target: "tab-again", optional: true, title: "Jump to the unusual core", body: "Unusual lists where the model disagrees with the log and where the core stands out. Click a row to open that stretch on the log." },
      { target: "tab-similar", optional: true, title: "Find core like this", body: "Similar core looks for core like the stretch in view: in this hole, within 10 km, the region or the whole State. \u201cCompare\u201d sets two holes side by side." },
      ask(chatOpen, "Ask about a depth", "Ask \u201cwhy is 212 m flagged?\u201d or \u201cis there core like 150\u2013160 m nearby?\u201d. The assistant reads the same log and opens the depths it cites."),
    ];
    case "table": return [
      { target: "table-search", title: "Find a hole", body: "Type a hole, company, project or region, such as \u201cAgnew\u201d or \u201cGawler\u201d; Enter opens the first match. The map key's filters narrow this list too." },
      { target: "table-head", title: "Sort by what matters", body: "Click a column head to sort: by depth, gold assays, the metres worth a second look, or data issues." },
      { target: "second-look", optional: true, title: "Only holes worth a look", body: "Switch it on to keep only the holes where the model disagrees with the log, on the map and in the table alike." },
      { target: "table-export", optional: true, title: "Take the list away", body: "Download every interval where the model disagrees with the log, for the holes shown, as a CSV." },
      ask(chatOpen, "Ask for holes", "Ask \u201cgold holes in NSW deeper than 300 m\u201d: the assistant searches the same holes and opens the ones it names on the map."),
    ];
    case "compare": return [
      { target: "compare-a", title: "Two logs side by side", body: "Each hole has its own Scale column: drag it to zoom one log without the other. Click a hole's name to open it on its own." },
      { target: "compare-mid", title: "Read the match", body: "Each metre on the left is linked to the metre on the right most like it, by the model's 2 m fingerprints. The higher the score, the more alike; \u03c1 near 1, the same order down the hole." },
      { target: "compare-show", optional: true, title: "Change the middle column", body: "Set the column beside RC to SWIR, TIR, Unusual or BD, to check a match against what the scanner measured." },
      ask(chatOpen, "Ask why they match", "Ask \u201cwhy does 150 m on the left match the right hole?\u201d: the assistant reads both holes' logs and reports."),
    ];
    case "scene": return [
      { target: "scene-title", title: "This hole and its neighbours", body: "Drawn along their surveyed paths at true scale. Drag to turn, scroll to zoom, and click a point to open that depth on the map." },
      { target: "scene-view", title: "Slice a cross-section", body: "Section cuts a vertical slice through this collar, as a geologist draws one. Turn its line with the dial; a wider corridor takes in more holes." },
      { target: "scene-paint", optional: true, title: "Colour by rock or mineral", body: "The rock the company geologist logged, in GSWA's map colours, or the SWIR or TIR mineral group the scanner read most of in each 10 cm." },
      { target: "scene-back", title: "Ask about what you see", body: "Orange marks where the model disagrees with the log, violet core that stands out. Back on the map, ask the assistant \u201cwhat is the violet stretch at 300 m?\u201d." },
    ];
  }
}
