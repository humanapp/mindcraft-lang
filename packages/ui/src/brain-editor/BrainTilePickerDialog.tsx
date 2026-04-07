import { List, type ReadonlyBitSet, type ReadonlyList } from "@mindcraft-lang/core";
import {
  CoreActuatorId,
  CoreCapabilityBits,
  type IBrainTileDef,
  type ITileCatalog,
  mkActuatorTileId,
  type RuleSide,
  TilePlacement,
  type TypeId,
} from "@mindcraft-lang/core/brain";
import type { Expr } from "@mindcraft-lang/core/brain/compiler";
import {
  countUnclosedParens,
  type InsertionContext,
  parseTilesForSuggestions,
  suggestTiles,
  type TileSuggestion,
} from "@mindcraft-lang/core/brain/language-service";
import React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { useBrainEditorConfig } from "./BrainEditorContext";
import { BrainTile } from "./BrainTile";
import { runWithBrainServices } from "./brain-services";
import { resolveTileVisual } from "./tile-visual-utils";

type TileGroup =
  | "actuator"
  | "sensor"
  | "function"
  | "parameter+modifier"
  | "variable"
  | "accessor"
  | "literal"
  | "page"
  | "operator+controlFlow"
  | "other";

function allTileGroups<const T extends readonly TileGroup[]>(
  groups: T & ([TileGroup] extends [T[number]] ? T : never)
): T {
  return groups;
}

const groupNames: Record<TileGroup, string> = {
  actuator: "Actuators",
  sensor: "Sensors",
  function: "Functions",
  "parameter+modifier": "Parameters",
  variable: "Variables",
  accessor: "Field Accessors",
  literal: "Literals",
  page: "Pages",
  "operator+controlFlow": "Operators",
  other: "Other",
};

/** Fuzzy character-bag match: every character in `filter` exists in `text` (case-insensitive, order-independent). */
function fuzzyMatch(filter: string, text: string): boolean {
  const lowerFilter = filter.toLowerCase();
  const pool = text.toLowerCase().split("");
  for (let fi = 0; fi < lowerFilter.length; fi++) {
    const idx = pool.indexOf(lowerFilter[fi]);
    if (idx === -1) return false;
    pool.splice(idx, 1);
  }
  return true;
}

export interface BrainTilePickerDialogProps {
  isOpen: boolean;
  side: RuleSide;
  localCatalog?: ITileCatalog;
  expectedType?: TypeId;
  expr?: Expr;
  replaceTileIndex?: number;
  availableCapabilities?: ReadonlyBitSet;
  existingTiles?: ReadonlyList<IBrainTileDef>;
  onTileSelected: (tileDef: IBrainTileDef) => boolean;
  onCancel: () => void;
}

