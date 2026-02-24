import { type IBrainTileDef, RuleSide } from "@mindcraft-lang/core/brain";
import type { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { useEffect, useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { BrainTile } from "./BrainTile";
import { BrainTilePickerDialog } from "./BrainTilePickerDialog";
import { CreateLiteralDialog } from "./CreateLiteralDialog";
import { CreateVariableDialog } from "./CreateVariableDialog";
import {
  type BrainCommandHistory,
  InsertTileCommand,
  PasteTileBeforeCommand,
  RemoveTileCommand,
  ReplaceTileCommand,
} from "./commands";
import { useRuleCapabilities } from "./hooks/useRuleCapabilities";
import { useTileSelection } from "./hooks/useTileSelection";
import type { TileBadge } from "./tile-badges";
import { copyTileToClipboard, hasTileInClipboard, onTileClipboardChanged } from "./tile-clipboard";

interface BrainTileEditorProps {
  tileDef: IBrainTileDef;
  tileIndex: number;
  side: RuleSide;
  ruleDef: BrainRuleDef;
  commandHistory: BrainCommandHistory;
  badge?: TileBadge;
}

export function BrainTileEditor({ tileDef, tileIndex, side, ruleDef, commandHistory, badge }: BrainTileEditorProps) {
  const [pickerMode, setPickerMode] = useState<"insert" | "replace" | null>(null);
  const availableCapabilities = useRuleCapabilities(ruleDef);

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
    onComplete: () => setPickerMode(null),
  });

  const [canPaste, setCanPaste] = useState(hasTileInClipboard());

  useEffect(() => {
    return onTileClipboardChanged(() => setCanPaste(hasTileInClipboard()));
  }, []);

  const handleCopyTile = () => {
    copyTileToClipboard(tileDef, ruleDef.brain());
  };

  const handlePasteTileBefore = () => {
    const command = new PasteTileBeforeCommand(ruleDef, side, tileIndex);
    commandHistory.executeCommand(command);
  };

  const handleDeleteTile = () => {
    const command = new RemoveTileCommand(ruleDef, side, tileIndex);
    commandHistory.executeCommand(command);
  };

  const handleInsertBefore = () => {
    setPickerMode("insert");
  };

  const handleReplaceTile = () => {
    setPickerMode("replace");
  };

  const handlePickerCancel = () => {
    setPickerMode(null);
  };

  const handleTileSelected = (tileDef: IBrainTileDef) => {
    if (!pickerMode) return true;

    return handleTileSelectedWithVariable(tileDef, (tile) => {
      if (pickerMode === "insert") {
        const command = new InsertTileCommand(ruleDef, side, tileIndex, tile);
        commandHistory.executeCommand(command);
      } else if (pickerMode === "replace") {
        const command = new ReplaceTileCommand(ruleDef, side, tileIndex, tile);
        commandHistory.executeCommand(command);
      }
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <BrainTile tileDef={tileDef} side={side} badge={badge} aria-haspopup="menu" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={handleInsertBefore}>Insert Before</DropdownMenuItem>
          <DropdownMenuItem onClick={handleReplaceTile}>Replace Tile</DropdownMenuItem>
          <DropdownMenuItem onClick={handleCopyTile}>Copy Tile</DropdownMenuItem>
          <DropdownMenuItem onClick={handlePasteTileBefore} disabled={!canPaste}>
            Paste Before
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDeleteTile}>Delete Tile</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {pickerMode &&
        (() => {
          const tileSet = side === RuleSide.When ? ruleDef.when() : ruleDef.do();
          return (
            <BrainTilePickerDialog
              isOpen={true}
              side={side}
              localCatalog={ruleDef.brain()?.catalog()}
              expr={tileSet.expr()}
              replaceTileIndex={pickerMode === "replace" ? tileIndex : undefined}
              existingTiles={tileSet.tiles()}
              availableCapabilities={availableCapabilities}
              onTileSelected={handleTileSelected}
              onCancel={handlePickerCancel}
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
    </>
  );
}
