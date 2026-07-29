import type { IBrainTileDef, LiteralDisplayFormat, RuleSide } from "@mindcraft-lang/core/brain";
import type { BrainCommandHistory, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import {
  InsertTileCommand,
  PasteTileBeforeCommand,
  RemoveTileCommand,
  RenameVariableCommand,
  ReplaceTileCommand,
} from "@mindcraft-lang/core/brain/model";
import { BrainTileLiteralDef, type BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import { CoreTypeIds } from "@mindcraft-lang/core/runtime";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { isTileTargetForTile, useArmedTargetController } from "./ArmedTargetContext";
import { useBrainEditorConfig } from "./BrainEditorContext";
import { BrainTile } from "./BrainTile";
import { CreateLiteralDialog } from "./CreateLiteralDialog";
import { CreateVariableDialog } from "./CreateVariableDialog";
import { EditLiteralFormatDialog } from "./EditLiteralFormatDialog";
import { useTileSelection } from "./hooks/useTileSelection";
import { RenameVariableDialog } from "./RenameVariableDialog";
import type { TileBadge } from "./tile-badges";
import {
  copyTileToClipboard,
  hasTileInClipboard,
  importTileFromClipboard,
  onTileClipboardChanged,
} from "./tile-clipboard";

interface BrainTileEditorProps {
  tileDef: IBrainTileDef;
  tileIndex: number;
  side: RuleSide;
  ruleDef: BrainRuleDef;
  commandHistory: BrainCommandHistory;
  badge?: TileBadge;
}

/** A {@link BrainTile} wrapped with a context menu offering insert/replace/delete and tile-specific edit actions. */
export function BrainTileEditor({ tileDef, tileIndex, side, ruleDef, commandHistory, badge }: BrainTileEditorProps) {
  const armedTarget = useArmedTargetController();
  const tileTarget = isTileTargetForTile(armedTarget.target, ruleDef, side, tileIndex) ? armedTarget.target : null;
  const armedHintId = useId();
  const [showEditFormatDialog, setShowEditFormatDialog] = useState(false);
  const [showRenameVariableDialog, setShowRenameVariableDialog] = useState(false);
  const { onTileHelp, brainServices } = useBrainEditorConfig();

  const isNumericLiteral =
    tileDef.kind === "literal" && (tileDef as BrainTileLiteralDef).valueType === CoreTypeIds.Number;
  const isVariable = tileDef.kind === "variable";

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
    side,
    onComplete: armedTarget.disarm,
  });

  const [canPaste, setCanPaste] = useState(hasTileInClipboard());

  useEffect(() => {
    return onTileClipboardChanged(() => setCanPaste(hasTileInClipboard()));
  }, []);

  const handleCopyTile = () => {
    copyTileToClipboard(tileDef, ruleDef.brain());
    toast.success("Tile copied");
  };

  const handlePasteTileBefore = () => {
    const command = new PasteTileBeforeCommand(ruleDef, side, tileIndex, (destBrain) =>
      importTileFromClipboard(destBrain, brainServices)
    );
    commandHistory.executeCommand(command);
  };

  const handleDeleteTile = () => {
    const command = new RemoveTileCommand(ruleDef, side, tileIndex);
    commandHistory.executeCommand(command);
  };

  const handleInsertBefore = () => {
    armedTarget.arm({
      ruleDef,
      side,
      mode: "insert",
      tileIndex,
      onTileSelected: (picked: IBrainTileDef) =>
        handleTileSelectedWithVariable(picked, (tile) => {
          const command = new InsertTileCommand(ruleDef, side, tileIndex, tile);
          commandHistory.executeCommand(command);
        }),
    });
  };

  const handleReplaceTile = () => {
    armedTarget.arm({
      ruleDef,
      side,
      mode: "replace",
      tileIndex,
      onTileSelected: (picked: IBrainTileDef) =>
        handleTileSelectedWithVariable(picked, (tile) => {
          const command = new ReplaceTileCommand(ruleDef, side, tileIndex, tile);
          commandHistory.executeCommand(command);
        }),
    });
  };

  const handleEditFormat = () => {
    setShowEditFormatDialog(true);
  };

  const handleRenameVariable = () => {
    setShowRenameVariableDialog(true);
  };

  const handleRenameVariableSubmit = (newName: string) => {
    const varTileDef = tileDef as BrainTileVariableDef;
    const brainDef = ruleDef.brain();
    if (!brainDef) return;

    const catalog = brainDef.catalog();
    const conflict = catalog.find((td) => {
      if (td.kind !== "variable") return false;
      const vd = td as BrainTileVariableDef;
      return vd.varName === newName && vd.varType === varTileDef.varType && vd.uniqueId !== varTileDef.uniqueId;
    });
    if (conflict) {
      toast.error("Variable already exists");
      return;
    }

    const command = new RenameVariableCommand(brainDef, varTileDef, newName);
    commandHistory.executeCommand(command);
    setShowRenameVariableDialog(false);
  };

  const handleEditFormatSubmit = (newFormat: LiteralDisplayFormat) => {
    const literalDef = tileDef as BrainTileLiteralDef;
    let newTileDef: IBrainTileDef = new BrainTileLiteralDef(
      literalDef.valueType,
      literalDef.value,
      {
        valueLabel: literalDef.valueLabel,
        displayFormat: newFormat,
      },
      brainServices!
    );
    const catalog = ruleDef.brain()?.catalog();
    if (catalog) {
      const existing = catalog.get(newTileDef.tileId);
      if (existing) {
        newTileDef = existing;
      } else {
        catalog.registerTileDef(newTileDef);
      }
    }
    const command = new ReplaceTileCommand(ruleDef, side, tileIndex, newTileDef);
    commandHistory.executeCommand(command);
    setShowEditFormatDialog(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <BrainTile
            tileDef={tileDef}
            side={side}
            badge={badge}
            aria-haspopup="menu"
            aria-describedby={tileTarget ? armedHintId : undefined}
            className={tileTarget ? "ring-4 ring-amber-300/90" : ""}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={handleInsertBefore}>Insert Before</DropdownMenuItem>
          <DropdownMenuItem onClick={handleReplaceTile}>Replace Tile</DropdownMenuItem>
          {isNumericLiteral && <DropdownMenuItem onClick={handleEditFormat}>Edit Format</DropdownMenuItem>}
          {isVariable && <DropdownMenuItem onClick={handleRenameVariable}>Rename...</DropdownMenuItem>}
          <DropdownMenuItem onClick={handleCopyTile}>Copy Tile</DropdownMenuItem>
          <DropdownMenuItem onClick={handlePasteTileBefore} disabled={!canPaste}>
            Paste Before
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDeleteTile}>Delete Tile</DropdownMenuItem>
          {onTileHelp && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onTileHelp(tileDef)}>Help</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {tileTarget && (
        <span id={armedHintId} className="sr-only">
          {tileTarget.mode === "replace" ? "armed to be replaced" : "armed to insert a tile before it"}
        </span>
      )}

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

      {showEditFormatDialog && isNumericLiteral && (
        <EditLiteralFormatDialog
          isOpen={showEditFormatDialog}
          literalDef={tileDef as BrainTileLiteralDef}
          onOpenChange={(open) => {
            if (!open) setShowEditFormatDialog(false);
          }}
          onSubmit={handleEditFormatSubmit}
        />
      )}

      {showRenameVariableDialog && isVariable && (
        <RenameVariableDialog
          isOpen={showRenameVariableDialog}
          initialName={(tileDef as BrainTileVariableDef).varName}
          onOpenChange={(open) => {
            if (!open) setShowRenameVariableDialog(false);
          }}
          onSubmit={handleRenameVariableSubmit}
        />
      )}
    </>
  );
}
