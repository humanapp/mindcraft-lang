import { getBrainServices, type IBrainTileDef, RuleSide } from "@mindcraft-lang/core/brain";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TileVisual } from "../brain-editor/types";

// ---------------------------------------------------------------------------
// Print-friendly tile chip -- no glass, no gradients, border-only
// ---------------------------------------------------------------------------

interface PrintTileChipProps {
  tileDef: IBrainTileDef;
  side: RuleSide;
}

function PrintTileChip({ tileDef, side }: PrintTileChipProps) {
  const visual = tileDef.visual as TileVisual | undefined;
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
  whenTiles: IBrainTileDef[];
  doTiles: IBrainTileDef[];
  depth: number;
  lineNumber: number;
}

function PrintRuleRow({ whenTiles, doTiles, depth, lineNumber }: PrintRuleRowProps) {
  return (
    <div className="docs-print-rule" style={{ marginLeft: `${depth * 24}px` }}>
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
  when?: string[];
  do?: string[];
  children?: PlainRule[];
}

interface FlatPrintRule {
  whenTiles: IBrainTileDef[];
  doTiles: IBrainTileDef[];
  depth: number;
  lineNumber: number;
}

function resolveTiles(tileIds: string[]): IBrainTileDef[] {
  const catalog = getBrainServices().tiles;
  return tileIds.map((id) => catalog.get(id)).filter(Boolean) as IBrainTileDef[];
}

function flattenPlainRules(rules: PlainRule[], depth = 0, startLine = 1): FlatPrintRule[] {
  const result: FlatPrintRule[] = [];
  let line = startLine;
  for (const rule of rules) {
    result.push({
      whenTiles: resolveTiles(rule.when ?? []),
      doTiles: resolveTiles(rule.do ?? []),
      depth,
      lineNumber: line++,
    });
    if (rule.children && rule.children.length > 0) {
      const children = flattenPlainRules(rule.children, depth + 1, line);
      result.push(...children);
      line += children.length;
    }
  }
  return result;
}

function PrintBrainCodeBlock({ content }: { content: string }) {
  let rules: FlatPrintRule[];
  try {
    const parsed = JSON.parse(content) as PlainRule[];
    if (!Array.isArray(parsed)) return <pre className="docs-print-code-fallback">{content}</pre>;
    rules = flattenPlainRules(parsed);
  } catch {
    return <pre className="docs-print-code-fallback">{content}</pre>;
  }

  return (
    <div className="docs-print-brain-block">
      {rules.map((r) => (
        <PrintRuleRow
          key={r.lineNumber}
          whenTiles={r.whenTiles}
          doTiles={r.doTiles}
          depth={r.depth}
          lineNumber={r.lineNumber}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline tile reference for print
// ---------------------------------------------------------------------------

function PrintInlineTileIcon({ tileDef }: { tileDef: IBrainTileDef }) {
  const visual = tileDef.visual as TileVisual | undefined;
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

  code({ className, children }) {
    const lang = (className ?? "").replace("language-", "");

    if (lang === "brain") {
      return <PrintBrainCodeBlock content={String(children).trimEnd()} />;
    }

    if (!className) {
      const text = String(children);
      if (text.startsWith("tile:")) {
        const tileId = text.slice(5);
        const tileDef = getBrainServices().tiles.get(tileId);
        if (tileDef) {
          return <PrintInlineTileIcon tileDef={tileDef} />;
        }
        return <code className="docs-print-code-inline">{tileId}</code>;
      }
    }

    return <code className="docs-print-code-inline">{children}</code>;
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
