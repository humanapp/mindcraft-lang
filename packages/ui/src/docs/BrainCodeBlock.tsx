import { List } from "@mindcraft-lang/core";
import { getBrainServices, type IBrainTileDef } from "@mindcraft-lang/core/brain";
import { type CatalogTileJson, TileCatalog } from "@mindcraft-lang/core/brain/tiles";
import { ClipboardCopy } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { setClipboardFromJson } from "../brain-editor/rule-clipboard";
import { DocsRuleBlock, type DocsRuleData } from "./DocsRule";
import { useDocsSidebar } from "./DocsSidebarContext";

// ---------------------------------------------------------------------------
// Plain-JSON -> DocsRuleData conversion
// ---------------------------------------------------------------------------

interface PlainRule {
  version?: number;
  catalog?: CatalogTileJson[];
  when?: string[];
  do?: string[];
  children?: PlainRule[];
}

/** Clipboard wrapper format: { ruleJsons: [...], catalog: [...] } */
interface PlainRuleWrapper {
  ruleJsons: PlainRule[];
  catalog?: CatalogTileJson[];
}

interface ParsedBrainBlock {
  rules: PlainRule[];
  catalogEntries: CatalogTileJson[];
}

/**
 * Collect catalog entries from all rules and from the top-level wrapper.
 */
function collectCatalogEntries(rules: PlainRule[], topLevel?: CatalogTileJson[]): CatalogTileJson[] {
  const entries: CatalogTileJson[] = topLevel ? [...topLevel] : [];
  for (const rule of rules) {
    if (rule.catalog) {
      entries.push(...rule.catalog);
    }
  }
  return entries;
}

/**
 * Build a local TileCatalog from catalog JSON entries so that brain-local
 * tiles (variables, literals) can be resolved during rendering.
 */
function buildLocalCatalog(entries: CatalogTileJson[]): TileCatalog | undefined {
  if (entries.length === 0) return undefined;
  const catalog = new TileCatalog();
  catalog.deserializeJson(List.from(entries));
  return catalog;
}

function resolveTiles(tileIds: string[], localCatalog?: TileCatalog): IBrainTileDef[] {
  const globalCatalog = getBrainServices().tiles;
  return tileIds.map((id) => localCatalog?.get(id) ?? globalCatalog.get(id)).filter(Boolean) as IBrainTileDef[];
}

function convertRule(plain: PlainRule, localCatalog: TileCatalog | undefined, depth = 0): DocsRuleData {
  return {
    whenTiles: resolveTiles(plain.when ?? [], localCatalog),
    doTiles: resolveTiles(plain.do ?? [], localCatalog),
    depth,
    children: (plain.children ?? []).map((c) => convertRule(c, localCatalog, depth + 1)),
  };
}

/**
 * Parse the brain fence JSON. Accepts two formats:
 * - Array of rules: [{ when, do, catalog?, children? }]
 * - Clipboard wrapper: { ruleJsons: [...], catalog?: [...] }
 */
function parseBrainBlock(jsonStr: string): ParsedBrainBlock | null {
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      const rules = parsed as PlainRule[];
      return { rules, catalogEntries: collectCatalogEntries(rules) };
    }
    if (parsed && Array.isArray((parsed as PlainRuleWrapper).ruleJsons)) {
      const wrapper = parsed as PlainRuleWrapper;
      return { rules: wrapper.ruleJsons, catalogEntries: collectCatalogEntries(wrapper.ruleJsons, wrapper.catalog) };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// BrainCodeBlock component
// ---------------------------------------------------------------------------

interface BrainCodeBlockProps {
  /** Raw JSON string from inside the brain fence. */
  content: string;
}

export function BrainCodeBlock({ content }: BrainCodeBlockProps) {
  const { close } = useDocsSidebar();
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

  const rules = useMemo(() => {
    const block = parseBrainBlock(content);
    if (!block) return null;
    const localCatalog = buildLocalCatalog(block.catalogEntries);
    return block.rules.map((r) => convertRule(r, localCatalog));
  }, [content]);

  const handleInsert = () => {
    const block = parseBrainBlock(content);
    if (!block) return;
    setClipboardFromJson(block.rules, block.catalogEntries);
    const count = block.rules.length;
    toast.success(count === 1 ? "Example copied -- paste into a rule" : `${count} rules copied -- paste into a rule`);
    if (isMobile) {
      close();
    }
  };

  if (!rules) {
    return (
      <pre className="rounded bg-slate-800 border border-slate-700 p-3 text-xs text-red-400 overflow-x-auto my-2">
        {content}
      </pre>
    );
  }

  return (
    <div className="my-3 rounded-lg border border-slate-700 overflow-hidden">
      {/* Rendered tiles */}
      <div className="p-2 bg-slate-900/50">
        <DocsRuleBlock rules={rules} />
      </div>

      {/* Insert button */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/80 border-t border-slate-700">
        <span className="text-xs text-slate-500">
          {rules.length} {rules.length === 1 ? "rule" : "rules"}
        </span>
        <button
          type="button"
          onClick={handleInsert}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 hover:text-white transition-colors border border-slate-600 pointer-events-auto"
        >
          <ClipboardCopy className="w-3 h-3" aria-hidden="true" />
          Copy
        </button>
      </div>
    </div>
  );
}
