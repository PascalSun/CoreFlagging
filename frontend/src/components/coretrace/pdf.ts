// A report as a PDF file: the report as it is laid out on screen, rendered to an image and cut
// into A4 pages between rows and paragraphs, never through them.

// a page may end after any of these; a heading is left out so it is never stranded at a page foot
const BREAKS = "header, section, p, tr, li, figure, table, dl, [data-keep]";

export async function downloadReportPdf(node: HTMLElement, filename: string, footer: string): Promise<void> {
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
  // rendered at the page's own size even when it is shown scaled down on screen
  const canvas = await toCanvas(node, { pixelRatio: 2.5, backgroundColor: "#ffffff", cacheBust: true, style: { transform: "none" } });
  // measured on screen, where the page may be shown scaled down; the canvas is at full size
  const box = node.getBoundingClientRect(); const ratio = canvas.height / box.height;
  // places a page may end: the bottom of each block, in canvas pixels. Nothing inside a block marked
  // data-keep may end a page, and a section's intro (data-nobreak) stays with what it introduces.
  const ends = [...node.querySelectorAll<HTMLElement>(BREAKS)]
    .filter((e) => !e.parentElement?.closest("[data-keep]") && !e.hasAttribute("data-nobreak"))
    .map((e) => Math.round((e.getBoundingClientRect().bottom - box.top) * ratio))
    .filter((y) => y > 0).sort((a, b) => a - b);

  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  // the document carries its own side margins; the PDF adds only top and bottom
  const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight(), margin = 0, vmargin = 34, foot = 18;
  const w = pw - 2 * margin, scale = w / canvas.width;
  // the first page starts at the paper's top edge (the document has its own top padding); later pages get a margin
  const room = (first: boolean) => Math.floor((ph - (first ? 0 : vmargin) - vmargin - foot) / scale);
  const pages: [number, number][] = [];
  for (let y = 0; y < canvas.height; ) {
    const pageH = room(pages.length === 0);
    let end = Math.min(y + pageH, canvas.height);
    if (end < canvas.height) {
      const fit = ends.filter((e) => e > y + pageH * 0.5 && e <= end);
      if (fit.length) end = fit[fit.length - 1] + 2;
    }
    pages.push([y, end]); y = end;
  }
  // every link in the document keeps working in the PDF: an invisible link box over where it was drawn
  const links = [...node.querySelectorAll<HTMLAnchorElement>("a[href^='http']")].map((a) => {
    const r = a.getBoundingClientRect();
    return { url: a.href, x: (r.left - box.left) * ratio, y: (r.top - box.top) * ratio, w: r.width * ratio, h: r.height * ratio };
  }).filter((l) => l.w > 0 && l.h > 0);
  const slice = document.createElement("canvas"); const g = slice.getContext("2d")!;
  pages.forEach(([a, b], i) => {
    slice.width = canvas.width; slice.height = b - a;
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, slice.width, slice.height); g.drawImage(canvas, 0, a, canvas.width, b - a, 0, 0, canvas.width, b - a);
    if (i) pdf.addPage();
    const top = i ? vmargin : 0;
    pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", margin, top, w, (b - a) * scale);
    for (const l of links) {
      if (l.y + l.h / 2 < a || l.y + l.h / 2 >= b) continue;
      pdf.link(margin + l.x * scale, top + (l.y - a) * scale, l.w * scale, l.h * scale, { url: l.url });
    }
    pdf.setFontSize(7.5); pdf.setTextColor(140);
    pdf.text(footer, 36, ph - 20); pdf.text(`${i + 1} / ${pages.length}`, pw - 36, ph - 20, { align: "right" });
  });
  pdf.save(filename);
}
