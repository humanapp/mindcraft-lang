import {
  type IBrainTileDef,
  isCoreLiteralFactoryTileId,
  isVariableFactoryTileId,
  type LiteralDisplayFormat,
  type RuleSide,
} from "@mindcraft-lang/core/brain";
import type { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import type { BrainTileFactoryDef, BrainTileLiteralDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBrainEditorConfig } from "../BrainEditorContext";
import { resolveTileVisual } from "../tile-visual-utils";

interface UseTileSelectionOptions {
  ruleDef: BrainRuleDef;
  side: RuleSide;
  onComplete?: () => void;
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
  if (tileDef.kind === "factory") {
    if (isVariableFactoryTileId(tileDef.tileId)) {
      effects.deferVariableCreation(tileDef as BrainTileFactoryDef, action);
      return false;
    } else if (isCoreLiteralFactoryTileId(tileDef.tileId)) {
      effects.deferLiteralCreation(tileDef as BrainTileFactoryDef, action);
      return false;
    }
  }
  action(tileDef);
  return true;
}

/**
 * Hook to handle tile selection flow, including variable creation for factory tiles.
 */
export function useTileSelection({ ruleDef, side, onComplete }: UseTileSelectionOptions) {
  const editorConfig = useBrainEditorConfig();

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

  const handleTileSelected = useCallback(
    (tileDef: IBrainTileDef, action: (tileDef: IBrainTileDef) => void) => {
      const completed = routeTileSelection(tileDef, action, {
        deferVariableCreation: (factoryTileDef, pendingAction) => {
          setPendingFactoryTile(factoryTileDef);
          setPendingTileAction(() => pendingAction);
          setShowCreateVariableDialog(true);
        },
        deferLiteralCreation: (factoryTileDef, pendingAction) => {
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
      varName = varName.trim();
      if (!varName || !pendingFactoryTile || !pendingTileAction) return;

      const catalog = ruleDefRef.current.brain()?.catalog();

      let newTileDef = pendingFactoryTile.manufacture(pendingFactoryTile, {
        name: varName,
      }) as BrainTileVariableDef;
      if (newTileDef) {
        if (catalog) {
          const existingDef = catalog.find((td) => {
            if (td.kind !== "variable") return false;
            const varTileDef = td as BrainTileVariableDef;
            return (
              td.kind === "variable" && varTileDef.varName === varName && varTileDef.varType === newTileDef.varType
            );
          }) as BrainTileVariableDef | undefined;
          if (existingDef) {
            newTileDef = existingDef;
          } else {
            catalog.registerTileDef(newTileDef);
          }
        }
        pendingTileAction(newTileDef);
      }

      setShowCreateVariableDialog(false);
      setPendingFactoryTile(null);
      setPendingTileAction(null);
      onComplete?.();
    },
    [pendingFactoryTile, pendingTileAction, onComplete]
  );

  const handleVariableDialogClose = useCallback(() => {
    setShowCreateVariableDialog(false);
    setPendingFactoryTile(null);
    setPendingTileAction(null);
  }, []);

  const handleLiteralValueSubmit = useCallback(
    (value: unknown, displayFormat?: LiteralDisplayFormat) => {
      if (!pendingFactoryTile || !pendingTileAction) return;

      const catalog = ruleDefRef.current.brain()?.catalog();

      let newTileDef = pendingFactoryTile.manufacture(pendingFactoryTile, {
        value,
        displayFormat,
      }) as BrainTileLiteralDef;
      if (newTileDef) {
        if (catalog) {
          const existingDef = catalog.find((td) => {
            if (td.kind !== "literal") return false;
            const litTileDef = td as BrainTileLiteralDef;
            return (
              litTileDef.value === value &&
              litTileDef.valueType === newTileDef.valueType &&
              litTileDef.displayFormat === newTileDef.displayFormat
            );
          }) as BrainTileLiteralDef | undefined;
          if (existingDef) {
            newTileDef = existingDef;
          } else {
            catalog.registerTileDef(newTileDef);
          }
        }
        pendingTileAction(newTileDef);
      }

      setShowCreateLiteralDialog(false);
      setPendingFactoryTile(null);
      setPendingTileAction(null);
      onComplete?.();
    },
    [pendingFactoryTile, pendingTileAction, onComplete]
  );

  const handleLiteralDialogClose = useCallback(() => {
    setShowCreateLiteralDialog(false);
    setPendingFactoryTile(null);
    setPendingTileAction(null);
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
  };
}
