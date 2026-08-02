import { List, task, thread } from "@mindcraft-lang/core";
import { type IBrainTileDef, type ITileCatalog, RuleSide } from "@mindcraft-lang/core/brain";
import type { TypecheckResult } from "@mindcraft-lang/core/brain/compiler";
import type {
  BrainCommand,
  BrainCommandHistory,
  BrainPageDef,
  BrainRuleDef,
  RulePlacement,
} from "@mindcraft-lang/core/brain/model";
import {
  AddTileCommand,
  DeleteRuleCommand,
  IndentRuleCommand,
  InsertRuleCommand,
  InsertTileCommand,
  kMaxBrainRuleCommentLength,
  MoveRuleDownCommand,
  MoveRuleUpCommand,
  OutdentRuleCommand,
  PasteRulesCommand,
  PasteTileBeforeCommand,
  RemoveTileCommand,
  ReplaceTileCommand,
  SetRuleCommentCommand,
} from "@mindcraft-lang/core/brain/model";
import { Plus, Save } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { type ArmedTargetEntry, isAppendTargetForRule, useArmedTargetController } from "./ArmedTargetContext";
import {
  kCandidateDragMimeType,
  type StripComposerBinding,
  type StripEditPointBinding,
  type StripRuleBinding,
  useCandidateStripSurface,
} from "./BrainCandidateStrip";
import { useBrainEditorConfig } from "./BrainEditorContext";
import { BrainRuleSentence } from "./BrainRuleSentence";
import { BrainTileEditor } from "./BrainTileEditor";
import { CreateLiteralDialog } from "./CreateLiteralDialog";
import { CreateVariableDialog } from "./CreateVariableDialog";
import { type CaretPosition, caretEditIntent, caretOnRun, caretRun, composerEntryCaret } from "./caret-run";
import { decideSentenceCellEntry } from "./composer-input-model";
import { armEditPoint, type EditPointArming, type EditPointPosition, editPointPositionOf } from "./edit-point";
import { kGrabbedRuleMarkerLayer, kRuleChromeLayer, kRuleContentLayer } from "./editor-layers";
import { useCandidateStrip } from "./hooks/useCandidateStrip";
import { useRuleCapabilities, useRuleOutputKeys } from "./hooks/useRuleCapabilities";
import { useTileSelection } from "./hooks/useTileSelection";
import { positionOffersTile, sideOffersAppendedTile } from "./insertion-context";
import { usePageGrid } from "./PageGridContext";
import {
  decidePageGridGrab,
  decidePageGridOperation,
  kPageGridCellAttribute,
  type PageGridCell,
  type PageGridOperation,
  type PageGridSubject,
  pageGridCellAfterComposing,
  pageGridCellKey,
  type RuleMoveDirection,
} from "./page-grid-model";
import { useRuleDragController } from "./RuleDragContext";
import { useRulePickup } from "./RulePickupContext";
import {
  copyRuleToClipboard,
  deserializeAllRulesFromClipboard,
  hasRuleInClipboard,
  onClipboardChanged,
} from "./rule-clipboard";
import {
  kRuleMoveMarkerCorners,
  kRuleMoveMarkerShape,
  ruleMoveMarkerOverlaySize,
  ruleMoveMarkerOverlayViewBox,
  ruleMoveMarkerPath,
} from "./rule-move-marker";
import { canEndSideExpression } from "./sentence-composer";
import { kSentenceTypeClasses } from "./sentence-type";
import { applyBrokenTileBadges, buildNodeMap, computeTileBadges, type TileBadge } from "./tile-badges";
import {
  copyTileToClipboard,
  hasTileInClipboard,
  importTileFromClipboard,
  peekTileInClipboard,
} from "./tile-clipboard";

/** Surface, hover, ink, and border of the rule row's round pills: the rule handle and each side's add-tile button. */
const pillChromeClasses = "bg-brain-pill hover:bg-brain-pill-hover text-brain-pill-ink border-2 border-brain-pill-edge";

/** The properties a pill whose visibility toggles animates: its hover growth, its surface, its edge, and its ink. */
const pillTransitionClasses = "transition-[transform,background-color,border-color,color] duration-150";

/**
 * The whole look of a round `+` button -- shape, size, chrome, hover growth and
 * glyph centring. Every control that adds something wears it: each side's
 * add-tile button, and the page's add-rule button.
 */
export const kAddButtonClasses = `relative rounded-full w-9 h-9 ${pillChromeClasses} hover:scale-105 ${pillTransitionClasses} font-semibold cursor-pointer flex items-center justify-center`;

/** The invitation the sentence line of a rule holding no tiles reads. */
const kComposerEntryPrompt = "Type what should happen...";

/** What a paste is refused with where the copied tile does not belong at the position. */
const kTilePasteRefusal = "That tile does not fit here";

