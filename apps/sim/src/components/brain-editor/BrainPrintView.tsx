import { type IBrainTileDef, RuleSide } from "@mindcraft-lang/core/brain";
import type { BrainDef, BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import type { BrainTileFactoryDef, BrainTileParameterDef } from "@mindcraft-lang/core/brain/tiles";
import { dataTypeIconMap } from "@/brain/tiles/data-type-icons";
import type { TileVisual } from "@/brain/tiles/types";
import { TileValue } from "./TileValue";

// -- Print tile (simplified, no glass, no gradients) -------------------------

interface PrintTileProps {
  tileDef: IBrainTileDef;
  side: RuleSide;
}

function PrintTile({ tileDef, side }: PrintTileProps) {
  const visual = tileDef.visual as TileVisual | undefined;
  const label = visual?.label || tileDef.tileId;
  const iconUrl = visual?.iconUrl || "/assets/brain/icons/question_mark.svg";
  const baseColor =
    (side === RuleSide.When ? visual?.colorDef?.when : side === RuleSide.Do ? visual?.colorDef?.do : undefined) ||
    "#475569";

  const isValueTile = tileDef.kind === "literal" || tileDef.kind === "variable" || tileDef.kind === "accessor";
  const isFactoryTile = tileDef.kind === "factory";
  const isParamTile = tileDef.kind === "parameter";
  let tileTypeIcon: string | undefined;

  if (isParamTile) {
    tileTypeIcon = dataTypeIconMap.get((tileDef as BrainTileParameterDef).dataType);
  }
  if (isFactoryTile) {
    tileTypeIcon = dataTypeIconMap.get((tileDef as BrainTileFactoryDef).producedDataType);
  }

  return (
    <div className="brain-print-tile" style={{ borderColor: baseColor }}>
      {isValueTile && (
        <div
          style={{
            WebkitMaskImage: `url(${iconUrl})`,
            WebkitMaskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskImage: `url(${iconUrl})`,
            maskSize: "contain",
            maskRepeat: "no-repeat",
            maskPosition: "center",
            backgroundColor: "#555",
          }}
          className="brain-print-tile-icon-small"
          aria-hidden="true"
        />
      )}
      <div className="brain-print-tile-content">
        {isValueTile ? (
          <div className="brain-print-tile-value">
            <TileValue tileDef={tileDef} />
          </div>
        ) : (
          <img
            src={iconUrl}
            alt=""
            className={`brain-print-tile-icon ${isFactoryTile ? "brain-print-tile-icon-factory" : ""}`}
            aria-hidden="true"
          />
        )}
        <span className="brain-print-tile-label">{label}</span>
      </div>
    </div>
  );
}

// -- Print rule (simplified, no glass, no interactive elements) ---------------

interface PrintRuleProps {
  ruleDef: BrainRuleDef;
  depth: number;
  lineNumber: number;
}

function PrintRule({ ruleDef, depth, lineNumber }: PrintRuleProps) {
  const whenTiles = ruleDef.when().tiles().toArray();
  const doTiles = ruleDef.do().tiles().toArray();

  return (
    <div className="brain-print-rule" style={{ marginLeft: `${depth * 24}px` }}>
      {/* Line number */}
      <div className="brain-print-rule-number">{lineNumber}</div>

      {/* WHEN chip */}
      <div className="brain-print-chip brain-print-chip-when">WHEN</div>

      {/* WHEN tiles */}
      {whenTiles.map((tileDef, idx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: tiles have no stable IDs in print view
        <PrintTile key={`w${idx}`} tileDef={tileDef} side={RuleSide.When} />
      ))}

      {/* DO chip */}
      <div className="brain-print-chip brain-print-chip-do">DO</div>

      {/* DO tiles */}
      {doTiles.map((tileDef, idx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: tiles have no stable IDs in print view
        <PrintTile key={`d${idx}`} tileDef={tileDef} side={RuleSide.Do} />
      ))}
    </div>
  );
}

// -- Flatten rules (same logic as BrainPageEditor) ----------------------------

interface FlatRule {
  ruleDef: BrainRuleDef;
  depth: number;
  lineNumber: number;
}

function flattenRules(rules: BrainRuleDef[], depth: number = 0, startLine: number = 1): FlatRule[] {
  const result: FlatRule[] = [];
  let currentLine = startLine;

  rules.forEach((ruleDef) => {
    result.push({ ruleDef, depth, lineNumber: currentLine });
    currentLine++;

    if (ruleDef.children().size() > 0) {
      const childRules = flattenRules(ruleDef.children().toArray() as BrainRuleDef[], depth + 1, currentLine);
      result.push(...childRules);
      currentLine += childRules.length;
    }
  });

  return result;
}

// -- Print page ---------------------------------------------------------------

interface PrintPageProps {
  pageDef: BrainPageDef;
  pageNumber: number;
}

function PrintPage({ pageDef, pageNumber }: PrintPageProps) {
  const flatRules = flattenRules(pageDef.children().toArray() as BrainRuleDef[]);

  // Filter out trailing empty rules (the editor always appends an empty one)
  const nonEmptyRules = flatRules.filter((fr) => !fr.ruleDef.isEmpty(false));

  return (
    <div className="brain-print-page">
      <div className="brain-print-page-header">
        <span className="brain-print-page-number">Page {pageNumber}</span>
        <span className="brain-print-page-name">{pageDef.name()}</span>
      </div>
      <div className="brain-print-page-rules">
        {nonEmptyRules.length === 0 ? (
          <div className="brain-print-empty">(empty page)</div>
        ) : (
          nonEmptyRules.map((fr) => (
            <PrintRule key={fr.lineNumber} ruleDef={fr.ruleDef} depth={fr.depth} lineNumber={fr.lineNumber} />
          ))
        )}
      </div>
    </div>
  );
}

// -- Main print view ----------------------------------------------------------

interface BrainPrintViewProps {
  brainDef: BrainDef;
}

export function BrainPrintView({ brainDef }: BrainPrintViewProps) {
  const pages = brainDef.pages().toArray() as BrainPageDef[];

  return (
    <div className="brain-print-view">
      <div className="brain-print-header">
        <h1 className="brain-print-title">{brainDef.name()}</h1>
      </div>
      {pages.map((pageDef, idx) => (
        <PrintPage key={pageDef.pageId()} pageDef={pageDef} pageNumber={idx + 1} />
      ))}
    </div>
  );
}
