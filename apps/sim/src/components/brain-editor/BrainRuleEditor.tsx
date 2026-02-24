import { task, thread } from "@mindcraft-lang/core";
import { type IBrainTileDef, RuleSide } from "@mindcraft-lang/core/brain";
import { parseBrainTiles, type TypecheckResult } from "@mindcraft-lang/core/brain/compiler";
import type { BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { glassEffect } from "@/lib/glass-effect";
import { BrainTileEditor } from "./BrainTileEditor";
import { BrainTilePickerDialog } from "./BrainTilePickerDialog";
import { CreateLiteralDialog } from "./CreateLiteralDialog";
import { CreateVariableDialog } from "./CreateVariableDialog";
import {
  AddTileCommand,
  type BrainCommandHistory,
  DeleteRuleCommand,
  IndentRuleCommand,
  InsertRuleBeforeCommand,
  MoveRuleDownCommand,
  MoveRuleUpCommand,
  OutdentRuleCommand,
  PasteRuleAboveCommand,
} from "./commands";
import { useRuleCapabilities } from "./hooks/useRuleCapabilities";
import { useTileSelection } from "./hooks/useTileSelection";
import { copyRuleToClipboard, hasRuleInClipboard, onClipboardChanged } from "./rule-clipboard";
import { buildNodeMap, computeTileBadges, type TileBadge } from "./tile-badges";

// Pre-compute glass effects for each element type
const containerGlass = glassEffect({
  highlightSize: 6,
  shadowSize: 5,
  highlightStrength: 0.3,
  shadowStrength: 0.15,
  bandOpacity: 0.08,
  verticalShade: 0.05,
  cornerHighlight: 0.1,
  cornerHighlightPos: [5, 5],
  cornerShadow: 0.05,
  cornerShadowPos: [95, 95],
  cornerRadius: 25,
  extraInsetShadow: "inset 0 0 0 2px rgba(255, 255, 255, 0.15)",
});
const handleGlass = glassEffect({
  highlightStrength: 0.5,
  shadowStrength: 0.1,
  bandOpacity: 0.4,
  bandPeak: 20,
  bandEnd: 50,
  bottomReflection: 0.1,
  cornerHighlight: 0.25,
  cornerHighlightPos: [20, 15],
  cornerShadow: 0,
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
const addButtonGlass = glassEffect({
  highlightStrength: 0.5,
  shadowStrength: 0.1,
  bandOpacity: 0.4,
  bandPeak: 20,
  bandEnd: 50,
  bottomReflection: 0.1,
  cornerHighlight: 0.25,
  cornerHighlightPos: [20, 15],
  cornerShadow: 0,
});

interface BrainRuleEditorProps {
  ruleDef: BrainRuleDef;
  index: number;
  pageDef: BrainPageDef;
  depth?: number;
  lineNumber: number;
  updateCounter: number;
  commandHistory: BrainCommandHistory;
}

export function BrainRuleEditor({
  ruleDef,
  index,
  pageDef,
  depth = 0,
  lineNumber,
  updateCounter,
  commandHistory,
}: BrainRuleEditorProps) {
  const [canMoveUp, setCanMoveUp] = useState(ruleDef.canMoveUp());
  const [canMoveDown, setCanMoveDown] = useState(ruleDef.canMoveDown());
  const [canIndent, setCanIndent] = useState(ruleDef.canIndent());
  const [canOutdent, setCanOutdent] = useState(ruleDef.canOutdent());
  const [ruleSideForPicker, setRuleSideForPicker] = useState<RuleSide | null>(null);
  const [isDirty, setIsDirty] = useState(ruleDef.isDirty());
  const [whenBadges, setWhenBadges] = useState<Map<number, TileBadge>>(new Map());
  const [doBadges, setDoBadges] = useState<Map<number, TileBadge>>(new Map());

  const availableCapabilities = useRuleCapabilities(ruleDef, updateCounter);

  // Use the tile selection hook
  const {
    showCreateVariableDialog,
    variableDialogTitle,
    showCreateLiteralDialog,
    literalDialogTitle,
    literalType,
    handleTileSelected: handleTileSelectedWithVariable,
    handleVariableNameSubmit,
    handleVariableDialogClose,
    handleLiteralValueSubmit,
    handleLiteralDialogClose,
  } = useTileSelection({
    ruleDef,
    side: ruleSideForPicker || RuleSide.When,
    onComplete: () => setRuleSideForPicker(null),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: updateCounter is an intentional trigger signal
  useEffect(() => {
    const updateCapabilities = () => {
      setCanMoveUp(ruleDef.canMoveUp());
      setCanMoveDown(ruleDef.canMoveDown());
      setCanIndent(ruleDef.canIndent());
      setCanOutdent(ruleDef.canOutdent());
      setIsDirty(ruleDef.isDirty());
    };

    updateCapabilities();

    const unsubMarkedDirty = ruleDef.events().on("rule_dirtyChanged", updateCapabilities);
    return () => {
      unsubMarkedDirty();
    };
  }, [ruleDef, updateCounter]);

  // Compute tile badges from typecheck results
  const updateBadgesForSide = useCallback((side: RuleSide, typecheckResult: unknown) => {
    const result = typecheckResult as TypecheckResult | undefined;
    if (!result) {
      if (side === RuleSide.When) setWhenBadges(new Map());
      else setDoBadges(new Map());
      return;
    }
    const sideParseResult = side === RuleSide.When ? result.whenParseResult : result.doParseResult;
    const nodeMap = buildNodeMap(sideParseResult);
    const typeDiags = result.typeInfo.diags.toArray().filter((d) => nodeMap.has(d.nodeId));
    const badges = computeTileBadges(sideParseResult, typeDiags, nodeMap);
    if (side === RuleSide.When) setWhenBadges(badges);
    else setDoBadges(badges);
  }, []);

  useEffect(() => {
    const whenTileSet = ruleDef.when();
    const doTileSet = ruleDef.do();

    // Compute initial badges for tilesets that were already parsed before mount
    for (const [tileSet, side] of [
      [whenTileSet, RuleSide.When],
      [doTileSet, RuleSide.Do],
    ] as const) {
      if (!tileSet.isDirty() && !tileSet.isEmpty()) {
        const parseResult = parseBrainTiles(tileSet.tiles());
        const badges = computeTileBadges(parseResult);
        if (side === RuleSide.When) setWhenBadges(badges);
        else setDoBadges(badges);
      }
    }

    const unsubWhen = whenTileSet.events().on("tileSet_typechecked", (data) => {
      updateBadgesForSide(RuleSide.When, data.typecheckResult);
    });
    const unsubDo = doTileSet.events().on("tileSet_typechecked", (data) => {
      updateBadgesForSide(RuleSide.Do, data.typecheckResult);
    });

    return () => {
      unsubWhen();
      unsubDo();
    };
  }, [ruleDef, updateBadgesForSide]);

  const handleMoveUp = () => {
    const command = new MoveRuleUpCommand(ruleDef);
    commandHistory.executeCommand(command);
  };

  const handleMoveDown = () => {
    const command = new MoveRuleDownCommand(ruleDef);
    commandHistory.executeCommand(command);
  };

  const handleIndent = () => {
    const command = new IndentRuleCommand(ruleDef);
    commandHistory.executeCommand(command);
  };

  const handleOutdent = () => {
    const command = new OutdentRuleCommand(ruleDef);
    commandHistory.executeCommand(command);
  };

  const handleInsertRuleBefore = () => {
    const command = new InsertRuleBeforeCommand(ruleDef);
    commandHistory.executeCommand(command);
  };

  const handleDeleteRule = () => {
    const command = new DeleteRuleCommand(ruleDef);
    commandHistory.executeCommand(command);
  };

  const [canPaste, setCanPaste] = useState(hasRuleInClipboard());

  useEffect(() => {
    return onClipboardChanged(() => setCanPaste(hasRuleInClipboard()));
  }, []);

  const handleCopyRule = () => {
    copyRuleToClipboard(ruleDef);
  };

  const handlePasteRuleAbove = () => {
    const command = new PasteRuleAboveCommand(ruleDef);
    commandHistory.executeCommand(command);
  };

  const handleAppendTileClick = (side: RuleSide) => () => {
    setRuleSideForPicker(side);
  };

  const handleTilePickerCancel = () => {
    setRuleSideForPicker(null);
  };

  const handleTileSelected = (tileDef: IBrainTileDef) => {
    if (!ruleSideForPicker) return true;

    return handleTileSelectedWithVariable(tileDef, (tile) => {
      const command = new AddTileCommand(ruleDef, ruleSideForPicker, tile);
      commandHistory.executeCommand(command);
    });
  };

  const indentStyle = { marginLeft: `${depth * 32}px` };

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: changing to li requires restructuring BrainPageEditor */}
      <div
        className="flex h-30 p-3 mb-1 rounded-xl gap-1 shadow-sm hover:shadow-md transition-shadow w-fit relative"
        style={{
          ...indentStyle,
          background: "linear-gradient(55deg, #16143A 0%, #8B6CF3 100%)",
          ...containerGlass.containerStyle,
        }}
        role="listitem"
        aria-label={`Rule ${lineNumber}${isDirty ? " (modified)" : ""}`}
      >
        {/* Glass glint overlay */}
        <div
          className="absolute inset-0 rounded-xl pointer-events-none z-20"
          style={containerGlass.overlayStyle}
          aria-hidden="true"
        />
        {/* this button is the rule handle */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="relative rounded-full self-center h-9 w-9 bg-slate-100 hover:bg-slate-200 text-slate-700 hover:scale-105 transition-all font-semibold text-lg border-2 border-slate-300"
              style={handleGlass.containerStyle}
              aria-label={`Rule ${lineNumber} actions${isDirty ? ", unsaved changes" : ""}`}
              aria-haspopup="menu"
            >
              <span
                className="absolute inset-0 rounded-full pointer-events-none"
                style={handleGlass.overlayStyle}
                aria-hidden="true"
              />
              {lineNumber}
              {isDirty && (
                <span
                  className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 border border-white"
                  title="Has unsaved changes"
                  aria-hidden="true"
                />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={handleMoveUp} disabled={!canMoveUp}>
              Move Up
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleMoveDown} disabled={!canMoveDown}>
              Move Down
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleIndent} disabled={!canIndent}>
              Indent
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleOutdent} disabled={!canOutdent}>
              Outdent
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleInsertRuleBefore}>Add Rule Above</DropdownMenuItem>
            <DropdownMenuItem onClick={handleCopyRule}>Copy Rule</DropdownMenuItem>
            <DropdownMenuItem onClick={handlePasteRuleAbove} disabled={!canPaste}>
              Paste Rule Above
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDeleteRule}>Delete Rule</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* When tiles */}{" "}
        {/* biome-ignore lint/a11y/useSemanticElements: changing to fieldset requires restructuring tile layout */}{" "}
        <div
          className="px-2 py-1 ml-2 bg-linear-to-br from-slate-800 to-slate-900 border-2 border-slate-500 rounded-md rounded-l-2xl flex items-center justify-center shadow-sm relative overflow-hidden"
          style={{
            writingMode: "vertical-rl",
            ...chipGlass.containerStyle,
          }}
          role="group"
          aria-label="When condition tiles"
        >
          <span className="absolute inset-0 pointer-events-none" style={chipGlass.overlayStyle} aria-hidden="true" />
          <span className="rotate-[-90] text-white font-semibold text-md cursor-default" aria-hidden="true">
            <span className="inline-block rotate-270 mx-0">W</span>
            <span className="inline-block rotate-270 mx-0.5">H</span>
            <span className="inline-block rotate-270 mx-0.5">E</span>
            <span className="inline-block rotate-270 mx-0.5">N</span>
          </span>
        </div>
        {ruleDef
          .when()
          .tiles()
          .toArray()
          .map((tileDef, idx) => (
            <BrainTileEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: tiles have no stable IDs
              key={idx}
              tileDef={tileDef}
              tileIndex={idx}
              side={RuleSide.When}
              ruleDef={ruleDef}
              commandHistory={commandHistory}
              badge={whenBadges.get(idx)}
            />
          ))}
        {/* + Add tile button for when side */}
        <div className="flex items-center">
          <button
            type="button"
            className="relative rounded-full w-9 h-9 bg-violet-100 hover:bg-violet-200 text-violet-700 hover:scale-105 transition-all font-semibold border-2 border-violet-300 cursor-pointer flex items-center justify-center"
            style={addButtonGlass.containerStyle}
            onClick={handleAppendTileClick(RuleSide.When)}
            aria-label="Add tile to when condition"
          >
            <span
              className="absolute inset-0 rounded-full pointer-events-none"
              style={addButtonGlass.overlayStyle}
              aria-hidden="true"
            />
            <Plus className="h-4 w-4 relative z-10" aria-hidden="true" />
          </button>
        </div>
        {/* Do tiles */}{" "}
        {/* biome-ignore lint/a11y/useSemanticElements: changing to fieldset requires restructuring tile layout */}{" "}
        <div
          className="px-2 py-1 ml-3 bg-linear-to-br from-slate-800 to-slate-900 border-2 border-slate-500 rounded-md rounded-l-2xl flex items-center justify-center shadow-sm relative overflow-hidden"
          style={{
            writingMode: "vertical-rl",
            ...chipGlass.containerStyle,
          }}
          role="group"
          aria-label="Do action tiles"
        >
          <span className="absolute inset-0 pointer-events-none" style={chipGlass.overlayStyle} aria-hidden="true" />
          <span className="rotate-[-90] text-white font-semibold text-md cursor-default" aria-hidden="true">
            <span className="inline-block rotate-270 mx-0">D</span>
            <span className="inline-block rotate-270 mx-0.5">O</span>
          </span>
        </div>
        {ruleDef
          .do()
          .tiles()
          .toArray()
          .map((tileDef, idx) => (
            <BrainTileEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: tiles have no stable IDs
              key={idx}
              tileDef={tileDef}
              tileIndex={idx}
              side={RuleSide.Do}
              ruleDef={ruleDef}
              commandHistory={commandHistory}
              badge={doBadges.get(idx)}
            />
          ))}
        {/* + Add tile button for do side */}
        <div className="flex items-center">
          <button
            type="button"
            className="relative rounded-full w-9 h-9 bg-blue-100 hover:bg-blue-200 text-blue-700 hover:scale-105 transition-all font-semibold border-2 border-blue-300 cursor-pointer flex items-center justify-center"
            style={addButtonGlass.containerStyle}
            onClick={handleAppendTileClick(RuleSide.Do)}
            aria-label="Add tile to do action"
          >
            <span
              className="absolute inset-0 rounded-full pointer-events-none"
              style={addButtonGlass.overlayStyle}
              aria-hidden="true"
            />
            <Plus className="h-4 w-4 relative z-10" aria-hidden="true" />
          </button>
        </div>
        {ruleSideForPicker &&
          (() => {
            const tileSet = ruleSideForPicker === RuleSide.When ? ruleDef.when() : ruleDef.do();
            return (
              <BrainTilePickerDialog
                isOpen={true}
                side={ruleSideForPicker}
                localCatalog={ruleDef.brain()?.catalog()}
                expr={tileSet.expr()}
                existingTiles={tileSet.tiles()}
                availableCapabilities={availableCapabilities}
                onTileSelected={handleTileSelected}
                onCancel={handleTilePickerCancel}
              />
            );
          })()}
        {showCreateVariableDialog && (
          <CreateVariableDialog
            isOpen={showCreateVariableDialog}
            title={variableDialogTitle}
            onOpenChange={(open) => {
              if (!open) handleVariableDialogClose();
            }}
            onSubmit={handleVariableNameSubmit}
          />
        )}
        {showCreateLiteralDialog && (
          <CreateLiteralDialog
            isOpen={showCreateLiteralDialog}
            title={literalDialogTitle}
            literalType={literalType}
            onOpenChange={(open) => {
              if (!open) handleLiteralDialogClose();
            }}
            onSubmit={handleLiteralValueSubmit}
          />
        )}
      </div>
    </>
  );
}
