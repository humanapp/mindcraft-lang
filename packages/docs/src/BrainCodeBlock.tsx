import { List } from "@mindcraft-lang/core";
import { type BrainServices, type IBrainTileDef, type ITileCatalog, RuleSide } from "@mindcraft-lang/core/brain";
import { type CatalogTileJson, TileCatalog } from "@mindcraft-lang/core/brain/tiles";
import { setClipboardFromJson } from "@mindcraft-lang/ui/brain-editor/rule-clipboard";
import { ClipboardCopy } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { DocsRuleBlock, type DocsRuleData, DocsTileChip } from "./DocsRule";
import { useDocsBrainServices, useDocsSidebar, useDocsTileCatalog, useDocsWithBrainServices } from "./DocsSidebarContext";

// ---------------------------------------------------------------------------
// Meta string parsing
// ---------------------------------------------------------------------------

interface BrainFenceMeta {
  noFrame: boolean;
  side: RuleSide;
}

function parseMeta(meta: string): BrainFenceMeta {
  const tokens = meta.toLowerCase().split(/\s+/).filter(Boolean);
  return {
    noFrame: tokens.includes("noframe"),
    side: tokens.includes("do") ? RuleSide.Do : RuleSide.When,
  };
}

// ---------------------------------------------------------------------------
// Plain-JSON -> DocsRuleData conversion
// ---------------------------------------------------------------------------

interface PlainRule {
  version?: number;
  catalog?: CatalogTileJson[];
  comment?: string;
  when?: string[];
  do?: string[];
  children?: PlainRule[];
}

/** Clipboard wrapper format: { ruleJsons: [...], catalog: [...] } */
interface PlainRuleWrapper {
  ruleJsons: PlainRule[];
  catalog?: CatalogTileJson[];
}

/** Single-tile format: { tile: "tileId", catalog?: [...] } or { tileId: "...", catalog?: [...] } */
interface PlainSingleTile {
  tile?: string;
  tileId?: string;
  catalog?: CatalogTileJson[];
  side?: "when" | "do";
}

/** Multi-tile format: { tiles: ["tileId", ...], catalog?: [...] } */
interface PlainMultiTile {
  tiles: string[];
  catalog?: CatalogTileJson[];
  side?: "when" | "do";
}

interface ParsedBrainBlock {
  kind: "rules";
  rules: PlainRule[];
  catalogEntries: CatalogTileJson[];
}

interface ParsedTileBlock {
  kind: "tiles";
  tileIds: string[];
  catalogEntries: CatalogTileJson[];
  side?: "when" | "do";
}

type ParsedBlock = ParsedBrainBlock | ParsedTileBlock;

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
function buildLocalCatalog(
  entries: CatalogTileJson[],
  withBrainServices: <T>(callback: () => T) => T,
  brainServices: BrainServices | undefined
): TileCatalog | undefined {
  if (entries.length === 0) return undefined;
  return withBrainServices(() => {
    const catalog = new TileCatalog();
    if (brainServices) catalog.deserializeJson(List.from(entries), brainServices);
    return catalog;
  });
}

function resolveTiles(
  tileIds: string[],
  tileCatalog: ITileCatalog | undefined,
  localCatalog?: TileCatalog
): IBrainTileDef[] {
  return tileIds.map((id) => localCatalog?.get(id) ?? tileCatalog?.get(id)).filter(Boolean) as IBrainTileDef[];
}

function convertRule(
  plain: PlainRule,
  tileCatalog: ITileCatalog | undefined,
  localCatalog: TileCatalog | undefined,
  depth = 0
): DocsRuleData {
  return {
    comment: plain.comment,
    whenTiles: resolveTiles(plain.when ?? [], tileCatalog, localCatalog),
    doTiles: resolveTiles(plain.do ?? [], tileCatalog, localCatalog),
    depth,
    children: (plain.children ?? []).map((c) => convertRule(c, tileCatalog, localCatalog, depth + 1)),
  };
}

/**
 * Parse the brain fence JSON. Accepts these formats:
 * - Array of rules: [{ when, do, catalog?, children? }]
 * - Clipboard wrapper: { ruleJsons: [...], catalog?: [...] }
 * - Single tile: { tile: "tileId", catalog?: [...] }
 * - Multiple tiles: { tiles: ["tileId", ...], catalog?: [...] }
 */
