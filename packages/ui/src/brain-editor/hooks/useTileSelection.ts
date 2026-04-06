import {
  type IBrainTileDef,
  isCoreLiteralFactoryTileId,
  isCoreVariableFactoryTileId,
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
 * Hook to handle tile selection flow, including variable creation for factory tiles.
 */
export function useTileSelection({ ruleDef, side, onComplete }: UseTileSelectionOptions) {
  const editorConfig = useBrainEditorConfig();
  const { isAppVariableFactoryTileId } = editorConfig;

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
      if (tileDef.kind === "factory") {
        if (isCoreVariableFactoryTileId(tileDef.tileId) || isAppVariableFactoryTileId(tileDef.tileId)) {
          const factoryTileDef = tileDef as BrainTileFactoryDef;
          setPendingFactoryTile(factoryTileDef);
          setPendingTileAction(() => action);
          setShowCreateVariableDialog(true);
          return false;
        } else if (isCoreLiteralFactoryTileId(tileDef.tileId)) {
          const factoryTileDef = tileDef as BrainTileFactoryDef;
          setPendingFactoryTile(factoryTileDef);
          setPendingTileAction(() => action);
          setShowCreateLiteralDialog(true);
          return false;
        }
      }

      action(tileDef);
      onComplete?.();
      return true;
    },
    [onComplete, isAppVariableFactoryTileId]
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
