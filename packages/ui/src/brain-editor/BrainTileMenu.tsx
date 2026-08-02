import type { IBrainTileDef, LiteralDisplayFormat, RuleSide } from "@mindcraft-lang/core/brain";
import type { BrainCommandHistory, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { RenameVariableCommand, ReplaceTileCommand } from "@mindcraft-lang/core/brain/model";
import { BrainTileLiteralDef, type BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import { CoreTypeIds } from "@mindcraft-lang/core/runtime";
import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { kStripPopupAttribute } from "./BrainCandidateStrip";
import { useBrainEditorConfig } from "./BrainEditorContext";
import { EditLiteralFormatDialog } from "./EditLiteralFormatDialog";
import { RenameVariableDialog } from "./RenameVariableDialog";

/** `MouseEvent.button` of the press a right-click reports. */
const kSecondaryMouseButton = 2;

/** One thing the menu offers to do to the tile it stands on. */
interface TileMenuEntry {
  /** Identifies the entry among the ones the tile offers. */
  readonly key: string;
  /** How the entry reads. */
  readonly label: string;
  /** What choosing it does. */
  readonly run: () => void;
}

/** What a placed tile's menu is built for: the tile, and where in the rule it stands. */
interface BrainTileMenuProps {
  /** The tile the menu acts on. */
  tileDef: IBrainTileDef;
  /** The side of `ruleDef` holding the tile. */
  side: RuleSide;
  /** The tile's place among the tiles of its side, counting from zero. */
  tileIndex: number;
  /** The rule holding the tile. */
  ruleDef: BrainRuleDef;
  /** History every edit the menu makes is recorded on. */
  commandHistory: BrainCommandHistory;
}

/**
 * The entries `props` names, the dialogs those entries open, and the state
 * holding each dialog open. A tile whose kind offers nothing and a host wiring
 * up no tile help together yield no entries, which both menu shapes read as
 * nothing to open.
 *
 * @param props the tile the menu acts on and where in the rule it stands
 * @param menuTrigger the control the menu opens from, which the keyboard is
 * handed back to as a dialog closes; a control no longer rendering leaves the
 * keyboard wherever the dialog's own restoration put it
 */
function useTileMenu(
  props: BrainTileMenuProps,
  menuTrigger: () => HTMLElement | null
): { entries: TileMenuEntry[]; dialogs: ReactNode } {
  const { tileDef, side, tileIndex, ruleDef, commandHistory } = props;
  const [showEditFormatDialog, setShowEditFormatDialog] = useState(false);
  const [showRenameVariableDialog, setShowRenameVariableDialog] = useState(false);
  const editorConfig = useBrainEditorConfig();
  const { onTileHelp, brainServices } = editorConfig;

  const isNumericLiteral =
    tileDef.kind === "literal" && (tileDef as BrainTileLiteralDef).valueType === CoreTypeIds.Number;
  const isVariable = tileDef.kind === "variable";

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

    commandHistory.executeCommand(new RenameVariableCommand(brainDef, varTileDef, newName));
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
    commandHistory.executeCommand(new ReplaceTileCommand(ruleDef, side, tileIndex, newTileDef));
    setShowEditFormatDialog(false);
  };

  const entries: TileMenuEntry[] = [];
  if (isNumericLiteral) {
    entries.push({ key: "format", label: "Edit Format", run: () => setShowEditFormatDialog(true) });
  }
  if (isVariable) {
    entries.push({ key: "rename", label: "Rename...", run: () => setShowRenameVariableDialog(true) });
  }
  if (onTileHelp) {
    entries.push({ key: "help", label: "Help", run: () => onTileHelp(tileDef) });
  }

  // The dialog restores the keyboard to the menu item it was opened from, which
  // stopped rendering with the menu; the trigger the menu itself opened from
  // takes it instead.
  const handleCloseAutoFocus = (event: Event) => {
    const returnTo = menuTrigger();
    if (returnTo === null || !returnTo.isConnected) return;
    event.preventDefault();
    returnTo.focus();
  };

  const dialogs = (
    <>
      {showEditFormatDialog && isNumericLiteral && (
        <EditLiteralFormatDialog
          isOpen={showEditFormatDialog}
          literalDef={tileDef as BrainTileLiteralDef}
          onOpenChange={(open) => {
            if (!open) setShowEditFormatDialog(false);
          }}
          onCloseAutoFocus={handleCloseAutoFocus}
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
          onCloseAutoFocus={handleCloseAutoFocus}
          onSubmit={handleRenameVariableSubmit}
        />
      )}
    </>
  );

  return { entries, dialogs };
}

/**
 * Wraps `children` -- the placed tile itself -- in the tile's menu, opened by a
 * right-click, by Shift+F10 or the Menu key, and by a touch long-press.
 * `onOpenChange` is called with true as the menu opens and false as it closes.
 *
 * A tile offering no entry is rendered with no menu on it at all, and carries
 * no `aria-haspopup`, so nothing announces or opens an empty one.
 */
export function BrainTileMenu({
  children,
  onOpenChange,
  ...props
}: BrainTileMenuProps & { children: ReactNode; onOpenChange: (open: boolean) => void }) {
  const tileRef = useRef<HTMLSpanElement>(null);
  const { entries, dialogs } = useTileMenu(props, () => tileRef.current);
  if (entries.length === 0) return <>{children}</>;
  return (
    <>
      <ContextMenu onOpenChange={onOpenChange}>
        <ContextMenuTrigger
          ref={tileRef}
          asChild
          aria-haspopup="menu"
          // The press that opens the menu acts without taking the keyboard from
          // whatever holds it.
          onMouseDown={(event) => {
            if (event.button === kSecondaryMouseButton) event.preventDefault();
          }}
        >
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent {...{ [kStripPopupAttribute]: "" }}>
          {entries.map((entry) => (
            <ContextMenuItem key={entry.key} onClick={entry.run}>
              {entry.label}
            </ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>
      {dialogs}
    </>
  );
}

/**
 * The control that opens the tile's menu from the offering's position row,
 * which is where the keyboard and touch both reach it without a gesture.
 * Renders nothing for a tile offering no entry.
 */
export function BrainTileMenuButton(props: BrainTileMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { entries, dialogs } = useTileMenu(props, () => triggerRef.current);
  if (entries.length === 0) return null;
  return (
    <>
      {/* The open menu takes no pointer events from the rest of the page, so the rules keep scrolling under it. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            data-strip-tile-menu=""
            aria-label="Tile actions"
            title="Tile actions"
            className="inline-flex min-h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 border-brain-ink/15 bg-brain-recess/30 text-brain-ink/70 transition-colors hover:border-brain-ink/40 hover:text-brain-ink"
          >
            <MoreHorizontal className="h-5 w-5 shrink-0" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent {...{ [kStripPopupAttribute]: "" }}>
          {entries.map((entry) => (
            <DropdownMenuItem key={entry.key} onClick={entry.run}>
              {entry.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialogs}
    </>
  );
}
