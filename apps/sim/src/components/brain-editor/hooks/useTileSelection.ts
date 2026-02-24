import {
  type IBrainTileDef,
  isCoreLiteralFactoryTileId,
  isCoreVariableFactoryTileId,
  type RuleSide,
} from "@mindcraft-lang/core/brain";
import type { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import type { BrainTileFactoryDef, BrainTileLiteralDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TileVisual } from "@/brain/tiles/types";
import { isAppVariableFactoryTileId } from "@/brain/tiles/variables";

interface UseTileSelectionOptions {
  ruleDef: BrainRuleDef;
  side: RuleSide;
  onComplete?: () => void;
}

/**
 * Hook to handle tile selection flow, including variable creation for factory tiles.
 */
export function useTileSelection({ ruleDef, side, onComplete }: UseTileSelectionOptions) {
  const [showCreateVariableDialog, setShowCreateVariableDialog] = useState(false);
  const [showCreateLiteralDialog, setShowCreateLiteralDialog] = useState(false);
  const [pendingFactoryTile, setPendingFactoryTile] = useState<BrainTileFactoryDef | null>(null);
  const [pendingTileAction, setPendingTileAction] = useState<((tileDef: IBrainTileDef) => void) | null>(null);

  // Use a ref to always have the latest ruleDef, avoiding stale closure issues
  const ruleDefRef = useRef(ruleDef);
  useEffect(() => {
    ruleDefRef.current = ruleDef;
  }, [ruleDef]);

  const handleTileSelected = useCallback(
    (tileDef: IBrainTileDef, action: (tileDef: IBrainTileDef) => void) => {
      // Check if this is a variable factory tile that needs special handling
      if (tileDef.kind === "factory") {
        if (isCoreVariableFactoryTileId(tileDef.tileId) || isAppVariableFactoryTileId(tileDef.tileId)) {
          const factoryTileDef = tileDef as BrainTileFactoryDef;
          setPendingFactoryTile(factoryTileDef);
          setPendingTileAction(() => action);
          setShowCreateVariableDialog(true);
          return false; // Don't close picker yet
        } else if (isCoreLiteralFactoryTileId(tileDef.tileId)) {
          const factoryTileDef = tileDef as BrainTileFactoryDef;
          setPendingFactoryTile(factoryTileDef);
          setPendingTileAction(() => action);
          setShowCreateLiteralDialog(true);
          return false; // Don't close picker yet
        }
      }

      // Normal tile, execute the action directly
      action(tileDef);
      onComplete?.();
      return true;
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
    (value: unknown) => {
      if (!pendingFactoryTile || !pendingTileAction) return;

      const catalog = ruleDefRef.current.brain()?.catalog();

      let newTileDef = pendingFactoryTile.manufacture(pendingFactoryTile, {
        value,
      }) as BrainTileLiteralDef;
      if (newTileDef) {
        if (catalog) {
          const existingDef = catalog.find((td) => {
            if (td.kind !== "literal") return false;
            const litTileDef = td as BrainTileLiteralDef;
            return td.kind === "literal" && litTileDef.value === value && litTileDef.valueType === newTileDef.valueType;
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
    ? (pendingFactoryTile.visual as TileVisual | undefined)?.label || pendingFactoryTile.tileId
    : "Create Variable";

  const literalDialogTitle = pendingFactoryTile
    ? (pendingFactoryTile.visual as TileVisual | undefined)?.label || pendingFactoryTile.tileId
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