/** The command that places `tileDef` where `arming` addresses on `side` of `ruleDef`. */
function editPointCommand(
  arming: EditPointArming,
  ruleDef: BrainRuleDef,
  side: RuleSide,
  tileDef: IBrainTileDef
): BrainCommand {
  switch (arming.mode) {
    case "append":
      return new AddTileCommand(ruleDef, side, tileDef);
    case "insert":
      return new InsertTileCommand(ruleDef, side, arming.tileIndex, tileDef);
    case "replace":
      return new ReplaceTileCommand(ruleDef, side, arming.tileIndex, tileDef);
  }
}

/** The up-pointing wedge a rule handle's movement marker is drawn as, in the overlay's user space. */
const kRuleMoveMarkerPath = ruleMoveMarkerPath(kRuleMoveMarkerShape);

/** The side, in pixels, of the square overlay the four wedges are drawn in. */
const kRuleMoveMarkerOverlaySize = ruleMoveMarkerOverlaySize(kRuleMoveMarkerShape);

/** The user space that overlay maps to, centred on the handle at one unit per pixel. */
const kRuleMoveMarkerOverlayViewBox = ruleMoveMarkerOverlayViewBox(kRuleMoveMarkerShape);

/** Degrees {@link kRuleMoveMarkerPath} turns about the handle's centre to point each way a rule can move. */
const kRuleMoveMarkerRotations: Record<RuleMoveDirection, number> = {
  up: 0,
  indent: 90,
  down: 180,
  outdent: 270,
};

/** One placement a rule's own composition made: the command it ran, and the element it stands at. */
interface ComposerCommit {
  readonly command: BrainCommand;
  readonly position: CaretPosition;
}

interface BrainRuleEditorProps {
  ruleDef: BrainRuleDef;
  index: number;
  pageDef: BrainPageDef;
  depth?: number;
  lineNumber: number;
  /** How many rules the page reads in all, which the handle names this rule's place among. */
  ruleCount: number;
  updateCounter: number;
  commandHistory: BrainCommandHistory;
}

/**
 * Editable WHEN/DO rule row. Supports drag-to-reorder, indent/outdent,
 * tile add/insert/replace/remove via context menu, and rule-level commands
 * (paste, delete, comment).
 */