export function BrainTilePickerDialog({
  isOpen,
  side,
  localCatalog,
  expectedType,
  expr: exprProp,
  replaceTileIndex,
  availableCapabilities,
  existingTiles,
  onTileSelected,
  onCancel,
}: BrainTilePickerDialogProps) {
  const editorConfig = useBrainEditorConfig();
  const { withBrainServices, brainServices, tileCatalog: servicesTiles } = editorConfig;
  const [filter, setFilter] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isOpen) {
      setFilter("");
      // Defer focus to the next animation frame so the dialog's DOM is fully
      // rendered.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const catalogs = React.useMemo(() => {
    const list = servicesTiles ? List.from<ITileCatalog>([servicesTiles]) : List.empty<ITileCatalog>();
    if (localCatalog) list.push(localCatalog);
    return list.asReadonly();
  }, [localCatalog, servicesTiles]);

  const { exactByKind, conversionByKind, hasConversions } = React.useMemo(() => {
    return runWithBrainServices(withBrainServices, () => {
      const expr = exprProp ?? (existingTiles ? parseTilesForSuggestions(existingTiles) : undefined);
      const unclosedParenDepth = existingTiles ? countUnclosedParens(existingTiles, replaceTileIndex) : 0;
      const context: InsertionContext = {
        ruleSide: side,
        expectedType,
        expr,
        replaceTileIndex,
        availableCapabilities,
        unclosedParenDepth,
      };
      const result = brainServices ? suggestTiles(context, catalogs, brainServices) : { exact: List.empty<TileSuggestion>(), withConversion: List.empty<TileSuggestion>() };

      const tileToGroup = (tileDef: IBrainTileDef): TileGroup => {
        if (
          tileDef.kind === "sensor" &&
          tileDef.placement !== undefined &&
          (tileDef.placement & TilePlacement.Inline) !== 0
        ) {
          if (tileDef.capabilities().get(CoreCapabilityBits.PageSensor) !== 0) return "page";
          return "function";
        }
        if (tileDef.kind === "factory") {
          if (tileDef.tileId.includes("var.factory")) return "variable";
          if (tileDef.tileId.includes("lit.factory")) return "literal";
          return "other";
        }
        switch (tileDef.kind) {
          case "parameter":
          case "modifier":
            return "parameter+modifier";
          case "operator":
          case "controlFlow":
            return "operator+controlFlow";
          case "actuator":
          case "sensor":
          case "variable":
          case "accessor":
          case "literal":
          case "page":
            return tileDef.kind;
          default:
            return "other";
        }
      };

      const switchPageTileId = mkActuatorTileId(CoreActuatorId.SwitchPage);
      const precedingIndex = replaceTileIndex != null ? replaceTileIndex - 1 : (existingTiles?.size() ?? 0) - 1;
      const precedingTile = precedingIndex >= 0 ? existingTiles?.get(precedingIndex) : undefined;
      const pagesFirst = precedingTile?.tileId === switchPageTileId;

      const groupOrder = pagesFirst
        ? allTileGroups([
            "page",
            "literal",
            "variable",
            "function",
            "actuator",
            "sensor",
            "parameter+modifier",
            "accessor",
            "operator+controlFlow",
            "other",
          ])
        : allTileGroups([
            "actuator",
            "sensor",
            "function",
            "parameter+modifier",
            "variable",
            "accessor",
            "literal",
            "page",
            "operator+controlFlow",
            "other",
          ]);
      const groupIndex = (g: TileGroup) => {
        const idx = groupOrder.indexOf(g);
        return idx === -1 ? groupOrder.length : idx;
      };

      const exactGroups = new Map<TileGroup, TileSuggestion[]>();
      for (let i = 0; i < result.exact.size(); i++) {
        const s = result.exact.get(i);
        const group = tileToGroup(s.tileDef);
        if (!exactGroups.has(group)) exactGroups.set(group, []);
        exactGroups.get(group)?.push(s);
      }

      const convGroups = new Map<TileGroup, TileSuggestion[]>();
      for (let i = 0; i < result.withConversion.size(); i++) {
        const s = result.withConversion.get(i);
        const group = tileToGroup(s.tileDef);
        if (!convGroups.has(group)) convGroups.set(group, []);
        convGroups.get(group)?.push(s);
      }

      for (const tiles of convGroups.values()) {
        tiles.sort((a, b) => a.conversionCost - b.conversionCost);
      }

      const sortEntries = (entries: [TileGroup, TileSuggestion[]][]) =>
        entries.sort((a, b) => groupIndex(a[0]) - groupIndex(b[0]));

      return {
        exactByKind: sortEntries(Array.from(exactGroups.entries())),
        conversionByKind: sortEntries(Array.from(convGroups.entries())),
        hasConversions: result.withConversion.size() > 0,
      };
    });
  }, [
    side,
    expectedType,
    exprProp,
    replaceTileIndex,
    availableCapabilities,
    existingTiles,
    catalogs,
    withBrainServices,
    brainServices,
  ]);

  const filterGroups = (groups: [TileGroup, TileSuggestion[]][]): [TileGroup, TileSuggestion[]][] => {
    if (filter.length === 0) return groups;
    const filtered: [TileGroup, TileSuggestion[]][] = [];
    for (const [group, tiles] of groups) {
      const matching = tiles.filter((s) => {
        const label = resolveTileVisual(editorConfig, s.tileDef).label;
        return fuzzyMatch(filter, label);
      });
      if (matching.length > 0) filtered.push([group, matching]);
    }
    return filtered;
  };

  const filteredExact = filterGroups(exactByKind);
  const filteredConversion = filterGroups(conversionByKind);
  const hasFilteredConversions = filteredConversion.length > 0;
  const noResults = filteredExact.length === 0 && !hasFilteredConversions;

  const handleTileClick = (tileDef: IBrainTileDef) => {
    const shouldClose = onTileSelected(tileDef);
    if (shouldClose) {
      onOpenChange(false);
    }
  };

  const onOpenChange = (open: boolean) => {
    if (!open) {
      onCancel();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="left-0 top-0 translate-x-0 translate-y-0 h-dvh max-w-full p-3 gap-2 sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:max-w-2xl sm:h-auto sm:p-6 sm:gap-4 bg-slate-50 border-2 border-slate-300 rounded-none sm:rounded-2xl">
        <DialogHeader className="border-b border-slate-200 pb-4">
          <DialogTitle className="text-slate-800 font-semibold">Pick a Brain Tile</DialogTitle>
          <DialogDescription className="text-slate-600">Select a tile to add to the rule.</DialogDescription>
          <Input
            ref={inputRef}
            type="text"
            placeholder="Filter tiles..."
            aria-label="Filter tiles"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mt-2 w-full text-black bg-white/90 focus:bg-white border-slate-900"
          />
        </DialogHeader>
        {/* biome-ignore lint/a11y/useSemanticElements: section is already used for each tile kind group within this container */}
        <div
          className="flex-1 sm:flex-none sm:h-96 overflow-y-auto p-3 sm:p-4 space-y-4 sm:space-y-6 rounded-lg"
          role="region"
          aria-label="Available brain tiles"
          style={{
            background: "linear-gradient(55deg, #1E1B4B 0%, #A78BFA 100%)",
            boxShadow: "inset 0 0 0 2px rgba(255, 255, 255, 0.25)",
          }}
        >
          {noResults && (
            <p className="text-white/70 text-lg text-center py-8">
              {filter.length > 0 ? "No tiles match your search." : "No results."}
            </p>
          )}
          {filteredExact.map(([group, tiles]) => (
            <section key={group} aria-labelledby={`tile-group-${group}`}>
              <h3 id={`tile-group-${group}`} className="text-sm font-semibold uppercase mb-2">
                {groupNames[group]}
              </h3>
              {/* biome-ignore lint/a11y/useSemanticElements: changing to fieldset requires restructuring tile layout */}
              <div className="flex flex-wrap gap-1" role="group" aria-label={`${groupNames[group]} tiles`}>
                {tiles.map((s) => (
                  <BrainTile
                    key={s.tileDef.tileId}
                    tileDef={s.tileDef}
                    side={side}
                    onClick={() => handleTileClick(s.tileDef)}
                  />
                ))}
              </div>
            </section>
          ))}
          {hasFilteredConversions && (
            <>
              <div className="border-t border-white/20 pt-4">
                <h3 className="text-xs font-semibold uppercase text-white/60 mb-3 tracking-wider">
                  Compatible via conversion
                </h3>
              </div>
              {filteredConversion.map(([group, tiles]) => (
                <section key={`conv-${group}`} aria-labelledby={`tile-group-conv-${group}`}>
                  <h3 id={`tile-group-conv-${group}`} className="text-sm font-semibold uppercase mb-2 text-white/50">
                    {groupNames[group]}
                  </h3>
                  {/* biome-ignore lint/a11y/useSemanticElements: changing to fieldset requires restructuring tile layout */}
                  <div
                    className="flex flex-wrap gap-1 opacity-75"
                    role="group"
                    aria-label={`${groupNames[group]} tiles (conversion)`}
                  >
                    {tiles.map((s) => (
                      <BrainTile
                        key={s.tileDef.tileId}
                        tileDef={s.tileDef}
                        side={side}
                        onClick={() => handleTileClick(s.tileDef)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
