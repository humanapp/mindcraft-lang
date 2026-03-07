import { getBrainServices, type IBrainTileDef } from "@mindcraft-lang/core/brain";
import type { Element } from "hast";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrainCodeBlock } from "./BrainCodeBlock";
import { InlineTileIcon } from "./DocsRule";
import { useDocsSidebar } from "./DocsSidebarContext";

// ---------------------------------------------------------------------------
// Tag pill helpers
// ---------------------------------------------------------------------------

interface TagSpec {
  label: string;
  color: string;
}

const TAG_DEFAULT_COLOR = "#64748b";

function parseTagSpec(text: string): TagSpec | null {
  const body = text.slice(4); // strip "tag:"
  if (!body) return null;
  const parts = body.split(";");
  const label = parts[0].trim();
  if (!label) return null;
  let color = TAG_DEFAULT_COLOR;
  for (let i = 1; i < parts.length; i++) {
    const colonIdx = parts[i].indexOf(":");
    if (colonIdx !== -1) {
      const key = parts[i].slice(0, colonIdx).trim();
      const val = parts[i].slice(colonIdx + 1).trim();
      if (key === "color" && /^#[0-9a-f]{6}$/i.test(val)) {
        color = val;
      }
    }
  }
  return { label, color };
}

function tagTextColor(bgHex: string): string {
  const r = Number.parseInt(bgHex.slice(1, 3), 16);
  const g = Number.parseInt(bgHex.slice(3, 5), 16);
  const b = Number.parseInt(bgHex.slice(5, 7), 16);
  // W3C perceived brightness formula
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128 ? "#000000" : "#ffffff";
}

function InlineTagPill({ label, color }: TagSpec) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold align-middle"
      style={{ backgroundColor: color, color: tagTextColor(color) }}
    >
      {label}
    </span>
  );
}

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
      className="inline-flex shrink-0 cursor-pointer hover:brightness-125 transition-[filter]"
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

  code({ className, children, node }) {
    const lang = (className ?? "").replace("language-", "");

    // Block brain fence -- extract meta string from HAST node (e.g., ```brain noframe)
    if (lang === "brain") {
      const meta = ((node as Element | undefined)?.data as { meta?: string } | undefined)?.meta ?? "";
      return <BrainCodeBlock content={String(children).trimEnd()} meta={meta} />;
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
      if (text.startsWith("tag:")) {
        const spec = parseTagSpec(text);
        if (spec) {
          return <InlineTagPill label={spec.label} color={spec.color} />;
        }
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

  // Table elements
  table({ children: t }) {
    return (
      <div className="overflow-x-auto my-3">
        <table className="w-full text-sm border-collapse">{t}</table>
      </div>
    );
  },
  thead({ children: t }) {
    return <thead className="border-b border-slate-600">{t}</thead>;
  },
  tbody({ children: t }) {
    return <tbody>{t}</tbody>;
  },
  tr({ children: t }) {
    return <tr className="border-b border-slate-700/50 last:border-0">{t}</tr>;
  },
  th({ children: t }) {
    return <th className="text-left text-slate-300 font-semibold px-2 py-1.5">{t}</th>;
  },
  td({ children: t }) {
    return <td className="text-slate-300 px-2 py-1.5 align-top">{t}</td>;
  },
};

// ---------------------------------------------------------------------------
// DocMarkdown -- renders a markdown string with brain-fence and tile-ref support
// ---------------------------------------------------------------------------

interface DocMarkdownProps {
  children: string;
}

export function DocMarkdown({ children }: DocMarkdownProps) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
      {children}
    </Markdown>
  );
}