export function BrainRuleEditor({
  ruleDef,
  index,
  pageDef,
  depth = 0,
  lineNumber,
  ruleCount,
  updateCounter,
  commandHistory,
}: BrainRuleEditorProps) {
  const { brainServices, tileCatalogs, isBrokenTile } = useBrainEditorConfig();
  // The cells this rule stands in the page's selection grid, and the one the
  // page's selection currently rests on.
  const pageGrid = usePageGrid();
  const ruleId = ruleDef.id();
  // The rule the page holds picked up.
  const rulePickup = useRulePickup();
  const isGrabbed = rulePickup.pickup?.ruleId === ruleId;
  const grabbedDirections = isGrabbed ? rulePickup.pickup?.directions : undefined;
  const dragController = useRuleDragController();
  const isDragging = dragController.draggingRuleId === ruleDef.id();
  const [menuOpen, setMenuOpen] = useState(false);
  const handleHandlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      // Begin drag tracking. The controller applies a movement threshold;
      // a release before the threshold leaves the menu free to open via click.
      const started = dragController.beginDrag(ruleDef, event);
      if (started) {
        // Suppress the radix trigger's pointer-down open behaviour so the menu
        // only opens for non-drag clicks (handled by the click handler below).
        event.preventDefault();
      }
    },
    [dragController, ruleDef]
  );
  const handleHandleClick = useCallback(() => {
    if (dragController.draggingRuleId !== null) return;
    setMenuOpen((open) => !open);
  }, [dragController]);
  const [canMoveUp, setCanMoveUp] = useState(ruleDef.canMoveUp());
  const [canMoveDown, setCanMoveDown] = useState(ruleDef.canMoveDown());
  const [canIndent, setCanIndent] = useState(ruleDef.canIndent());
  const [canOutdent, setCanOutdent] = useState(ruleDef.canOutdent());
  const armedTarget = useArmedTargetController();
  const appendTarget = isAppendTargetForRule(armedTarget.target, ruleDef) ? armedTarget.target : null;
  const stripId = useId();
  // The strip serves every armed mode for this rule: the append flow armed
  // here, and the insert/replace flows armed by the rule's tile editors.
  const stripTarget = armedTarget.target?.ruleDef === ruleDef ? armedTarget.target : null;
  const [isDirty, setIsDirty] = useState(ruleDef.isDirty());
  const [whenBadges, setWhenBadges] = useState<Map<number, TileBadge>>(new Map());
  const [doBadges, setDoBadges] = useState<Map<number, TileBadge>>(new Map());

  const availableCapabilities = useRuleCapabilities(ruleDef, updateCounter);
  const availableOutputKeys = useRuleOutputKeys(ruleDef, updateCounter);

  // Every catalog this rule places from: the host's, plus the tiles the brain
  // minted for itself.
  const catalogs = useMemo(() => {
    const list = tileCatalogs ? List.from<ITileCatalog>(tileCatalogs) : List.empty<ITileCatalog>();
    const localCatalog = ruleDef.brain()?.catalog();
    if (localCatalog) list.push(localCatalog);
    return list.asReadonly();
  }, [ruleDef, tileCatalogs]);

  // Whether a tile may follow what each side already holds. A host that supplies
  // no services cannot be asked, so both ends stand open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateCounter is an intentional trigger signal
  const appendable = useMemo(() => {
    const offers = (side: RuleSide) =>
      brainServices === undefined ||
      sideOffersAppendedTile({
        ruleDef,
        side,
        catalogs,
        services: brainServices,
        availableCapabilities,
        availableOutputKeys,
      });
    return { whenSide: offers(RuleSide.When), doSide: offers(RuleSide.Do) };
  }, [ruleDef, updateCounter, catalogs, brainServices, availableCapabilities, availableOutputKeys]);

  // The caret this rule's composition stands at, carried by the target armed
  // from the sentence. A rule holds it exactly while it is being composed.
  const armedCaret = stripTarget?.entry === "sentence" ? stripTarget.caret : undefined;
  // The rule changes under the caret from surfaces the composer does not drive --
  // the tile menu's Delete, the toolbar's Undo, a paste -- so the armed position
  // is read against the run the rule holds now before anything renders from it.
  const composerCaret = armedCaret === undefined ? undefined : caretOnRun(caretRun(ruleDef), armedCaret);

  // Composition from the sentence line: the placements this rule's own composer
  // made, newest last, each with the element it stands at, so deleting the last
  // of them can take that command back while it is still the history's newest
  // entry.
  const isComposing = composerCaret !== undefined;

  // Where this rule was last edited, which composition opens at again: the
  // composer's caret while composing, and otherwise the tile the page's
  // selection rests on.
  const selectedCell = pageGrid?.currentCell;
  const heldCaretRef = useRef<CaretPosition | undefined>(undefined);
  useEffect(() => {
    if (composerCaret !== undefined) heldCaretRef.current = composerCaret;
    else if (selectedCell?.kind === "tile" && selectedCell.ruleId === ruleId) {
      heldCaretRef.current = { kind: "element", side: selectedCell.side, tileIndex: selectedCell.tileIndex };
    }
  }, [composerCaret, selectedCell, ruleId]);

  const ownCommitsRef = useRef<ComposerCommit[]>([]);
  // The commits span one composition, so the WHEN->DO pivot keeps them; leaving
  // the sentence line for any other target drops them.
  useEffect(() => {
    if (!isComposing) ownCommitsRef.current = [];
  }, [isComposing]);
  const recordComposerCommit = useCallback(() => {
    if (composerCaret === undefined) return;
    // The commit ran its command a moment ago: the newest entry is that command,
    // and the tile it placed stands at the caret it was armed from.
    const command = commandHistory.peekUndo();
    if (!command) return;
    ownCommitsRef.current.push({
      command,
      position: { kind: "element", side: composerCaret.side, tileIndex: composerCaret.tileIndex },
    });
  }, [composerCaret, commandHistory]);

  const candidateStrip = useCandidateStrip({
    ruleDef,
    target: stripTarget,
    catalogs,
    availableCapabilities,
    availableOutputKeys,
    updateCounter,
    onCommitted: recordComposerCommit,
  });

  // The side whose add-tile button has the strip's panel standing under it.
  const offeredAppendSide = candidateStrip.offeringOpen ? appendTarget?.side : undefined;

  // Composition reaches the DO side only through the typed pivot, so an armed
  // DO side on the sentence line is the pivot the user typed. The comma stays
  // visible until a word stands behind it, after which the sentence reads its
  // own clause comma.
  const isPivoted = isComposing && stripTarget?.side === RuleSide.Do;

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
    side: stripTarget?.side ?? RuleSide.When,
    onComplete: armedTarget.disarm,
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

  // Compute tile badges from typecheck results, then overlay broken-tile badges
  // (an action tile whose definition failed to compile), which take precedence
  // over any per-rule diagnostic on the same tile.
  const updateBadgesForSide = useCallback(
    (side: RuleSide, typecheckResult: unknown) => {
      const result = typecheckResult as TypecheckResult | undefined;
      let badges: Map<number, TileBadge>;
      if (!result) {
        badges = new Map();
      } else {
        const sideParseResult = side === RuleSide.When ? result.whenParseResult : result.doParseResult;
        const nodeMap = buildNodeMap(sideParseResult);
        const typeDiags = result.typeInfo.diags.toArray().filter((d) => nodeMap.has(d.nodeId));
        badges = computeTileBadges(sideParseResult, typeDiags, nodeMap);
      }
      if (isBrokenTile) {
        const tiles = (side === RuleSide.When ? ruleDef.when() : ruleDef.do()).tiles().toArray();
        applyBrokenTileBadges(tiles, badges, isBrokenTile);
      }
      if (side === RuleSide.When) setWhenBadges(badges);
      else setDoBadges(badges);
    },
    [ruleDef, isBrokenTile]
  );

  useEffect(() => {
    const whenTileSet = ruleDef.when();
    const doTileSet = ruleDef.do();

    const unsubWhen = whenTileSet.events().on("tileSet_typechecked", (data) => {
      updateBadgesForSide(RuleSide.When, data.typecheckResult);
    });
    const unsubDo = doTileSet.events().on("tileSet_typechecked", (data) => {
      updateBadgesForSide(RuleSide.Do, data.typecheckResult);
    });

    // Badges derive from the stored full typecheck result. A rule with no
    // stored result yet (e.g. freshly deserialized or pasted) is typechecked
    // now; typecheck() is a no-op for rules that are clean and already checked.
    if (!whenTileSet.typecheckResult() || !doTileSet.typecheckResult()) {
      ruleDef.typecheck();
    }
    updateBadgesForSide(RuleSide.When, whenTileSet.typecheckResult());
    updateBadgesForSide(RuleSide.Do, doTileSet.typecheckResult());

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
    const command = new InsertRuleCommand(ruleDef, "before");
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
    toast.success("Rule copied");
  };

  const pasteRules = (placement: RulePlacement) => {
    const command = new PasteRulesCommand(ruleDef, placement, (destBrain) =>
      List.from(deserializeAllRulesFromClipboard(destBrain, tileCatalogs, brainServices))
    );
    commandHistory.executeCommand(command);
  };

  const handlePasteRuleAbove = () => pasteRules("before");

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

  const armAppendTarget = useCallback(
    (side: RuleSide) => {
      armedTarget.arm({
        ruleDef,
        side,
        mode: "append",
        entry: "tray",
        onTileSelected: (tileDef: IBrainTileDef) =>
          handleTileSelectedWithVariable(tileDef, (tile) => {
            const command = new AddTileCommand(ruleDef, side, tile);
            commandHistory.executeCommand(command);
          }),
      });
    },
    [armedTarget, ruleDef, handleTileSelectedWithVariable, commandHistory]
  );

  const handleAppendTileClick = (side: RuleSide) => () => armAppendTarget(side);

  // The edit point on a placed tile: one arming per pivot position, each asking
  // the oracle its own question and each placing with its own command. The entry
  // selects the mode the position is edited in: a tap on the tile takes the
  // tray, a tap on the tile's word or on a word boundary takes the sentence.
  const armTileEditPoint = useCallback(
    (side: RuleSide, anchorTileIndex: number, position: EditPointPosition, entry: ArmedTargetEntry) => {
      const arming = armEditPoint(position, anchorTileIndex, ruleDef.side(side).tiles().size());
      armedTarget.arm({
        ruleDef,
        side,
        mode: arming.mode,
        tileIndex: arming.mode === "append" ? undefined : arming.tileIndex,
        anchorTileIndex,
        entry,
        onTileSelected: (tileDef: IBrainTileDef) =>
          handleTileSelectedWithVariable(tileDef, (tile) => {
            commandHistory.executeCommand(editPointCommand(arming, ruleDef, side, tile));
          }),
      });
    },
    [armedTarget, ruleDef, handleTileSelectedWithVariable, commandHistory]
  );

  // The caret placed from the sentence: the position names the edit, and the
  // command that edit runs places the chosen tile.
  const placeSentenceCaret = useCallback(
    (position: CaretPosition) => {
      const side = position.side;
      const intent = caretEditIntent(position, ruleDef.side(side).tiles().size());
      const arming: EditPointArming =
        intent.mode === "append" ? { mode: "append" } : { mode: intent.mode, tileIndex: position.tileIndex };
      armedTarget.arm({
        ruleDef,
        side,
        mode: intent.mode,
        tileIndex: intent.mode === "append" ? undefined : intent.tileIndex,
        caret: position,
        entry: "sentence",
        onTileSelected: (tileDef: IBrainTileDef) =>
          handleTileSelectedWithVariable(tileDef, (tile) => {
            commandHistory.executeCommand(editPointCommand(arming, ruleDef, side, tile));
          }),
      });
    },
    [armedTarget, ruleDef, handleTileSelectedWithVariable, commandHistory]
  );

  // The character a printable key pressed on the entry point starts the word in
  // progress with, held until the arming that key asked for has landed and the
  // strip has started its own fresh word.
  const seedCharacterRef = useRef<string | undefined>(undefined);
  const setStripFilter = candidateStrip.setFilter;
  useEffect(() => {
    const seed = seedCharacterRef.current;
    if (seed === undefined || !isComposing) return;
    seedCharacterRef.current = undefined;
    setStripFilter(seed);
  }, [isComposing, setStripFilter]);

  /**
   * Compose the rule's sentence, standing the caret where this rule was last
   * edited and starting the word in progress with `seed`.
   */
  const enterSentence = (seed: string | undefined) => {
    seedCharacterRef.current = seed;
    placeSentenceCaret(composerEntryCaret(caretRun(ruleDef), heldCaretRef.current));
  };

  /**
   * A key pressed while the selection rests on the rule's sentence composes it:
   * Space and Enter with nothing typed, and a printable character with that
   * character starting the word in progress. Every other key is left alone,
   * with its default intact.
   */
  const handleSentenceCellKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const entry = decideSentenceCellEntry(event.key, event.metaKey || event.ctrlKey || event.altKey);
    if (entry === undefined) return;
    event.preventDefault();
    enterSentence(entry.seed);
  };

  // An insertion asks the rule it made to be composed; that rule's own card
  // takes the request up once as it renders and gives it back.
  const ruleToCompose = pageGrid?.ruleToCompose;
  const composeRule = pageGrid?.composeRule;
  const enterSentenceRef = useRef(enterSentence);
  enterSentenceRef.current = enterSentence;
  useEffect(() => {
    if (ruleToCompose !== ruleId || composeRule === undefined) return;
    composeRule(undefined);
    enterSentenceRef.current(undefined);
  }, [ruleToCompose, ruleId, composeRule]);

  /**
   * True when the copied tile belongs at `tileIndex` of `side`, which the
   * suggestion oracle answers. A host supplying no services cannot be asked, so
   * every position of such a rule stands open. False as well while the clipboard
   * holds no tile.
   */
  const clipboardTileFits = (side: RuleSide, tileIndex: number): boolean => {
    const tileDef = peekTileInClipboard();
    if (tileDef === undefined) return false;
    if (brainServices === undefined) return true;
    return positionOffersTile({
      ruleDef,
      side,
      tileIndex,
      tileDef,
      catalogs,
      services: brainServices,
      availableCapabilities,
      availableOutputKeys,
    });
  };

  /**
   * Places the copied tile at `tileIndex` of `side`, refusing where the oracle
   * does not offer it there and doing nothing while the clipboard holds no tile.
   */
  const pasteTileAt = (side: RuleSide, tileIndex: number): void => {
    if (!hasTileInClipboard()) return;
    if (!clipboardTileFits(side, tileIndex)) {
      toast.error(kTilePasteRefusal);
      return;
    }
    commandHistory.executeCommand(
      new PasteTileBeforeCommand(ruleDef, side, tileIndex, (destBrain) =>
        importTileFromClipboard(destBrain, brainServices)
      )
    );
  };

  /** Puts `subject` on its own clipboard. */
  const copySubject = (subject: PageGridSubject): void => {
    if (subject.kind === "rule") {
      copyRuleToClipboard(ruleDef);
      toast.success("Rule copied");
      return;
    }
    if (subject.kind !== "tile") return;
    const tileDef = ruleDef.side(subject.side).tiles().get(subject.tileIndex);
    if (!tileDef) return;
    copyTileToClipboard(tileDef, ruleDef.brain());
    toast.success("Tile copied");
  };

  /** Takes `subject` out of the page. */
  const removeSubject = (subject: PageGridSubject): void => {
    if (subject.kind === "side-end") return;
    commandHistory.executeCommand(
      subject.kind === "rule"
        ? new DeleteRuleCommand(ruleDef)
        : new RemoveTileCommand(ruleDef, subject.side, subject.tileIndex)
    );
  };

  /** Places what is on the clipboard past `subject`, or at the end of the side it names. */
  const pasteAfterSubject = (subject: PageGridSubject): void => {
    if (subject.kind === "rule") {
      if (hasRuleInClipboard()) pasteRules("after");
      return;
    }
    const side = subject.side;
    pasteTileAt(side, subject.kind === "tile" ? subject.tileIndex + 1 : ruleDef.side(side).tiles().size());
  };

  /** Runs `operation` on this rule. */
  const performOperation = (operation: PageGridOperation): void => {
    switch (operation.verb) {
      case "delete":
        removeSubject(operation.subject);
        return;
      case "copy":
        copySubject(operation.subject);
        return;
      case "cut":
        copySubject(operation.subject);
        removeSubject(operation.subject);
        return;
      case "paste":
        pasteAfterSubject(operation.subject);
        return;
      case "insert-rule": {
        const command = new InsertRuleCommand(ruleDef, "after");
        commandHistory.executeCommand(command);
        const inserted = command.insertedRule();
        if (inserted !== undefined) composeRule?.(inserted.id());
        return;
      }
    }
  };

  // A caret read back onto the run stands somewhere else than the target was
  // armed at; arming that target again moves the offering, and the command a
  // placement runs, to the tiles the rule holds now.
  useEffect(() => {
    if (composerCaret !== undefined && composerCaret !== armedCaret) placeSentenceCaret(composerCaret);
  });

  // The strip's position pivot, present only for a target armed on a placed tile from the tray.
  const editPointAnchor = stripTarget?.anchorTileIndex;
  const editPoint: StripEditPointBinding | undefined =
    stripTarget !== null && editPointAnchor !== undefined && !isComposing
      ? {
          position: editPointPositionOf(stripTarget, editPointAnchor),
          arm: (position: EditPointPosition) => armTileEditPoint(stripTarget.side, editPointAnchor, position, "tray"),
        }
      : undefined;

  const undoOwnLastCommit = useCallback((): void => {
    commandHistory.undo();
    ownCommitsRef.current.pop();
  }, [commandHistory]);

  const deleteTileAt = useCallback(
    (position: CaretPosition): void => {
      commandHistory.executeCommand(new RemoveTileCommand(ruleDef, position.side, position.tileIndex));
    },
    [commandHistory, ruleDef]
  );

  // The composition's own newest placement is takeable only while the command it
  // ran is still the history's newest entry; anything else done to the document
  // since leaves the tile to be removed like any other.
  const ownNewestPlacement = useCallback((): CaretPosition | undefined => {
    const own = ownCommitsRef.current[ownCommitsRef.current.length - 1];
    return own !== undefined && commandHistory.peekUndo() === own.command ? own.position : undefined;
  }, [commandHistory]);

  const ruleHasTiles = () => !ruleDef.when().tiles().isEmpty() || !ruleDef.do().tiles().isEmpty();

  const composer: StripComposerBinding | undefined =
    stripTarget !== null && composerCaret !== undefined
      ? {
          caretPosition: composerCaret,
          pivoted: isPivoted,
          canEndArmedSide: () =>
            canEndSideExpression((stripTarget.side === RuleSide.Do ? ruleDef.do() : ruleDef.when()).tiles()),
          isRuleEmpty: () => !ruleHasTiles(),
          doTileCount: () => ruleDef.do().tiles().size(),
          ownNewestPlacement,
          undoOwnLastCommit,
          exitCellKey: () => pageGridCellKey(pageGridCellAfterComposing(ruleId, composerCaret)),
        }
      : undefined;

  const rule: StripRuleBinding = { placeCaret: placeSentenceCaret, deleteTile: deleteTileAt };

  const handleTilePickerCancel = () => {
    armedTarget.disarm();
  };

  // The strip's two pieces: the input this rule's sentence hosts while it is
  // composed, and the offering panel laid over the rules below this one.
  const strip = useCandidateStripSurface({
    id: stripId,
    state: candidateStrip,
    target: stripTarget,
    onDismiss: handleTilePickerCancel,
    composer,
    rule,
    editPoint,
  });

  // Dropping a candidate chip on the armed rule places it at the armed
  // position, the same placement tapping the chip performs.
  const handleCandidateDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!stripTarget || !event.dataTransfer.types.includes(kCandidateDragMimeType)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleCandidateDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!stripTarget) return;
    const candidateKey = event.dataTransfer.getData(kCandidateDragMimeType);
    if (!candidateKey) return;
    event.preventDefault();
    candidateStrip.commitByKey(candidateKey);
  };

  const indentStyle = { marginLeft: `${depth * 32}px` };
  const hasTiles = ruleHasTiles();
  // An empty rule reads no sentence of its own, so its line is the invitation to
  // compose one, standing at the only caret position such a rule has.
  const showComposerEntry = !stripTarget && !hasTiles;
  // A card with nothing below its tile row keeps a compact fixed height.
  const hasBodyBelowTiles = showComment || hasTiles || showComposerEntry || isComposing;

  // The rule's cells are registered with the page for as long as it renders them.
  const registerRule = pageGrid?.registerRule;
  const currentCellKey = selectedCell === undefined ? undefined : pageGridCellKey(selectedCell);
  const whenTileCount = ruleDef.when().tiles().size();
  const doTileCount = ruleDef.do().tiles().size();
  // The line stands for a rule reading a sentence, one being composed, and one
  // inviting a sentence; a rule holding no tiles and armed from the tray shows
  // none of the three.
  const hasSentence = hasTiles || isComposing || showComposerEntry;
  const cellDescriptor = useMemo(
    () => ({
      ruleId,
      whenTileCount,
      doTileCount,
      whenAppendable: appendable.whenSide,
      doAppendable: appendable.doSide,
      hasSentence,
    }),
    [ruleId, whenTileCount, doTileCount, appendable.whenSide, appendable.doSide, hasSentence]
  );
  useEffect(() => registerRule?.(cellDescriptor), [registerRule, cellDescriptor]);

  /** How the rule's sentence row reads, whichever of its two controls stands there. */
  const sentenceCellName = `Rule ${lineNumber} sentence`;

  /** The grid attributes `cell` renders, or undefined for a rule standing outside a page grid. */
  const cellProps = (cell: PageGridCell) => {
    if (pageGrid === undefined) return undefined;
    const key = pageGridCellKey(cell);
    return { [kPageGridCellAttribute]: key, tabIndex: key === currentCellKey ? 0 : -1 };
  };

  /**
   * A key pressed on the rule handle. Enter and a space pick the rule up, after
   * which the arrow keys move it. Keys that would otherwise open the handle's
   * menu are suppressed.
   */
  const handleHandleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const withCommand = event.metaKey || event.ctrlKey;
    if (event.key === "ArrowDown" || (withCommand && event.key === "Enter")) {
      event.preventDefault();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (isGrabbed) return;
    const grabs = decidePageGridGrab({ kind: "handle", ruleId }, { key: event.key, withCommand, placement: "on-cell" });
    if (grabs) pageGrid?.grabRule(ruleId);
  };

  /**
   * A key pressed while the page's selection rests on one of this rule's cells:
   * Delete takes the cell's subject out, the clipboard keys copy, cut and paste
   * it, and the insertion chord puts a new rule after this one and composes it.
   * A key pressed on a control the cell holds belongs to that control.
   */
  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (selectedCell === undefined || selectedCell.kind === "append-rule" || selectedCell.ruleId !== ruleId) return;
    // A held rule reads its keys as moves; nothing operates on it until it is
    // set down.
    if (rulePickup.pickup !== null) return;
    const target = event.target as HTMLElement;
    const operation = decidePageGridOperation(selectedCell, {
      key: event.key,
      withCommand: event.metaKey || event.ctrlKey,
      placement: target.getAttribute(kPageGridCellAttribute) === currentCellKey ? "on-cell" : "inside-cell",
    });
    if (operation === undefined) return;
    event.preventDefault();
    performOperation(operation);
  };

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: changing to li requires restructuring BrainPageEditor */}
      <div
        className={`flex flex-col p-2 sm:p-3 mb-1 rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow w-fit relative${hasBodyBelowTiles ? "" : " h-30"}${isDragging ? ` ${kRuleChromeLayer}` : ""}`}
        style={{
          ...indentStyle,
          background: `${isGrabbed ? "linear-gradient(0deg, rgb(255 255 255 / 0.14), rgb(255 255 255 / 0.14)), " : ""}linear-gradient(55deg, var(--color-brain-rule-from) 0%, var(--color-brain-rule-to) 100%)`,
          opacity: isDragging ? 0.85 : undefined,
          transform: isDragging ? "scale(1.02)" : undefined,
          transition: isDragging ? "none" : "transform 120ms ease, opacity 120ms ease",
        }}
        data-rule-id={ruleDef.id()}
        role="listitem"
        aria-label={`Rule ${lineNumber}${isDirty ? " (modified)" : ""}`}
        onDragOver={handleCandidateDragOver}
        onDrop={handleCandidateDrop}
        onKeyDown={handleCardKeyDown}
      >
        {showComment && (
          <div className={`flex items-start gap-1.5 mb-1.5 relative ${kRuleContentLayer}`}>
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
                  className="flex-1 text-xs text-brain-ink/90 bg-brain-ink/10 border border-brain-ink/20 rounded px-2 py-1 resize-none focus:border-brain-ink/40 placeholder:text-brain-ink/40"
                  placeholder="Describe what this rule does..."
                />
                <Button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    saveComment();
                  }}
                  className="h-6 w-6 min-w-6 p-0 bg-success hover:bg-success/90 text-success-foreground rounded-sm shrink-0"
                  title="Save comment"
                  aria-label="Save comment"
                >
                  <Save className="h-3 w-3" aria-hidden="true" />
                </Button>
              </>
            ) : (
              <button
                type="button"
                className="text-xs text-brain-ink/70 italic cursor-pointer hover:text-brain-ink/90 transition-colors text-left"
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
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={`relative rounded-full self-center h-9 w-9 ${pillChromeClasses} hover:scale-105 transition-all font-semibold text-lg ${isDragging ? "cursor-grabbing" : "cursor-grab"}${isGrabbed ? ` ${kGrabbedRuleMarkerLayer}` : ""}`}
                data-rule-handle={ruleDef.id()}
                aria-label={`Rule ${lineNumber} of ${ruleCount}, handle${isDirty ? ", unsaved changes" : ""}`}
                aria-haspopup="menu"
                onPointerDown={handleHandlePointerDown}
                onClick={handleHandleClick}
                onKeyDown={handleHandleKeyDown}
                {...cellProps({ kind: "handle", ruleId })}
              >
                {lineNumber}
                {isDirty && (
                  <span
                    className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-brain-amber border border-brain-ink"
                    title="Has unsaved changes"
                    aria-hidden="true"
                  />
                )}
                {grabbedDirections && grabbedDirections.length > 0 && (
                  <svg
                    className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                    style={{ width: kRuleMoveMarkerOverlaySize, height: kRuleMoveMarkerOverlaySize }}
                    viewBox={kRuleMoveMarkerOverlayViewBox}
                    aria-hidden="true"
                  >
                    {grabbedDirections.map((direction) => (
                      <path
                        key={direction}
                        d={kRuleMoveMarkerPath}
                        transform={`rotate(${kRuleMoveMarkerRotations[direction]} 100 100)`}
                        className="fill-brain-pill stroke-brain-pill"
                        strokeWidth={kRuleMoveMarkerCorners}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        paintOrder="stroke fill"
                      />
                    ))}
                  </svg>
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
            className="px-2 py-1 ml-2 bg-brain-capsule border-2 border-brain-capsule-edge rounded-md rounded-l-2xl flex items-center justify-center shadow-sm relative overflow-hidden"
            style={{ writingMode: "vertical-rl" }}
            role="group"
            aria-label="When condition tiles"
          >
            <span
              className="rotate-[-90] text-brain-capsule-ink font-semibold text-md cursor-default"
              aria-hidden="true"
            >
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
                armEditPoint={(position) => armTileEditPoint(RuleSide.When, idx, position, "tray")}
                canPasteBefore={() => clipboardTileFits(RuleSide.When, idx)}
                pasteBefore={() => pasteTileAt(RuleSide.When, idx)}
              />
            ))}
          {/* + Add tile button for when side. It stands mid-row, so a WHEN side
              the oracle offers nothing at keeps the button's footprint and hides
              the button in it: nothing right of it moves, and the control is
              unclickable, unfocusable, and unannounced. */}
          <div className="flex items-center">
            <button
              type="button"
              className={`${kAddButtonClasses}${appendable.whenSide ? "" : " invisible"}`}
              data-append-tile={RuleSide.When}
              onClick={handleAppendTileClick(RuleSide.When)}
              aria-label="Add tile to when condition"
              aria-expanded={offeredAppendSide === RuleSide.When}
              aria-controls={offeredAppendSide === RuleSide.When ? stripId : undefined}
              {...(appendable.whenSide ? cellProps({ kind: "append", ruleId, side: RuleSide.When }) : { tabIndex: -1 })}
            >
              <Plus className={`h-4 w-4 relative ${kRuleContentLayer}`} aria-hidden="true" />
            </button>
          </div>
          {/* Do tiles */}{" "}
          {/* biome-ignore lint/a11y/useSemanticElements: changing to fieldset requires restructuring tile layout */}{" "}
          <div
            className="px-2 py-1 ml-3 bg-brain-capsule border-2 border-brain-capsule-edge rounded-md rounded-l-2xl flex items-center justify-center shadow-sm relative overflow-hidden"
            style={{ writingMode: "vertical-rl" }}
            role="group"
            aria-label="Do action tiles"
          >
            <span
              className="rotate-[-90] text-brain-capsule-ink font-semibold text-md cursor-default"
              aria-hidden="true"
            >
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
                armEditPoint={(position) => armTileEditPoint(RuleSide.Do, idx, position, "tray")}
                canPasteBefore={() => clipboardTileFits(RuleSide.Do, idx)}
                pasteBefore={() => pasteTileAt(RuleSide.Do, idx)}
              />
            ))}
          {/* + Add tile button for do side */}
          {appendable.doSide && (
            <div className="flex items-center">
              <button
                type="button"
                className={kAddButtonClasses}
                data-append-tile={RuleSide.Do}
                onClick={handleAppendTileClick(RuleSide.Do)}
                aria-label="Add tile to do action"
                aria-expanded={offeredAppendSide === RuleSide.Do}
                aria-controls={offeredAppendSide === RuleSide.Do ? stripId : undefined}
                {...cellProps({ kind: "append", ruleId, side: RuleSide.Do })}
              >
                <Plus className={`h-4 w-4 relative ${kRuleContentLayer}`} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
        <BrainRuleSentence
          ruleDef={ruleDef}
          updateCounter={updateCounter}
          composerInput={strip.composerInput}
          caretPosition={composerCaret}
          pending={strip.pending}
          landingCount={strip.landingCount}
          pivotComma={isPivoted && ruleDef.do().tiles().size() === 0}
          placeCaret={placeSentenceCaret}
          cellName={sentenceCellName}
          onCellKeyDown={handleSentenceCellKeyDown}
        />
        {showComposerEntry && (
          <button
            type="button"
            onClick={() => enterSentence(undefined)}
            onKeyDown={handleSentenceCellKeyDown}
            data-sentence-composer-entry={ruleDef.id()}
            aria-label={`${sentenceCellName}, empty. ${kComposerEntryPrompt}`}
            {...cellProps({ kind: "sentence", ruleId })}
            className={`relative ${kRuleContentLayer} mt-1.5 ml-11 flex min-h-8 max-w-2xl cursor-text items-center rounded-sm px-1 text-left ${kSentenceTypeClasses} text-brain-ink/45 italic transition-colors hover:bg-brain-ink/5 hover:text-brain-ink/70`}
          >
            {kComposerEntryPrompt}
          </button>
        )}
        {strip.panel}
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
