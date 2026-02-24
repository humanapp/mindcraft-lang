import { type IBrainTileDef, RuleSide } from "@mindcraft-lang/core/brain";
import type { BrainTileFactoryDef, BrainTileParameterDef } from "@mindcraft-lang/core/brain/tiles";
import { AlertTriangle, CircleAlert } from "lucide-react";
import { type ButtonHTMLAttributes, forwardRef, useLayoutEffect, useState } from "react";
import { dataTypeIconMap, dataTypeNameMap } from "@/brain/tiles/data-type-icons";
import type { TileVisual } from "@/brain/tiles/types";
import { adjustColor, saturateColor } from "@/lib/color";
import { glassEffect } from "@/lib/glass-effect";
import { TileValue } from "./TileValue";
import type { TileBadge } from "./tile-badges";

interface BrainTileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  tileDef: IBrainTileDef;
  side: RuleSide;
  badge?: TileBadge;
}

export const BrainTile = forwardRef<HTMLButtonElement, BrainTileProps>(
  ({ tileDef, side, badge, className = "", ...props }, ref) => {
    const [isOverflowing, setIsOverflowing] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [labelBasedWidth, setLabelBasedWidth] = useState<number | undefined>(undefined);

    const visual = tileDef.visual as TileVisual | undefined;
    const label = visual?.label || tileDef.tileId;
    const iconUrl = visual?.iconUrl || "/assets/brain/icons/question_mark.svg";
    const baseColor =
      (side === RuleSide.When ? visual?.colorDef?.when : side === RuleSide.Do ? visual?.colorDef?.do : undefined) ||
      "#475569"; // Fallback to slate-600

    // Check if this is a value tile (literal or variable)
    const isValueTile = tileDef.kind === "literal" || tileDef.kind === "variable" || tileDef.kind === "accessor";
    const isParamTile = tileDef.kind === "parameter";
    const isFactoryTile = tileDef.kind === "factory";
    let tileTypeIcon: string | undefined;
    let tileTypeName: string | undefined;

    if (isParamTile) {
      tileTypeIcon = dataTypeIconMap.get((tileDef as BrainTileParameterDef).dataType);
      tileTypeName = dataTypeNameMap.get((tileDef as BrainTileParameterDef).dataType);
    }
    if (isFactoryTile) {
      tileTypeIcon = dataTypeIconMap.get((tileDef as BrainTileFactoryDef).producedDataType);
      tileTypeName = dataTypeNameMap.get((tileDef as BrainTileFactoryDef).producedDataType);
    }

    // Create radial gradient from the base color
    const lighterColor = adjustColor(baseColor, 0.3); // 30% lighter
    const lighterColor2 = adjustColor(baseColor, 0.4); // 40% lighter
    const darkerColor = adjustColor(baseColor, 0); // 0% darker
    const saturatedColor = saturateColor(baseColor, 0.5); // 50% more saturated
    const darkerSaturatedColor = adjustColor(saturatedColor, -0.4); // 40% darker than the saturated color
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
    const gradientStyle = {
      background: `radial-gradient(circle at center, ${lighterColor}, ${darkerColor})`,
      borderColor: darkerSaturatedColor,
      ...tileGlass.containerStyle,
    };

    useLayoutEffect(() => {
      const tempSpan = document.createElement("span");
      tempSpan.style.visibility = "hidden";
      tempSpan.style.position = "absolute";
      tempSpan.style.whiteSpace = "nowrap";
      tempSpan.style.fontSize = "0.875rem"; // text-sm
      tempSpan.style.fontFamily =
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
      tempSpan.style.fontWeight = "600"; // font-semibold
      tempSpan.textContent = label;
      document.body.appendChild(tempSpan);

      const labelWidth = tempSpan.offsetWidth;
      document.body.removeChild(tempSpan);

      const defaultWidth = 96; // w-24 = 96px
      const maxWidth = isValueTile ? 288 : 192; // max-w-72 / max-w-48
      const labelPadding = isValueTile ? 24 : 16; // px-3 (24px) vs px-1 (8px) + extra
      const neededWidth = labelWidth + labelPadding;

      if (neededWidth > defaultWidth) {
        setLabelBasedWidth(Math.min(neededWidth, maxWidth));
      } else {
        setLabelBasedWidth(undefined);
      }

      setIsOverflowing(neededWidth > maxWidth);
    }, [label, isValueTile]);

    return (
      <div className="relative self-center hover:scale-105 transition-transform duration-100">
        {/* Error/warning badge -- rendered outside button to avoid overflow clip */}
        {badge && (
          <span
            className={`group/badge absolute -top-1.5 -right-1.5 z-30 flex items-center justify-center rounded-full w-6 h-6 shadow-md border pointer-events-auto ${
              badge.type === "error"
                ? "bg-red-500 border-red-600 text-white"
                : "bg-amber-400 border-amber-500 text-amber-900"
            }`}
            role="img"
            aria-label={badge.message}
          >
            {badge.type === "error" ? <CircleAlert className="w-4 h-4" /> : <CircleAlert className="w-4 h-4" />}
            {/* Instant tooltip */}
            <span className="absolute bottom-full right-0 mb-1 hidden group-hover/badge:block whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg pointer-events-none">
              {badge.message}
            </span>
          </span>
        )}
        <button
          ref={ref}
          data-scrollable={isOverflowing}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{ ...gradientStyle, ...(labelBasedWidth !== undefined ? { minWidth: labelBasedWidth } : {}) }}
          className={`flex flex-col border-2 h-24 max-h-24 min-h-24 ${isValueTile ? "w-auto min-w-24 max-w-72 px-3 pb-2.5" : "w-24 min-w-24 max-w-48 px-1 pb-1.5"} overflow-hidden rounded-lg pt-2 text-black text-sm font-medium cursor-pointer brightness-105 hover:brightness-110 transition-[filter] self-center shadow-sm relative ${className}`}
          aria-label={`${tileDef.kind} tile: ${label}`}
          {...props}
        >
          {/* Glass glint overlay */}
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
                  <TileValue tileDef={tileDef} />
                </div>
              </div>
            ) : (
              <img
                src={iconUrl}
                alt=""
                className={`h-16 w-full ${isFactoryTile ? "scale-50" : ""}`}
                aria-hidden="true"
              />
            )}
            <span
              className={`flex-1 flex items-end w-full text-sm ${isOverflowing ? "overflow-visible justify-start" : "overflow-hidden justify-center"}`}
            >
              <span
                className="whitespace-nowrap inline-block font-mono font-semibold"
                style={
                  isOverflowing && isHovered
                    ? {
                        animation: "marquee-scroll 4s linear infinite",
                      }
                    : undefined
                }
              >
                {isOverflowing
                  ? `${label}\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0${label}\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0${label}\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0`
                  : label}
              </span>
            </span>
          </div>
        </button>
      </div>
    );
  }
);

BrainTile.displayName = "BrainTile";
