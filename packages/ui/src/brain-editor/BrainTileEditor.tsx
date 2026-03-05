import { CoreTypeIds, type IBrainTileDef, type LiteralDisplayFormat, RuleSide } from "@mindcraft-lang/core/brain";
import type { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileLiteralDef } from "@mindcraft-lang/core/brain/tiles";
import { useEffect, useState } from "react";
import { useDocsSidebar } from "../docs/DocsSidebarContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
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
import { EditLiteralFormatDialog } from "./EditLiteralFormatDialog";
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
  const [showEditFormatDialog, setShowEditFormatDialog] = useState(false);
  const availableCapabilities = useRuleCapabilities(ruleDef);
  const { openDocsForTile } = useDocsSidebar();

  const isNumericLiteral =
    tileDef.kind === "literal" && (tileDef as BrainTileLiteralDef).valueType === CoreTypeIds.Number;

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

  const handleEditFormat = () => {
    setShowEditFormatDialog(true);
  };

  const handleEditFormatSubmit = (newFormat: LiteralDisplayFormat) => {
    const literalDef = tileDef as BrainTileLiteralDef;
    let newTileDef: IBrainTileDef = new BrainTileLiteralDef(literalDef.valueType, literalDef.value, {
      valueLabel: literalDef.valueLabel,
      displayFormat: newFormat,
    });
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
          {isNumericLiteral && <DropdownMenuItem onClick={handleEditFormat}>Edit Format</DropdownMenuItem>}
          <DropdownMenuItem onClick={handleCopyTile}>Copy Tile</DropdownMenuItem>
          <DropdownMenuItem onClick={handlePasteTileBefore} disabled={!canPaste}>
            Paste Before
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDeleteTile}>Delete Tile</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openDocsForTile(tileDef.tileId)}>Help</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {pickerMode &&
        (() => {
          const tileSet = side === RuleSide.When ? ruleDef.when() : ruleDef.do();
          const isInsert = pickerMode === "insert";
          return (
            <BrainTilePickerDialog
              isOpen={true}
              side={side}
              localCatalog={ruleDef.brain()?.catalog()}
              expr={isInsert ? undefined : tileSet.expr()}
              replaceTileIndex={isInsert ? undefined : tileIndex}
              existingTiles={isInsert ? tileSet.tiles().slice(0, tileIndex) : tileSet.tiles()}
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
    </>
  );
}
