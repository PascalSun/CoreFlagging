import type { Components } from "streamdown";

// Streamdown wraps tables in several nested bordered boxes (+ a copy/download toolbar). Override the
// table renderers with a single, clean table — no outer frame, just a header underline + row rules.
export const MD_COMPONENTS: Partial<Components> = {
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => (
    <th className="border-b border-slate-300 px-2 py-1.5 text-left align-bottom font-semibold text-slate-700">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-slate-100 px-2 py-1.5 align-top text-slate-600">{children}</td>
  ),
};
