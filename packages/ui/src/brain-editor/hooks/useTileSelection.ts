import { type IBrainTileDef, isVariableFactoryTileId, type LiteralDisplayFormat } from "@wendoo-lang/core/brain";
import type { BrainRuleDef } from "@wendoo-lang/core/brain/model";
import type { BrainTileFactoryDef } from "@wendoo-lang/core/brain/tiles";
import { manufactureLiteralTile, manufactureVariableTile } from "@wendoo-lang/core/brain/tiles";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ArmedTargetEntry } from "../ArmedTargetContext";
import { useBrainEditorConfig } from "../BrainEditorContext";
import { tileDefersToCreateDialog } from "../candidate-strip-model";
import type { CaretPosition } from "../caret-run";
import { resolveTileVisual } from "../tile-visual-utils";

interface UseTileSelectionOptions {
  ruleDef: BrainRuleDef;
  /** Called when a selection ends, which closes the picker. */
  onComplete?: () => void;
  /**
   * Called once a tile named in a create dialog has been placed, in place of
   * `onComplete`. Defaults to `onComplete`.
   */
  onCreated?: () => void;
}

/**
 * The caret composition carries on at once a tile a create dialog made has been
 * placed: `placementCaret` for a placement made in a rule's sentence, and
 * undefined for one made anywhere else, which the placement ends.
 *
 * `entry` is the armed target's. `placementCaret` is the gap past the tile the
 * placement put in, read after the command ran; a placement that recorded none
 * ends the selection.
 */
export function composeAfterTileCreation(
  entry: ArmedTargetEntry | undefined,
  placementCaret: CaretPosition | undefined
): CaretPosition | undefined {
  return entry === "sentence" ? placementCaret : undefined;
}

/**
 * Effects invoked when a picked factory tile defers completion to a
 * create-variable or create-literal dialog. Each receives the factory tile
 * and the pending `action` to run once the tile has been manufactured.
 */
export interface TileSelectionDeferralEffects {
  deferVariableCreation(factoryTileDef: BrainTileFactoryDef, action: (tileDef: IBrainTileDef) => void): void;
  deferLiteralCreation(factoryTileDef: BrainTileFactoryDef, action: (tileDef: IBrainTileDef) => void): void;
}

/**
 * Route a picked tile to its selection action. Variable and literal factory
 * tiles defer: the matching effect receives the factory tile and the pending
 * action, and false is returned so the picker stays open. Any other tile runs
 * `action` immediately and returns true (the selection completed).
 */
export function routeTileSelection(
  tileDef: IBrainTileDef,
  action: (tileDef: IBrainTileDef) => void,
  effects: TileSelectionDeferralEffects
): boolean {
  if (tileDefersToCreateDialog(tileDef)) {
    const factoryTileDef = tileDef as BrainTileFactoryDef;
    if (isVariableFactoryTileId(tileDef.tileId)) effects.deferVariableCreation(factoryTileDef, action);
    else effects.deferLiteralCreation(factoryTileDef, action);
    return false;
  }
  action(tileDef);
  return true;
}

/**
 * Hook to handle tile selection flow, including variable creation for factory
 * tiles.
 *
 * A selection that completes outright calls `onComplete`. A factory tile defers
 * to a create dialog: submitting it places the tile the dialog names and calls
 * `onCreated`, and abandoning it places nothing and calls `onComplete`. Either
 * way the create dialog hands the keyboard back through
 * `handleCreateDialogCloseAutoFocus`, which the dialog takes as its
 * `onCloseAutoFocus`.
 */
