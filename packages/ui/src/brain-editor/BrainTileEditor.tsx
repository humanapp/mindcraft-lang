import type { IBrainTileDef, LiteralDisplayFormat, RuleSide } from "@mindcraft-lang/core/brain";
import type { BrainCommandHistory, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import {
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { isTileTargetForTile, useArmedTargetController } from "./ArmedTargetContext";
import { useBrainEditorConfig } from "./BrainEditorContext";
import { BrainTile } from "./BrainTile";
import { EditLiteralFormatDialog } from "./EditLiteralFormatDialog";
import type { EditPointPosition } from "./edit-point";
import { editPointPositionOf } from "./edit-point";
import { RenameVariableDialog } from "./RenameVariableDialog";
import type { TileBadge } from "./tile-badges";
import {
  copyTileToClipboard,
  hasTileInClipboard,
  importTileFromClipboard,
  onTileClipboardChanged,
} from "./tile-clipboard";

/** What the armed edit point on this tile is described as, by the position it sits at. */
const editPointHints: Record<EditPointPosition, string> = {
  before: "armed to insert a tile before it",
  replace: "armed to be replaced",
  after: "armed to insert a tile after it",
};

interface BrainTileEditorProps {
  tileDef: IBrainTileDef;
  tileIndex: number;
  side: RuleSide;
  ruleDef: BrainRuleDef;
  commandHistory: BrainCommandHistory;
  badge?: TileBadge;
  /** Arms the edit point on this tile at `position`, which the candidate strip then serves. */
  armEditPoint: (position: EditPointPosition) => void;
}

/**
 * A {@link BrainTile} carrying the gestures of a placed tile: a tap arms the
 * edit point in the tile's place, and a right-click or touch long-press opens
 * the tile menu of insert/replace/delete and the tile-specific edit actions.
 */
export function BrainTileEditor({
  tileDef,
  tileIndex,
  side,
  ruleDef,
  commandHistory,
  badge,
  armEditPoint,
}: BrainTileEditorProps) {
  const armedTarget = useArmedTargetController();
  const tileTarget = isTileTargetForTile(armedTarget.target, ruleDef, side, tileIndex) ? armedTarget.target : null;
  const armedHintId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showEditFormatDialog, setShowEditFormatDialog] = useState(false);
  const [showRenameVariableDialog, setShowRenameVariableDialog] = useState(false);
  const { onTileHelp, brainServices } = useBrainEditorConfig();

  const isNumericLiteral =
    tileDef.kind === "literal" && (tileDef as BrainTileLiteralDef).valueType === CoreTypeIds.Number;
  const isVariable = tileDef.kind === "variable";

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

  // A long-press opens the menu and the touch still reports a click on release,
  // which must not also arm the edit point the tap arms.
  const handleTileTap = () => {
    if (menuOpen) return;
    armEditPoint("replace");
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
      <ContextMenu onOpenChange={setMenuOpen}>
        <ContextMenuTrigger asChild>
          <BrainTile
            tileDef={tileDef}
            side={side}
            badge={badge}
            aria-haspopup="menu"
            aria-describedby={tileTarget ? armedHintId : undefined}
            onClick={handleTileTap}
            className={tileTarget ? "ring-4 ring-amber-300/90" : ""}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => armEditPoint("before")}>Insert Before</ContextMenuItem>
          <ContextMenuItem onClick={() => armEditPoint("replace")}>Replace Tile</ContextMenuItem>
          {isNumericLiteral && <ContextMenuItem onClick={handleEditFormat}>Edit Format</ContextMenuItem>}
          {isVariable && <ContextMenuItem onClick={handleRenameVariable}>Rename...</ContextMenuItem>}
          <ContextMenuItem onClick={handleCopyTile}>Copy Tile</ContextMenuItem>
          <ContextMenuItem onClick={handlePasteTileBefore} disabled={!canPaste}>
            Paste Before
          </ContextMenuItem>
          <ContextMenuItem onClick={handleDeleteTile}>Delete Tile</ContextMenuItem>
          {onTileHelp && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onTileHelp(tileDef)}>Help</ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {tileTarget && (
        <span id={armedHintId} className="sr-only">
          {editPointHints[editPointPositionOf(tileTarget, tileIndex)]}
        </span>
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
