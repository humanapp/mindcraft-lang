import type { IBrainTileDef, LiteralDisplayFormat, RuleSide } from "@wendoo/core/brain";
import type { BrainCommandHistory, BrainRuleDef } from "@wendoo/core/brain/model";
import { RenameVariableCommand, ReplaceTileCommand } from "@wendoo/core/brain/model";
import { BrainTileLiteralDef, type BrainTileVariableDef } from "@wendoo/core/brain/tiles";
import { BookOpen, MoreHorizontal } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { kStripPopupAttribute } from "./BrainCandidateStrip";
import { useBrainEditorConfig } from "./BrainEditorContext";
import { CreateLiteralDialog } from "./CreateLiteralDialog";
import { EditLiteralFormatDialog } from "./EditLiteralFormatDialog";
import { literalWord, takenLiteralNamesAround } from "./literal-naming";
import { RenameVariableDialog } from "./RenameVariableDialog";
import { literalForkSeed } from "./strip-commands";
import {
  buildTileMenuEntries,
  duplicateLiteralValue,
  editLiteralValue,
  type LiteralValueSubmitOptions,
  literalValueEditor,
  type TileMenuEntry,
  TileMenuEntryKeys,
} from "./tile-menu-model";

/** `MouseEvent.button` of the press a right-click reports. */
const kSecondaryMouseButton = 2;