export function useTileSelection({ ruleDef, onComplete, onCreated }: UseTileSelectionOptions) {
  const editorConfig = useBrainEditorConfig();
  const completeCreation = onCreated ?? onComplete;

  const [showCreateVariableDialog, setShowCreateVariableDialog] = useState(false);
  const [showCreateLiteralDialog, setShowCreateLiteralDialog] = useState(false);
  const [pendingFactoryTile, setPendingFactoryTile] = useState<BrainTileFactoryDef | null>(null);
  const [pendingTileAction, setPendingTileAction] = useState<((tileDef: IBrainTileDef) => void) | null>(null);

  // Store ruleDef in a ref so callbacks always access the latest value.
  // Without this, callbacks capture a stale closure over the initial ruleDef
  // and won't see subsequent prop updates.
  const ruleDefRef = useRef(ruleDef);
  useEffect(() => {
    ruleDefRef.current = ruleDef;
  }, [ruleDef]);

  // The element holding the keyboard as a create dialog opened, which takes it
  // back as that dialog closes.
  const creationOpenerRef = useRef<HTMLElement | null>(null);

  const handleTileSelected = useCallback(
    (tileDef: IBrainTileDef, action: (tileDef: IBrainTileDef) => void) => {
      const completed = routeTileSelection(tileDef, action, {
        deferVariableCreation: (factoryTileDef, pendingAction) => {
          creationOpenerRef.current = document.activeElement as HTMLElement | null;
          setPendingFactoryTile(factoryTileDef);
          setPendingTileAction(() => pendingAction);
          setShowCreateVariableDialog(true);
        },
        deferLiteralCreation: (factoryTileDef, pendingAction) => {
          creationOpenerRef.current = document.activeElement as HTMLElement | null;
          setPendingFactoryTile(factoryTileDef);
          setPendingTileAction(() => pendingAction);
          setShowCreateLiteralDialog(true);
        },
      });
      if (completed) {
        onComplete?.();
      }
      return completed;
    },
    [onComplete]
  );

  const handleVariableNameSubmit = useCallback(
    (varName: string) => {
      if (!varName.trim() || !pendingFactoryTile || !pendingTileAction) return;

      const catalog = ruleDefRef.current.brain()?.catalog();

      const newTileDef = manufactureVariableTile(pendingFactoryTile, catalog, varName);
      if (newTileDef) {
        pendingTileAction(newTileDef);
      }

      setShowCreateVariableDialog(false);
      setPendingFactoryTile(null);
      setPendingTileAction(null);
      completeCreation?.();
    },
    [pendingFactoryTile, pendingTileAction, completeCreation]
  );

  /** Abandons the variable being named, which ends the selection just as naming one does. */
  const handleVariableDialogClose = useCallback(() => {
    setShowCreateVariableDialog(false);
    setPendingFactoryTile(null);
    setPendingTileAction(null);
    onComplete?.();
  }, [onComplete]);

  const handleLiteralValueSubmit = useCallback(
    (value: unknown, displayFormat?: LiteralDisplayFormat) => {
      if (!pendingFactoryTile || !pendingTileAction) return;

      const catalog = ruleDefRef.current.brain()?.catalog();

      const newTileDef = manufactureLiteralTile(pendingFactoryTile, catalog, value, displayFormat);
      if (newTileDef) {
        pendingTileAction(newTileDef);
      }

      setShowCreateLiteralDialog(false);
      setPendingFactoryTile(null);
      setPendingTileAction(null);
      completeCreation?.();
    },
    [pendingFactoryTile, pendingTileAction, completeCreation]
  );

  /** Abandons the literal being entered, which ends the selection just as entering one does. */
  const handleLiteralDialogClose = useCallback(() => {
    setShowCreateLiteralDialog(false);
    setPendingFactoryTile(null);
    setPendingTileAction(null);
    onComplete?.();
  }, [onComplete]);

  // Hands the keyboard back to the element that held it as the create dialog
  // opened. An element no longer rendering leaves the hand-back to the dialog's
  // own restoration.
  const handleCreateDialogCloseAutoFocus = useCallback((event: Event) => {
    const returnTo = creationOpenerRef.current;
    creationOpenerRef.current = null;
    if (returnTo === null || !returnTo.isConnected) return;
    event.preventDefault();
    returnTo.focus({ preventScroll: true });
  }, []);

  const variableDialogTitle = pendingFactoryTile
    ? resolveTileVisual(editorConfig, pendingFactoryTile).label
    : "Create Variable";

  const literalDialogTitle = pendingFactoryTile
    ? resolveTileVisual(editorConfig, pendingFactoryTile).label
    : "Create Literal";

  const literalType = pendingFactoryTile?.producedDataType || "";

  return {
    showCreateVariableDialog,
    variableDialogTitle,
    showCreateLiteralDialog,
    literalDialogTitle,
    literalType,
    handleTileSelected,
    handleVariableNameSubmit,
    handleVariableDialogClose,
    handleLiteralValueSubmit,
    handleLiteralDialogClose,
    handleCreateDialogCloseAutoFocus,
  };
}
