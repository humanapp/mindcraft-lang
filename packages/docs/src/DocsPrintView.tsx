import { List } from "@mindcraft-lang/core";
import { type BrainServices, type IBrainTileDef, type ITileCatalog, RuleSide } from "@mindcraft-lang/core/brain";
import { type CatalogTileJson, TileCatalog } from "@mindcraft-lang/core/brain/tiles";
import type { TileVisual } from "@mindcraft-lang/ui/brain-editor/types";
import type { Element } from "hast";
import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDocsBrainServices, useDocsResolveTileVisual, useDocsTileCatalog } from "./DocsSidebarContext";

// ---------------------------------------------------------------------------
// Print-friendly tile chip -- no glass, no gradients, border-only
// ---------------------------------------------------------------------------

interface PrintTileChipProps {
  tileDef: IBrainTileDef;
  side: RuleSide;
}

function PrintTileChip({ tileDef, side }: PrintTileChipProps) {
  const resolveTileVisual = useDocsResolveTileVisual();
  const visual = resolveTileVisual(tileDef);
  const label = visual?.label || tileDef.tileId.split(".").pop() || tileDef.tileId;
  const iconUrl = visual?.iconUrl;
  const baseColor = (side === RuleSide.When ? visual?.colorDef?.when : visual?.colorDef?.do) || "#475569";

  return (
    <div className="docs-print-tile" style={{ borderColor: baseColor }}>
      {iconUrl && <img src={iconUrl} alt="" className="docs-print-tile-icon" aria-hidden="true" />}
      <span className="docs-print-tile-label">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Print-friendly rule row
// ---------------------------------------------------------------------------

interface PrintRuleRowProps {
  comment?: string;
  whenTiles: IBrainTileDef[];
  doTiles: IBrainTileDef[];
  depth: number;
  lineNumber: number;
}

function PrintRuleRow({ comment, whenTiles, doTiles, depth, lineNumber }: PrintRuleRowProps) {
  return (
    <div className="docs-print-rule" style={{ marginLeft: `${depth * 24}px` }}>
      {comment && <div className="docs-print-rule-comment">{comment}</div>}
      <div className="docs-print-rule-number">{lineNumber}</div>
      <div className="docs-print-chip docs-print-chip-when">WHEN</div>
      {whenTiles.map((tile, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable in print view
        <PrintTileChip key={`w${i}`} tileDef={tile} side={RuleSide.When} />
      ))}
      {whenTiles.length === 0 && <span className="docs-print-empty-hint">always</span>}
      <div className="docs-print-chip docs-print-chip-do">DO</div>
      {doTiles.map((tile, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable in print view
        <PrintTileChip key={`d${i}`} tileDef={tile} side={RuleSide.Do} />
      ))}
      {doTiles.length === 0 && <span className="docs-print-empty-hint">nothing</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brain fence -> print rules
// ---------------------------------------------------------------------------

interface PlainRule {
  version?: number;
  catalog?: CatalogTileJson[];
  comment?: string;
  when?: string[];
  do?: string[];
  children?: PlainRule[];
}

interface PlainRuleWrapper {
  ruleJsons: PlainRule[];
  catalog?: CatalogTileJson[];
}

interface PlainSingleTile {
  tile?: string;
  tileId?: string;
  catalog?: CatalogTileJson[];
  side?: "when" | "do";
}

interface PlainMultiTile {
  tiles: string[];
  catalog?: CatalogTileJson[];
  side?: "when" | "do";
}

interface FlatPrintRule {
  comment?: string;
  whenTiles: IBrainTileDef[];
  doTiles: IBrainTileDef[];
  depth: number;
  lineNumber: number;
}

function buildPrintLocalCatalog(
  entries: CatalogTileJson[],
  brainServices: BrainServices | undefined
): TileCatalog | undefined {
  if (entries.length === 0) return undefined;
  const catalog = new TileCatalog();
  if (brainServices) catalog.deserializeJson(List.from(entries), brainServices);
  return catalog;
}

function collectPrintCatalogEntries(rules: PlainRule[], topLevel?: CatalogTileJson[]): CatalogTileJson[] {
  const entries: CatalogTileJson[] = topLevel ? [...topLevel] : [];
  for (const rule of rules) {
    if (rule.catalog) {
      entries.push(...rule.catalog);
    }
  }
  return entries;
}

function resolveTiles(
  tileIds: string[],
  tileCatalog: ITileCatalog | undefined,
  localCatalog?: TileCatalog
): IBrainTileDef[] {
  return tileIds.map((id) => localCatalog?.get(id) ?? tileCatalog?.get(id)).filter(Boolean) as IBrainTileDef[];
}

function flattenPlainRules(
  rules: PlainRule[],
  tileCatalog: ITileCatalog | undefined,
  localCatalog: TileCatalog | undefined,
  depth = 0,
  startLine = 1
): FlatPrintRule[] {
  const result: FlatPrintRule[] = [];
  let line = startLine;
  for (const rule of rules) {
    result.push({
      comment: rule.comment,
      whenTiles: resolveTiles(rule.when ?? [], tileCatalog, localCatalog),
      doTiles: resolveTiles(rule.do ?? [], tileCatalog, localCatalog),
      depth,
      lineNumber: line++,
    });
    if (rule.children && rule.children.length > 0) {
      const children = flattenPlainRules(rule.children, tileCatalog, localCatalog, depth + 1, line);
      result.push(...children);
      line += children.length;
    }
  }
  return result;
}

function PrintBrainCodeBlock({ content, meta }: { content: string; meta: string }) {
  const tileCatalog = useDocsTileCatalog();
  const brainServices = useDocsBrainServices();
  const noFrame = meta.toLowerCase().split(/\s+/).includes("noframe");
  const metaSide = meta.toLowerCase().split(/\s+/).includes("do") ? RuleSide.Do : RuleSide.When;

  try {
    const parsed = JSON.parse(content);

    // Single tile: { tile: "tileId" } or { tileId: "..." }
    const singleId = parsed?.tile ?? parsed?.tileId;
    if (parsed && typeof parsed === "object" && typeof singleId === "string") {
      const single = parsed as PlainSingleTile;
      const localCatalog = buildPrintLocalCatalog(single.catalog ?? [], brainServices);
      const tiles = resolveTiles([singleId], tileCatalog, localCatalog);
      const side = single.side === "do" ? RuleSide.Do : single.side === "when" ? RuleSide.When : metaSide;
      return (
        <div className={noFrame ? "docs-print-tiles-noframe" : "docs-print-brain-block"}>
          {tiles.map((tile, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable in print view
            <PrintTileChip key={i} tileDef={tile} side={side} />
          ))}
        </div>
      );
    }

    // Multiple tiles: { tiles: [...] }
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.tiles)) {
      const multi = parsed as PlainMultiTile;
      const localCatalog = buildPrintLocalCatalog(multi.catalog ?? [], brainServices);
      const tiles = resolveTiles(multi.tiles, tileCatalog, localCatalog);
      const side = multi.side === "do" ? RuleSide.Do : multi.side === "when" ? RuleSide.When : metaSide;
      return (
        <div className={noFrame ? "docs-print-tiles-noframe" : "docs-print-brain-block"}>
          {tiles.map((tile, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable in print view
            <PrintTileChip key={i} tileDef={tile} side={side} />
          ))}
        </div>
      );
    }

    // Array of rules
    let rules: PlainRule[];
    let catalogEntries: CatalogTileJson[] = [];
    if (Array.isArray(parsed)) {
      rules = parsed as PlainRule[];
      catalogEntries = collectPrintCatalogEntries(rules);
    } else if (parsed && Array.isArray((parsed as PlainRuleWrapper).ruleJsons)) {
      const wrapper = parsed as PlainRuleWrapper;
      rules = wrapper.ruleJsons;
      catalogEntries = collectPrintCatalogEntries(rules, wrapper.catalog);
    } else {
      return <pre className="docs-print-code-fallback">{content}</pre>;
    }

    const localCatalog = buildPrintLocalCatalog(catalogEntries, brainServices);
    const flat = flattenPlainRules(rules, tileCatalog, localCatalog);
    return (
      <div className="docs-print-brain-block">
        {flat.map((r) => (
          <PrintRuleRow
            key={r.lineNumber}
            comment={r.comment}
            whenTiles={r.whenTiles}
            doTiles={r.doTiles}
            depth={r.depth}
            lineNumber={r.lineNumber}
          />
        ))}
      </div>
    );
  } catch {
    return <pre className="docs-print-code-fallback">{content}</pre>;
  }
}

// ---------------------------------------------------------------------------
// Tag pill helpers (print)
// ---------------------------------------------------------------------------

function parsePrintTagSpec(text: string): { label: string } | null {
  const body = text.slice(4); // strip "tag:"
  if (!body) return null;
  const label = body.split(";")[0].trim();
  if (!label) return null;
  return { label };
}

function PrintTagPill({ label }: { label: string }) {
  return <span className="docs-print-tag-pill">{label}</span>;
}

// ---------------------------------------------------------------------------
// Inline tile reference for print
// ---------------------------------------------------------------------------

function PrintInlineTileIcon({ tileDef }: { tileDef: IBrainTileDef }) {
  const resolveTileVisual = useDocsResolveTileVisual();
  const visual = resolveTileVisual(tileDef);
  const label = visual?.label || tileDef.tileId.split(".").pop() || tileDef.tileId;
  const iconUrl = visual?.iconUrl;
  const baseColor = visual?.colorDef?.when || visual?.colorDef?.do || "#475569";

  return (
    <span className="docs-print-inline-tile" style={{ borderColor: baseColor }}>
      {iconUrl && <img src={iconUrl} alt="" className="docs-print-inline-tile-icon" aria-hidden="true" />}
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Print-friendly markdown components
// ---------------------------------------------------------------------------

const PRINT_MD_COMPONENTS: Components = {
  pre({ children }) {
    return <>{children}</>;
  },

  code({ className, children, node }) {
    return (
      <PrintMarkdownCode className={className} node={node}>
        {children}
      </PrintMarkdownCode>
    );
  },

  h1({ children }) {
    return <h1 className="docs-print-h1">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="docs-print-h2">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="docs-print-h3">{children}</h3>;
  },
  p({ children }) {
    return <p className="docs-print-p">{children}</p>;
  },
  ul({ children }) {
    return <ul className="docs-print-ul">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="docs-print-ol">{children}</ol>;
  },
  li({ children }) {
    return <li className="docs-print-li">{children}</li>;
  },
  blockquote({ children }) {
    return <blockquote className="docs-print-blockquote">{children}</blockquote>;
  },
  strong({ children }) {
    return <strong className="docs-print-strong">{children}</strong>;
  },
  em({ children }) {
    return <em className="docs-print-em">{children}</em>;
  },
  hr() {
    return <hr className="docs-print-hr" />;
  },

  // Table elements
  table({ children }) {
    return (
      <div className="docs-print-table-wrap">
        <table className="docs-print-table">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="docs-print-thead">{children}</thead>;
  },
  tbody({ children }) {
    return <tbody>{children}</tbody>;
  },
  tr({ children }) {
    return <tr className="docs-print-tr">{children}</tr>;
  },
  th({ children }) {
    return <th className="docs-print-th">{children}</th>;
  },
  td({ children }) {
    return <td className="docs-print-td">{children}</td>;
  },
};

function PrintMarkdownCode({
  className,
  children,
  node,
}: {
  className?: string;
  children?: ReactNode;
  node?: unknown;
}) {
  const tileCatalog = useDocsTileCatalog();
  const lang = (className ?? "").replace("language-", "");

  if (lang === "brain") {
    const meta = ((node as Element | undefined)?.data as { meta?: string } | undefined)?.meta ?? "";
    return <PrintBrainCodeBlock content={String(children).trimEnd()} meta={meta} />;
  }

  if (!className) {
    const text = String(children);
    if (text.startsWith("tile:")) {
      const tileId = text.slice(5);
      const tileDef = tileCatalog?.get(tileId);
      if (tileDef) {
        return <PrintInlineTileIcon tileDef={tileDef} />;
      }
      return <code className="docs-print-code-inline">{tileId}</code>;
    }
    if (text.startsWith("tag:")) {
      const spec = parsePrintTagSpec(text);
      if (spec) {
        return <PrintTagPill label={spec.label} />;
      }
    }
  }

  return <code className="docs-print-code-inline">{children}</code>;
}

// ---------------------------------------------------------------------------
// DocsPrintView -- renders a markdown doc page for print
// ---------------------------------------------------------------------------

interface DocsPrintViewProps {
  content: string;
}

export function DocsPrintView({ content }: DocsPrintViewProps) {
  return (
    <div className="docs-print-view">
      <Markdown remarkPlugins={[remarkGfm]} components={PRINT_MD_COMPONENTS}>
        {content}
      </Markdown>
    </div>
  );
}
