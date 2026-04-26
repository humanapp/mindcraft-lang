import { type IBrainTileDef, RuleSide } from "@mindcraft-lang/core/brain";
import type { BrainTileAccessorDef, BrainTileLiteralDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import { adjustColor, formatValue, glassEffect, saturateColor } from "@mindcraft-lang/ui";
import type { TileVisual } from "@mindcraft-lang/ui/brain-editor/types";
import { useLayoutEffect, useState } from "react";
import { useDocsResolveTileVisual } from "./DocsSidebarContext";

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

/** Read-only rendering of a single brain tile, used inside doc tile strips and rule rows. */
export function DocsTileChip({ tileDef, side }: DocsTileChipProps) {
  const resolveTileVisual = useDocsResolveTileVisual();
  const visual = resolveTileVisual(tileDef);
  const label = visual?.label || tileDef.tileId.split(".").pop() || tileDef.tileId;
  const iconUrl = visual?.iconUrl || "/assets/brain/icons/question_mark.svg";
  const baseColor = (side === RuleSide.When ? visual?.colorDef?.when : visual?.colorDef?.do) || "#475569";

  const isValueTile = tileDef.kind === "literal" || tileDef.kind === "variable" || tileDef.kind === "accessor";

  const lighterColor = adjustColor(baseColor, 0.3);
  const lighterColor2 = adjustColor(baseColor, 0.4);
  const darkerColor = adjustColor(baseColor, 0);
  const darkerSaturatedColor = adjustColor(saturateColor(baseColor, 0.5), -0.4);

  let displayValue: string | undefined;
  let isItalic = false;
  if (tileDef.kind === "literal") {
    const literalDef = tileDef as BrainTileLiteralDef;
    const raw =
      literalDef.displayFormat && literalDef.displayFormat !== "default"
        ? literalDef.value
        : literalDef.valueLabel || literalDef.value;
    displayValue = formatValue(raw, literalDef.valueType, [], literalDef.displayFormat);
  } else if (tileDef.kind === "variable") {
    displayValue = (tileDef as BrainTileVariableDef).varName;
    isItalic = true;
  } else if (tileDef.kind === "accessor") {
    const accessorDef = tileDef as BrainTileAccessorDef;
    displayValue = formatValue(accessorDef.fieldName, accessorDef.fieldTypeId, []);
  }

  const [labelBasedWidth, setLabelBasedWidth] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const tempSpan = document.createElement("span");
    tempSpan.style.visibility = "hidden";
    tempSpan.style.position = "absolute";
    tempSpan.style.whiteSpace = "nowrap";
    tempSpan.style.fontSize = "0.875rem";
    tempSpan.style.fontFamily =
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    tempSpan.style.fontWeight = "600";
    tempSpan.textContent = label;
    document.body.appendChild(tempSpan);

    const labelWidth = tempSpan.offsetWidth;
    document.body.removeChild(tempSpan);

    const defaultWidth = 96;
    const maxWidth = isValueTile ? 288 : 192;
    const labelPadding = isValueTile ? 24 : 16;
    const neededWidth = labelWidth + labelPadding;

    if (neededWidth > defaultWidth) {
      setLabelBasedWidth(Math.min(neededWidth, maxWidth));
    } else {
      setLabelBasedWidth(undefined);
    }
  }, [label, isValueTile]);

  return (
    <div
      role="img"
      className={`relative flex flex-col border-2 h-24 min-h-24 max-h-24 ${
        isValueTile ? "w-auto min-w-24 max-w-72 px-3 pb-2.5" : "w-24 min-w-24 max-w-48 px-1 pb-1.5"
      } overflow-hidden rounded-lg pt-2 shrink-0`}
      aria-label={label}
      title={label}
      style={{
        borderColor: darkerSaturatedColor,
        background: `radial-gradient(circle at center, ${lighterColor}, ${darkerColor})`,
        ...(labelBasedWidth !== undefined ? { minWidth: labelBasedWidth } : {}),
        ...tileGlass.containerStyle,
      }}
    >
      <div
        className="absolute inset-0 rounded-md pointer-events-none z-20"
        style={tileGlass.overlayStyle}
        aria-hidden="true"
      />
      {isValueTile && (
        <div
          style={{
            backgroundColor: darkerSaturatedColor,
            WebkitMaskImage: `url(${iconUrl})`,
            WebkitMaskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskImage: `url(${iconUrl})`,
            maskSize: "contain",
            maskRepeat: "no-repeat",
            maskPosition: "center",
          }}
          className="absolute top-1 left-1 w-4 h-4 pointer-events-none"
          aria-hidden="true"
        />
      )}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10">
        {isValueTile ? (
          <div className="min-h-16 flex-1 flex items-center justify-center text-lg font-semibold text-center px-2 overflow-hidden w-full">
            <div
              className="truncate border-[3px] rounded px-2 py-1 shadow-inner"
              style={{
                backgroundColor: lighterColor2,
                borderColor: "white",
                boxShadow: "inset 0 0 0 1px #363535",
              }}
            >
              <span className={`font-math text-2xl${isItalic ? " italic" : ""}`} style={{ color: "#1a1a1a" }}>
                {displayValue}
              </span>
            </div>
          </div>
        ) : (
          <img src={iconUrl} alt="" className="h-16 w-full" aria-hidden="true" />
        )}
        <span className="flex-1 flex items-end w-full text-sm overflow-hidden justify-center">
          <span className="whitespace-nowrap inline-block font-mono font-semibold text-black">{label}</span>
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

/** Compact tile rendering used inline in prose for `tile:xxx` references. */
export function InlineTileIcon({ tileDef }: InlineTileIconProps) {
  const resolveTileVisual = useDocsResolveTileVisual();
  const visual = resolveTileVisual(tileDef);
  const label = visual?.label || tileDef.tileId.split(".").pop() || tileDef.tileId;
  const iconUrl = visual?.iconUrl;
  const baseColor = visual?.colorDef?.when || visual?.colorDef?.do || "#475569";

  return (
    <span
      className="inline-flex shrink-0 min-w-max items-center gap-0.5 align-middle px-1 py-0.5 rounded border text-xs font-mono font-normal text-nowrap"
      style={{ borderColor: baseColor, backgroundColor: adjustAlpha(baseColor, 0.15), color: "#e2e8f0" }}
      title={label}
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
  comment?: string;
  whenTiles: IBrainTileDef[];
  doTiles: IBrainTileDef[];
  depth?: number;
  lineNumber?: number;
}

function DocsRuleRow({ comment, whenTiles, doTiles, depth = 0, lineNumber }: DocsRuleRowProps) {
  const resolveTileVisual = useDocsResolveTileVisual();
  const whenLabel = whenTiles.map((t) => resolveTileVisual(t)?.label ?? t.tileId).join(", ");
  const doLabel = doTiles.map((t) => resolveTileVisual(t)?.label ?? t.tileId).join(", ");
  const rowLabel =
    lineNumber !== undefined
      ? `Rule ${lineNumber}: When ${whenLabel || ""}, do ${doLabel || ""}`
      : `When ${whenLabel || ""}, do ${doLabel || ""}`;

  return (
    <div
      role="img"
      className={`flex flex-col rounded-xl p-2 mb-1 shadow-sm overflow-x-auto${comment ? "" : " h-30"}`}
      aria-label={rowLabel}
      style={{
        marginLeft: depth * 32,
        background: "linear-gradient(55deg, #16143A 0%, #8B6CF3 100%)",
      }}
    >
      {comment && <span className="text-xs text-white/70 italic mb-1">{comment}</span>}
      <div className="flex flex-1 gap-1">
        {/* Line number badge -- aria-hidden because the number is already in the group aria-label */}
        {lineNumber !== undefined && (
          <span
            className="self-center shrink-0 h-9 w-9 rounded-full bg-slate-100 text-slate-700 text-lg font-semibold flex items-center justify-center border-2 border-slate-300"
            aria-hidden="true"
          >
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
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flat rule representation (tileIds resolved to IBrainTileDef)
// ---------------------------------------------------------------------------

/** Flat representation of a brain rule with `tileId`s already resolved to `IBrainTileDef`s. */
export interface DocsRuleData {
  comment?: string;
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

/** Render a stack of read-only brain rules as numbered rows. */
export function DocsRuleBlock({ rules }: DocsRuleBlockProps) {
  const flat = flattenRules(rules);
  return (
    <div className="rounded-lg overflow-hidden" style={{ zoom: 0.75 }}>
      {flat.map((rule) => (
        <DocsRuleRow
          key={rule.lineNumber}
          comment={rule.comment}
          whenTiles={rule.whenTiles}
          doTiles={rule.doTiles}
          depth={rule.depth}
          lineNumber={rule.lineNumber}
        />
      ))}
    </div>
  );
}
