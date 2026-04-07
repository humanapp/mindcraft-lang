import { task, thread } from "@mindcraft-lang/core";
import { type IBrainTileDef, RuleSide } from "@mindcraft-lang/core/brain";
import { parseBrainTiles, type TypecheckResult } from "@mindcraft-lang/core/brain/compiler";
import type { BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { kMaxBrainRuleCommentLength } from "@mindcraft-lang/core/brain/model";
import { Plus, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { glassEffect } from "../lib/glass-effect";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useBrainEditorConfig } from "./BrainEditorContext";
import { BrainTileEditor } from "./BrainTileEditor";
import { BrainTilePickerDialog } from "./BrainTilePickerDialog";
import { runWithBrainServices } from "./brain-services";
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
  SetRuleCommentCommand,
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
  const { withBrainServices, tileCatalog } = useBrainEditorConfig();
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
        const parseResult = runWithBrainServices(withBrainServices, () => parseBrainTiles(tileSet.tiles()));
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
  }, [ruleDef, updateBadgesForSide, withBrainServices]);

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
    const command = new DeleteRuleCommand(ruleDef, withBrainServices);
    commandHistory.executeCommand(command);
  };

  const [canPaste, setCanPaste] = useState(hasRuleInClipboard());

  useEffect(() => {
    return onClipboardChanged(() => setCanPaste(hasRuleInClipboard()));
  }, []);

  const handleCopyRule = () => {
    copyRuleToClipboard(ruleDef, withBrainServices);
    toast.success("Rule copied");
  };

  const handlePasteRuleAbove = () => {
    const command = new PasteRuleAboveCommand(ruleDef, withBrainServices, tileCatalog);
    commandHistory.executeCommand(command);
  };

  const [isEditingComment, setIsEditingComment] = useState(false);
  const [commentValue, setCommentValue] = useState(ruleDef.comment() ?? "");
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const commentFocusedRef = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: updateCounter is an intentional trigger signal
  useEffect(() => {
    if (!isEditingComment) {
      setCommentValue(ruleDef.comment() ?? "");
    }
  }, [ruleDef, updateCounter, isEditingComment]);

  const saveComment = useCallback(() => {
    const trimmed = commentValue.trim();
    const newComment = trimmed || undefined;
    if (newComment !== ruleDef.comment()) {
      const command = new SetRuleCommentCommand(ruleDef, newComment);
      commandHistory.executeCommand(command);
    }
    setIsEditingComment(false);
  }, [commentValue, ruleDef, commandHistory]);

  const handleEditComment = () => {
    setCommentValue(ruleDef.comment() ?? "");
    setIsEditingComment(true);
    commentFocusedRef.current = false;
  };

  useEffect(() => {
    if (isEditingComment && commentInputRef.current) {
      commentInputRef.current.focus();
    }
  }, [isEditingComment]);

  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (val.length <= kMaxBrainRuleCommentLength) {
      setCommentValue(val);
    }
  };

  const handleCommentFocus = () => {
    commentFocusedRef.current = true;
  };

  const handleCommentBlur = () => {
    if (!commentFocusedRef.current) return;
    saveComment();
  };

  const handleCommentKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      setCommentValue(ruleDef.comment() ?? "");
      setIsEditingComment(false);
    }
  };

  const currentComment = ruleDef.comment();
  const showComment = isEditingComment || !!currentComment;

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
        className={`flex flex-col p-2 sm:p-3 mb-1 rounded-xl shadow-sm hover:shadow-md transition-shadow w-fit relative${showComment ? "" : " h-30"}`}
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
        {showComment && (
          <div className="flex items-start gap-1.5 mb-1.5 relative z-10">
            {isEditingComment ? (
              <>
                <textarea
                  ref={commentInputRef}
                  value={commentValue}
                  onChange={handleCommentChange}
                  onFocus={handleCommentFocus}
                  onBlur={handleCommentBlur}
                  onKeyDown={handleCommentKeyDown}
                  maxLength={kMaxBrainRuleCommentLength}
                  rows={1}
                  className="flex-1 text-xs text-white/90 bg-white/10 border border-white/20 rounded px-2 py-1 resize-none focus:outline-none focus:border-white/40 placeholder:text-white/40"
                  placeholder="Describe what this rule does..."
                />
                <Button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    saveComment();
                  }}
                  className="h-6 w-6 min-w-6 p-0 bg-green-500 hover:bg-green-600 text-white rounded-sm shrink-0"
                  title="Save comment"
                  aria-label="Save comment"
                >
                  <Save className="h-3 w-3" aria-hidden="true" />
                </Button>
              </>
            ) : (
              <button
                type="button"
                className="text-xs text-white/70 italic cursor-pointer hover:text-white/90 transition-colors text-left"
                onClick={handleEditComment}
                title="Click to edit comment"
              >
                {currentComment}
              </button>
            )}
          </div>
        )}
        <div className="flex flex-1 gap-1">
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
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleEditComment}>Edit Comment</DropdownMenuItem>
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
