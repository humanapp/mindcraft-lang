import { type IBrainTileDef, RuleSide } from "@mindcraft-lang/core/brain";
import type { TileVisual } from "../brain-editor/types";

// ---------------------------------------------------------------------------
// Single tile chip -- simplified, read-only, no glass, no interactivity
// ---------------------------------------------------------------------------

interface DocsTileChipProps {
  tileDef: IBrainTileDef;
  side: RuleSide;
}

function DocsTileChip({ tileDef, side }: DocsTileChipProps) {
  const visual = tileDef.visual as TileVisual | undefined;
  const label = visual?.label || tileDef.tileId.split(".").pop() || tileDef.tileId;
  const iconUrl = visual?.iconUrl;
  const baseColor = (side === RuleSide.When ? visual?.colorDef?.when : visual?.colorDef?.do) || "#475569";

  const isValueTile = tileDef.kind === "literal" || tileDef.kind === "variable" || tileDef.kind === "accessor";

  return (
    <div
      className="flex flex-col items-center w-14 min-w-14 h-18 border-2 rounded-lg overflow-hidden shrink-0"
      style={{
        borderColor: baseColor,
        background: `radial-gradient(circle at center, ${adjustAlpha(baseColor, 0.3)}, ${adjustAlpha(baseColor, 0.15)})`,
      }}
      title={label}
    >
      <div className="flex-1 flex items-center justify-center w-full px-1 pt-1">
        {iconUrl ? (
          <img src={iconUrl} alt="" className={`w-9 h-9 ${isValueTile ? "opacity-60" : ""}`} aria-hidden="true" />
        ) : (
          <div className="w-9 h-9 rounded bg-slate-600 opacity-40" aria-hidden="true" />
        )}
      </div>
      <span className="w-full text-center text-xs font-mono font-semibold text-slate-200 px-0.5 pb-1 leading-none truncate">
        {label}
      </span>
    </div>
  );
}

/** Blend a hex color toward transparent by setting an alpha. */
function adjustAlpha(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------------
// Inline tile icon -- used in prose for `tile:xxx` references
// ---------------------------------------------------------------------------

interface InlineTileIconProps {
  tileDef: IBrainTileDef;
}

export function InlineTileIcon({ tileDef }: InlineTileIconProps) {
  const visual = tileDef.visual as TileVisual | undefined;
  const label = visual?.label || tileDef.tileId.split(".").pop() || tileDef.tileId;
  const iconUrl = visual?.iconUrl;
  const baseColor = visual?.colorDef?.when || visual?.colorDef?.do || "#475569";

  return (
    <span
      className="inline-flex items-center gap-0.5 align-middle px-1 py-0.5 rounded border text-xs font-mono font-semibold"
      style={{ borderColor: baseColor, backgroundColor: adjustAlpha(baseColor, 0.15), color: "#e2e8f0" }}
      title={tileDef.tileId}
    >
      {iconUrl && <img src={iconUrl} alt="" className="w-3.5 h-3.5 inline-block" aria-hidden="true" />}
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Single read-only brain rule row
// ---------------------------------------------------------------------------

interface DocsRuleRowProps {
  whenTiles: IBrainTileDef[];
  doTiles: IBrainTileDef[];
  depth?: number;
  lineNumber?: number;
}

function DocsRuleRow({ whenTiles, doTiles, depth = 0, lineNumber }: DocsRuleRowProps) {
  return (
    <div
      className="flex items-center gap-1 rounded-lg p-1.5 mb-1 overflow-x-auto"
      style={{
        marginLeft: depth * 20,
        background: "linear-gradient(55deg, #16143A 0%, #8B6CF3 100%)",
      }}
    >
      {/* Line number badge */}
      {lineNumber !== undefined && (
        <span className="shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold flex items-center justify-center">
          {lineNumber}
        </span>
      )}

      {/* WHEN chip */}
      <span className="rotate-90 shrink-0 px-1 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-300 text-xs font-semibold ml-1">
        <span className="inline-block rotate-270 mx-px">W</span>
        <span className="inline-block rotate-270 mx-px">H</span>
        <span className="inline-block rotate-270 mx-px">E</span>
        <span className="inline-block rotate-270 mx-px">N</span>
      </span>

      {/* WHEN tiles */}
      <div className="flex gap-1">
        {whenTiles.map((tile, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable in read-only view
          <DocsTileChip key={i} tileDef={tile} side={RuleSide.When} />
        ))}
        {whenTiles.length === 0 && <span className="text-xs text-slate-500 italic px-1">always</span>}
      </div>

      {/* DO chip */}
      <span className="rotate-90 shrink-0 px-1 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-300 text-xs font-semibold ml-1">
        <span className="inline-block rotate-270 mx-px">D</span>
        <span className="inline-block rotate-270 mx-px">O</span>
      </span>

      {/* DO tiles */}
      <div className="flex gap-1">
        {doTiles.map((tile, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable in read-only view
          <DocsTileChip key={i} tileDef={tile} side={RuleSide.Do} />
        ))}
        {doTiles.length === 0 && <span className="text-xs text-slate-500 italic px-1">nothing</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flat rule representation (tileIds resolved to IBrainTileDef)
// ---------------------------------------------------------------------------

export interface DocsRuleData {
  whenTiles: IBrainTileDef[];
  doTiles: IBrainTileDef[];
  depth: number;
  children: DocsRuleData[];
}

// ---------------------------------------------------------------------------
// Rendered block of one or more rules
// ---------------------------------------------------------------------------

interface DocsRuleBlockProps {
  rules: DocsRuleData[];
}

function flattenRules(rules: DocsRuleData[], startLine: number = 1): Array<DocsRuleData & { lineNumber: number }> {
  const result: Array<DocsRuleData & { lineNumber: number }> = [];
  let line = startLine;
  for (const rule of rules) {
    result.push({ ...rule, lineNumber: line++ });
    if (rule.children.length > 0) {
      const childFlat = flattenRules(rule.children, line);
      result.push(...childFlat);
      line += childFlat.length;
    }
  }
  return result;
}

export function DocsRuleBlock({ rules }: DocsRuleBlockProps) {
  const flat = flattenRules(rules);
  return (
    <div className="rounded-lg overflow-hidden">
      {flat.map((rule) => (
        <DocsRuleRow
          key={rule.lineNumber}
          whenTiles={rule.whenTiles}
          doTiles={rule.doTiles}
          depth={rule.depth}
          lineNumber={rule.lineNumber}
        />
      ))}
    </div>
  );
}
