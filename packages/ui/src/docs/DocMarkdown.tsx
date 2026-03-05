import { getBrainServices, type IBrainTileDef } from "@mindcraft-lang/core/brain";
import Markdown, { type Components } from "react-markdown";
import { BrainCodeBlock } from "./BrainCodeBlock";
import { InlineTileIcon } from "./DocsRule";
import { useDocsSidebar } from "./DocsSidebarContext";

// ---------------------------------------------------------------------------
// InlineTileLink -- wraps InlineTileIcon with click-to-navigate behavior.
// Rendered as a component so it can use the sidebar context hook.
// ---------------------------------------------------------------------------

function InlineTileLink({ tileId, tileDef }: { tileId: string; tileDef: IBrainTileDef }) {
  const { registry, navigateToEntry } = useDocsSidebar();
  const hasDocPage = registry.tiles.has(tileId);

  if (!hasDocPage) {
    return <InlineTileIcon tileDef={tileDef} />;
  }

  return (
    <button
      type="button"
      onClick={() => navigateToEntry("tiles", tileId)}
      className="inline cursor-pointer hover:brightness-125 transition-[filter]"
      title={`View docs for ${tileDef.visual?.label ?? tileId}`}
    >
      <InlineTileIcon tileDef={tileDef} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stable components map -- defined at module level so the object reference
// never changes between renders. react-markdown uses component references
// to determine whether to remount subtrees; inline definitions would create
// new references on every render and destroy text selections.
// ---------------------------------------------------------------------------

const MD_COMPONENTS: Components = {
  // Strip the <pre> wrapper so BrainCodeBlock controls its own container.
  pre({ children: preChildren }) {
    return <>{preChildren}</>;
  },

  code({ className, children }) {
    const lang = (className ?? "").replace("language-", "");

    // Block brain fence
    if (lang === "brain") {
      return <BrainCodeBlock content={String(children).trimEnd()} />;
    }

    // Inline code: `tile:sensor.see` -> inline tile chip
    if (!className) {
      const text = String(children);
      if (text.startsWith("tile:")) {
        const tileId = text.slice(5);
        const tileDef = getBrainServices().tiles.get(tileId);
        if (tileDef) {
          return <InlineTileLink tileId={tileId} tileDef={tileDef} />;
        }
        // Unknown tile -- render as plain code
        return <code className="bg-slate-800 text-amber-400 px-1 rounded text-xs font-mono">{tileId}</code>;
      }
    }

    return <code className="bg-slate-800 text-green-400 px-1 rounded text-xs font-mono">{children}</code>;
  },

  // Headings
  h1({ children: h }) {
    return <h1 className="text-base font-bold text-slate-100 mt-4 mb-2 first:mt-0">{h}</h1>;
  },
  h2({ children: h }) {
    return <h2 className="text-sm font-semibold text-slate-200 mt-3 mb-1.5 border-b border-slate-700 pb-1">{h}</h2>;
  },
  h3({ children: h }) {
    return <h3 className="text-sm font-medium text-slate-300 mt-2 mb-1">{h}</h3>;
  },

  // Block elements
  p({ children: p }) {
    return <p className="text-sm text-slate-300 leading-relaxed mb-2">{p}</p>;
  },
  ul({ children: ul }) {
    return <ul className="list-disc list-inside text-sm text-slate-300 mb-2 space-y-0.5 pl-2">{ul}</ul>;
  },
  ol({ children: ol }) {
    return <ol className="list-decimal list-inside text-sm text-slate-300 mb-2 space-y-0.5 pl-2">{ol}</ol>;
  },
  li({ children: li }) {
    return <li className="leading-relaxed">{li}</li>;
  },
  blockquote({ children: bq }) {
    return (
      <blockquote className="border-l-2 border-slate-600 pl-3 my-2 text-sm text-slate-400 italic">{bq}</blockquote>
    );
  },
  strong({ children: s }) {
    return <strong className="font-semibold text-slate-200">{s}</strong>;
  },
  em({ children: e }) {
    return <em className="italic text-slate-400">{e}</em>;
  },
  hr() {
    return <hr className="border-slate-700 my-3" />;
  },
};

// ---------------------------------------------------------------------------
// DocMarkdown -- renders a markdown string with brain-fence and tile-ref support
// ---------------------------------------------------------------------------

interface DocMarkdownProps {
  children: string;
}

export function DocMarkdown({ children }: DocMarkdownProps) {
  return <Markdown components={MD_COMPONENTS}>{children}</Markdown>;
}