function parseBrainBlock(jsonStr: string): ParsedBlock | null {
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      const rules = parsed as PlainRule[];
      return { kind: "rules", rules, catalogEntries: collectCatalogEntries(rules) };
    }
    if (parsed && typeof parsed === "object") {
      // Single tile: { tile: "tileId" } or { tileId: "..." }
      const singleId = (parsed as PlainSingleTile).tile ?? (parsed as PlainSingleTile).tileId;
      if (typeof singleId === "string") {
        const single = parsed as PlainSingleTile;
        return { kind: "tiles", tileIds: [singleId], catalogEntries: single.catalog ?? [], side: single.side };
      }
      // Multiple tiles: { tiles: ["tileId", ...] }
      if (Array.isArray((parsed as PlainMultiTile).tiles)) {
        const multi = parsed as PlainMultiTile;
        return { kind: "tiles", tileIds: multi.tiles, catalogEntries: multi.catalog ?? [], side: multi.side };
      }
      // Clipboard wrapper: { ruleJsons: [...] }
      if (Array.isArray((parsed as PlainRuleWrapper).ruleJsons)) {
        const wrapper = parsed as PlainRuleWrapper;
        return {
          kind: "rules",
          rules: wrapper.ruleJsons,
          catalogEntries: collectCatalogEntries(wrapper.ruleJsons, wrapper.catalog),
        };
      }
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
  /** Meta string from the code fence info (e.g., "noframe"). */
  meta?: string;
}

export function BrainCodeBlock({ content, meta = "" }: BrainCodeBlockProps) {
  const { close } = useDocsSidebar();
  const tileCatalog = useDocsTileCatalog();
  const withBrainServices = useDocsWithBrainServices();
  const brainServices = useDocsBrainServices();
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
  const fenceMeta = useMemo(() => parseMeta(meta), [meta]);

  const parsed = useMemo(() => {
    const block = parseBrainBlock(content);
    if (!block) return null;
    const localCatalog = buildLocalCatalog(block.catalogEntries, withBrainServices, brainServices);
    if (block.kind === "tiles") {
      const side = block.side === "do" ? RuleSide.Do : block.side === "when" ? RuleSide.When : fenceMeta.side;
      return { kind: "tiles" as const, tiles: resolveTiles(block.tileIds, tileCatalog, localCatalog), side };
    }
    return { kind: "rules" as const, rules: block.rules.map((r) => convertRule(r, tileCatalog, localCatalog)) };
  }, [content, fenceMeta.side, tileCatalog, withBrainServices]);

  const handleInsert = () => {
    const block = parseBrainBlock(content);
    if (!block || block.kind !== "rules") return;
    setClipboardFromJson(block.rules, block.catalogEntries);
    const count = block.rules.length;
    toast.success(count === 1 ? "Example copied -- paste into a rule" : `${count} rules copied -- paste into a rule`);
    if (isMobile) {
      close();
    }
  };

  if (!parsed) {
    return (
      <pre className="rounded bg-slate-800 border border-slate-700 p-3 text-xs text-red-400 overflow-x-auto my-2">
        {content}
      </pre>
    );
  }

  // Standalone tile rendering (no rule frame)
  if (parsed.kind === "tiles") {
    if (fenceMeta.noFrame) {
      return (
        <div className="my-3 flex flex-wrap gap-1" style={{ zoom: 0.75 }}>
          {parsed.tiles.map((tile, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable in read-only view
            <DocsTileChip key={i} tileDef={tile} side={parsed.side} />
          ))}
        </div>
      );
    }
    return (
      <div className="my-3 rounded-lg border border-slate-700 overflow-hidden">
        <div className="p-2 bg-slate-900/50 flex flex-wrap gap-1" style={{ zoom: 0.75 }}>
          {parsed.tiles.map((tile, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable in read-only view
            <DocsTileChip key={i} tileDef={tile} side={parsed.side} />
          ))}
        </div>
      </div>
    );
  }

  // Rule rendering
  if (fenceMeta.noFrame) {
    return (
      <div className="my-3">
        <DocsRuleBlock rules={parsed.rules} />
      </div>
    );
  }

  return (
    <div className="my-3 rounded-lg border border-slate-700 overflow-hidden">
      {/* Rendered tiles */}
      <div className="p-2 bg-slate-900/50">
        <DocsRuleBlock rules={parsed.rules} />
      </div>

      {/* Insert button */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/80 border-t border-slate-700">
        <span className="text-xs text-slate-500">
          {parsed.rules.length} {parsed.rules.length === 1 ? "rule" : "rules"}
        </span>
        <button
          type="button"
          onClick={handleInsert}
          aria-label="Copy rules to clipboard"
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 hover:text-white transition-colors border border-slate-600 pointer-events-auto"
        >
          <ClipboardCopy className="w-3 h-3" aria-hidden="true" />
          Copy
        </button>
      </div>
    </div>
  );
}
