import { type IBrainTileDef, RuleSide } from "@mindcraft-lang/core/brain";
import type { TileVisual } from "../brain-editor/types";
import { adjustColor, saturateColor } from "../lib/color";
import { glassEffect } from "../lib/glass-effect";

const tileGlass = glassEffect({
  highlightSize: 4,
  shadowSize: 6,
  highlightStrength: 0.8,
  shadowStrength: 0.1,
  bandOpacity: 0.15,
  bandPeak: 32,
  bandEnd: 100,
  bottomReflection: 0.06,
  verticalShade: 0.0,
});

const chipGlass = glassEffect({
  highlightStrength: 0.15,
  shadowStrength: 0,
  bandOpacity: 0.05,
  cornerHighlight: 0.1,
  cornerHighlightPos: [5, 10],
  cornerRadius: 40,
  cornerShadow: 0,
});

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

  const lighterColor = adjustColor(baseColor, 0.3);
  const darkerColor = adjustColor(baseColor, 0);
  const darkerSaturatedColor = adjustColor(saturateColor(baseColor, 0.5), -0.4);

  return (
    <div
      className="relative flex flex-col items-center w-24 min-w-24 h-24 border-2 rounded-lg overflow-hidden shrink-0"
      style={{
        borderColor: darkerSaturatedColor,
        background: `radial-gradient(circle at center, ${lighterColor}, ${darkerColor})`,
        ...tileGlass.containerStyle,
      }}
      title={label}
    >
      <div
        className="absolute inset-0 rounded-md pointer-events-none z-20"
        style={tileGlass.overlayStyle}
        aria-hidden="true"
      />
      <div className="flex-1 flex flex-col items-center justify-center relative z-10 w-full overflow-hidden pt-2">
        {iconUrl ? (
          <img src={iconUrl} alt="" className={`h-16 w-full ${isValueTile ? "opacity-60" : ""}`} aria-hidden="true" />
        ) : (
          <div className="h-16 w-full rounded bg-slate-600 opacity-40" aria-hidden="true" />
        )}
        <span className="flex-1 flex items-end w-full text-sm overflow-hidden justify-center pb-1.5 px-1">
          <span className="whitespace-nowrap inline-block font-mono font-semibold text-black truncate">{label}</span>
        </span>
      </div>
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
      className="inline-flex items-center gap-0.5 align-middle px-1 py-0.5 rounded border text-xs font-mono font-normal"
      style={{ borderColor: baseColor, backgroundColor: adjustAlpha(baseColor, 0.15), color: "#e2e8f0" }}
      title={tileDef.tileId}
    >
      {iconUrl && <img src={iconUrl} alt="" className="w-3.5 h-3.5 mr-px inline-block" aria-hidden="true" />}
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
      className="flex gap-1 rounded-xl p-2 mb-1 shadow-sm overflow-x-auto"
      style={{
        marginLeft: depth * 32,
        background: "linear-gradient(55deg, #16143A 0%, #8B6CF3 100%)",
      }}
    >
      {/* Line number badge */}
      {lineNumber !== undefined && (
        <span className="self-center shrink-0 h-9 w-9 rounded-full bg-slate-100 text-slate-700 text-lg font-semibold flex items-center justify-center border-2 border-slate-300">
          {lineNumber}
        </span>
      )}

      {/* WHEN chip */}
      <div
        className="px-2 py-1 ml-2 bg-linear-to-br from-slate-800 to-slate-900 border-2 border-slate-500 rounded-md rounded-l-2xl flex items-center justify-center shadow-sm relative overflow-hidden shrink-0"
        style={{ writingMode: "vertical-rl", ...chipGlass.containerStyle }}
        aria-hidden="true"
      >
        <span className="absolute inset-0 pointer-events-none" style={chipGlass.overlayStyle} />
        <span className="rotate-[-90] text-white font-semibold text-md cursor-default">
          <span className="inline-block rotate-270 mx-0">W</span>
          <span className="inline-block rotate-270 mx-0.5">H</span>
          <span className="inline-block rotate-270 mx-0.5">E</span>
          <span className="inline-block rotate-270 mx-0.5">N</span>
        </span>
      </div>

      {/* WHEN tiles */}
      <div className="self-center flex gap-1">
        {whenTiles.map((tile, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable in read-only view
          <DocsTileChip key={i} tileDef={tile} side={RuleSide.When} />
        ))}
        {whenTiles.length === 0 && <span className="text-xs text-slate-500 italic px-1">always</span>}
      </div>

      {/* DO chip */}
      <div
        className="px-2 py-1 ml-3 bg-linear-to-br from-slate-800 to-slate-900 border-2 border-slate-500 rounded-md rounded-l-2xl flex items-center justify-center shadow-sm relative overflow-hidden shrink-0"
        style={{ writingMode: "vertical-rl", ...chipGlass.containerStyle }}
        aria-hidden="true"
      >
        <span className="absolute inset-0 pointer-events-none" style={chipGlass.overlayStyle} />
        <span className="rotate-[-90] text-white font-semibold text-md cursor-default">
          <span className="inline-block rotate-270 mx-0">D</span>
          <span className="inline-block rotate-270 mx-0.5">O</span>
        </span>
      </div>

      {/* DO tiles */}
      <div className="self-center flex gap-1">
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
    <div className="rounded-lg overflow-hidden" style={{ zoom: 0.75 }}>
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
