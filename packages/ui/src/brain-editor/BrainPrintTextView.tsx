import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import type { BrainDef, BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import type { BrainTileAccessorDef, BrainTileLiteralDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import type { TileVisual } from "./types";

// -- Tile label formatting ----------------------------------------------------

function tileLabel(tileDef: IBrainTileDef): string {
  const visual = tileDef.visual as TileVisual | undefined;

  if (tileDef.kind === "literal") {
    const lit = tileDef as BrainTileLiteralDef;
    return lit.valueLabel || String(lit.value);
  }

  if (tileDef.kind === "variable") {
    const v = tileDef as BrainTileVariableDef;
    return v.varName;
  }

  if (tileDef.kind === "accessor") {
    const a = tileDef as BrainTileAccessorDef;
    return a.fieldName;
  }

  return visual?.label || tileDef.tileId.split(".").pop() || tileDef.tileId;
}

function tilesToText(tiles: IBrainTileDef[]): string {
  if (tiles.length === 0) return "(empty)";
  return tiles.map((t) => `[${tileLabel(t)}]`).join(" ");
}

// -- Recursive rule formatter -------------------------------------------------

interface TextRule {
  lineNumber: number;
  depth: number;
  whenText: string;
  doText: string;
}

function flattenRulesText(rules: BrainRuleDef[], depth: number = 0, startLine: number = 1): TextRule[] {
  const result: TextRule[] = [];
  let currentLine = startLine;

  rules.forEach((ruleDef) => {
    const isEmpty = ruleDef.isEmpty(false);
    if (!isEmpty) {
      result.push({
        lineNumber: currentLine,
        depth,
        whenText: tilesToText(ruleDef.when().tiles().toArray()),
        doText: tilesToText(ruleDef.do().tiles().toArray()),
      });
    }
    currentLine++;

    if (ruleDef.children().size() > 0) {
      const childRules = flattenRulesText(ruleDef.children().toArray() as BrainRuleDef[], depth + 1, currentLine);
      result.push(...childRules);
      currentLine += ruleDef.children().size();
    }
  });

  return result;
}

// -- Main text-only view component --------------------------------------------

interface BrainPrintTextViewProps {
  brainDef: BrainDef;
}

export function BrainPrintTextView({ brainDef }: BrainPrintTextViewProps) {
  const pages = brainDef.pages().toArray() as BrainPageDef[];

  return (
    <div className="brain-print-text-view">
      <h1 className="brain-print-text-title">{brainDef.name()}</h1>
      {pages.map((pageDef, idx) => {
        const rules = flattenRulesText(pageDef.children().toArray() as BrainRuleDef[]);
        return (
          <div key={pageDef.pageId()} className="brain-print-text-page">
            <h2 className="brain-print-text-page-header">
              Page {idx + 1}: {pageDef.name()}
            </h2>
            {rules.length === 0 ? (
              <div className="brain-print-text-empty">(empty page)</div>
            ) : (
              <table className="brain-print-text-table">
                <thead>
                  <tr>
                    <th scope="col" className="brain-print-text-th brain-print-text-th-num">
                      #
                    </th>
                    <th scope="col" className="brain-print-text-th">
                      WHEN
                    </th>
                    <th scope="col" className="brain-print-text-th">
                      DO
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.lineNumber} className="brain-print-text-row">
                      <td className="brain-print-text-td brain-print-text-td-num">{rule.lineNumber}</td>
                      <td className="brain-print-text-td" style={{ paddingLeft: `${rule.depth * 20 + 8}px` }}>
                        {rule.whenText}
                      </td>
                      <td className="brain-print-text-td" style={{ paddingLeft: `${rule.depth * 20 + 8}px` }}>
                        {rule.doText}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