/** The box the offering's position row draws the tile's own control in. */
const kRowControlClasses =
  "inline-flex min-h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 border-brain-ink/15 bg-brain-recess/30 text-brain-ink/70 transition-colors hover:border-brain-ink/40 hover:text-brain-ink";

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
 * up no tile documentation together yield no entries, which both menu shapes
 * read as nothing to open.
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
  const [showEditValueDialog, setShowEditValueDialog] = useState(false);
  const [showDuplicateValueDialog, setShowDuplicateValueDialog] = useState(false);
  const [showRenameVariableDialog, setShowRenameVariableDialog] = useState(false);
  const editorConfig = useBrainEditorConfig();
  const { onTileDocs, brainServices, customLiteralTypes, tileCatalogs } = editorConfig;

  const literalDef = tileDef.kind === "literal" ? (tileDef as BrainTileLiteralDef) : undefined;
  const variableDef = tileDef.kind === "variable" ? (tileDef as BrainTileVariableDef) : undefined;
  const valueEditor = literalValueEditor(
    tileDef,
    customLiteralTypes,
    brainServices?.edit.tiles,
    ruleDef.brain()?.catalog()
  );

  const handleRenameVariableSubmit = (newName: string) => {
    if (!variableDef) return;
    const brainDef = ruleDef.brain();
    if (!brainDef) return;

    const catalog = brainDef.catalog();
    const conflict = catalog.find((td) => {
      if (td.kind !== "variable") return false;
      const vd = td as BrainTileVariableDef;
      return vd.varName === newName && vd.varType === variableDef.varType && vd.uniqueId !== variableDef.uniqueId;
    });
    if (conflict) {
      toast.error("Variable already exists");
      return;
    }

    commandHistory.executeCommand(new RenameVariableCommand(brainDef, variableDef, newName));
    setShowRenameVariableDialog(false);
  };

  const handleEditFormatSubmit = (newFormat: LiteralDisplayFormat) => {
    if (!literalDef) return;
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

  /** What either literal-value dialog's submission acts on. */
  const submitOptions = (value: unknown, displayName?: string): LiteralValueSubmitOptions | undefined =>
    valueEditor && { ruleDef, side, tileIndex, editor: valueEditor, value, displayName, commandHistory };

  const handleEditValueSubmit = (value: unknown, _displayFormat?: LiteralDisplayFormat, displayName?: string) => {
    const options = submitOptions(value, displayName);
    if (options) editLiteralValue(options);
    setShowEditValueDialog(false);
  };

  const handleDuplicateValueSubmit = (value: unknown, _displayFormat?: LiteralDisplayFormat, displayName?: string) => {
    const options = submitOptions(value, displayName);
    if (options) duplicateLiteralValue(options);
    setShowDuplicateValueDialog(false);
  };

  // The seed the fork of this literal opens on, read as its dialog is built.
  const forkSeed = () =>
    valueEditor === undefined
      ? undefined
      : literalForkSeed(
          valueEditor.literalDef,
          takenLiteralNamesAround(tileCatalogs, ruleDef.brain()?.catalog(), valueEditor.literalDef.valueType)
        );

  const entries: TileMenuEntry[] = buildTileMenuEntries(tileDef, valueEditor, {
    editFormat: () => setShowEditFormatDialog(true),
    editValue: () => setShowEditValueDialog(true),
    duplicateValue: () => setShowDuplicateValueDialog(true),
    renameVariable: () => setShowRenameVariableDialog(true),
    openDocs: onTileDocs ? () => onTileDocs(tileDef) : undefined,
  });

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
      {showEditFormatDialog && literalDef && (
        <EditLiteralFormatDialog
          isOpen={showEditFormatDialog}
          literalDef={literalDef}
          onOpenChange={(open) => {
            if (!open) setShowEditFormatDialog(false);
          }}
          onCloseAutoFocus={handleCloseAutoFocus}
          onSubmit={handleEditFormatSubmit}
        />
      )}
      {showEditValueDialog && valueEditor && (
        <CreateLiteralDialog
          isOpen={showEditValueDialog}
          title="Edit Value"
          literalType={valueEditor.literalDef.valueType}
          initialValue={valueEditor.literalDef.value}
          initialName={literalWord(valueEditor.literalDef)}
          onOpenChange={(open) => {
            if (!open) setShowEditValueDialog(false);
          }}
          onCloseAutoFocus={handleCloseAutoFocus}
          onSubmit={handleEditValueSubmit}
        />
      )}
      {showDuplicateValueDialog && valueEditor && (
        <CreateLiteralDialog
          isOpen={showDuplicateValueDialog}
          title="Duplicate"
          literalType={valueEditor.literalDef.valueType}
          initialValue={valueEditor.literalDef.value}
          initialName={forkSeed()?.displayName}
          onOpenChange={(open) => {
            if (!open) setShowDuplicateValueDialog(false);
          }}
          onCloseAutoFocus={handleCloseAutoFocus}
          onSubmit={handleDuplicateValueSubmit}
        />
      )}
      {showRenameVariableDialog && variableDef && (
        <RenameVariableDialog
          isOpen={showRenameVariableDialog}
          initialName={variableDef.varName}
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
 *
 * The panel the entries are drawn in is built in the same render that first
 * opens the tile's menu, and stands from then on; a tile no one has opened
 * renders no panel.
 */
export function BrainTileMenu({
  children,
  onOpenChange,
  ...props
}: BrainTileMenuProps & { children: ReactNode; onOpenChange: (open: boolean) => void }) {
  const tileRef = useRef<HTMLSpanElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isBuilt, setIsBuilt] = useState(false);
  const { entries, dialogs } = useTileMenu(props, () => tileRef.current);
  if (entries.length === 0) return <>{children}</>;

  const handleOpenChange = (open: boolean) => {
    if (open) setIsBuilt(true);
    setIsOpen(open);
    onOpenChange(open);
  };

  return (
    <>
      <ContextMenu open={isOpen} onOpenChange={handleOpenChange}>
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
        {isBuilt && (
          <ContextMenuContent {...{ [kStripPopupAttribute]: "" }}>
            {entries.map((entry) => (
              <ContextMenuItem key={entry.key} onClick={entry.run}>
                {entry.label}
              </ContextMenuItem>
            ))}
          </ContextMenuContent>
        )}
      </ContextMenu>
      {dialogs}
    </>
  );
}

/**
 * The control the offering's position row stands for the tile, which is where
 * the keyboard and touch both reach it without a gesture. A tile offering only
 * its documentation stands a button opening it directly, marked
 * `data-strip-tile-docs`; a tile offering more stands the menu, marked
 * `data-strip-tile-menu`. Renders nothing for a tile offering no entry.
 */
export function BrainTileMenuButton(props: BrainTileMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { entries, dialogs } = useTileMenu(props, () => triggerRef.current);
  if (entries.length === 0) return null;
  const docsOnly = entries.length === 1 && entries[0].key === TileMenuEntryKeys.Docs ? entries[0] : undefined;
  if (docsOnly) {
    return (
      <button
        ref={triggerRef}
        type="button"
        data-strip-tile-docs=""
        aria-label="Tile documentation"
        title="Tile documentation"
        onClick={docsOnly.run}
        className={kRowControlClasses}
      >
        <BookOpen className="h-5 w-5 shrink-0" aria-hidden="true" />
      </button>
    );
  }
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
            className={kRowControlClasses}
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
