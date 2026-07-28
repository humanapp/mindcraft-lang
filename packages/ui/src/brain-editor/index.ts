// Context and types

export type { BrainCommand } from "@mindcraft-lang/core/brain/model";
// Commands (relocated to @mindcraft-lang/core/brain/model; re-exported for API stability)
export {
  AddPageCommand,
  AddTileCommand,
  BrainCommandHistory,
  DeleteRuleCommand,
  IndentRuleCommand,
  InsertRuleBeforeCommand,
  InsertTileCommand,
  MoveRuleDownCommand,
  MoveRuleUpCommand,
  OutdentRuleCommand,
  PasteRuleAboveCommand,
  PasteTileBeforeCommand,
  RemovePageCommand,
  RemoveTileCommand,
  RenameBrainCommand,
  RenamePageCommand,
  RenameVariableCommand,
  ReplaceBrainCommand,
  ReplaceLastPageCommand,
  ReplaceTileCommand,
} from "@mindcraft-lang/core/brain/model";
// Action call-spec arg entries
export type { ActionArgEntry, ActionArgTileEntry, ActionArgTypeEntry, TypeDisplaySources } from "./action-arg-tiles";
export { getActionArgEntries, resolveTypeDisplayName } from "./action-arg-tiles";
export type { BrainEditorConfig, CustomLiteralType } from "./BrainEditorContext";
export { BrainEditorProvider, useBrainEditorConfig } from "./BrainEditorContext";
export type { BrainEditorDialogProps } from "./BrainEditorDialog";
// Components
export { BrainEditorDialog } from "./BrainEditorDialog";
export { BrainPageEditor } from "./BrainPageEditor";
export { BrainPrintDialog } from "./BrainPrintDialog";
export { BrainPrintTextView } from "./BrainPrintTextView";
export { BrainPrintView } from "./BrainPrintView";
export { BrainRuleEditor } from "./BrainRuleEditor";
export { BrainTile } from "./BrainTile";
export { BrainTileEditor } from "./BrainTileEditor";
export type { BrainTilePickerDialogProps } from "./BrainTilePickerDialog";
export { BrainTilePickerDialog } from "./BrainTilePickerDialog";
export {
  copyBrainToClipboard,
  getBrainFromClipboard,
  hasBrainInClipboard,
  onBrainClipboardChanged,
} from "./brain-clipboard";
export { CreateLiteralDialog } from "./CreateLiteralDialog";
export { CreateVariableDialog } from "./CreateVariableDialog";
export { DisplayFormatPicker } from "./DisplayFormatPicker";
export { EditLiteralFormatDialog } from "./EditLiteralFormatDialog";
// Hooks
export { useRuleCapabilities, useRuleOutputKeys } from "./hooks/useRuleCapabilities";
export { useTileSelection } from "./hooks/useTileSelection";
export { RenameVariableDialog } from "./RenameVariableDialog";
// Clipboard utilities
export {
  copyRuleToClipboard,
  deserializeAllRulesFromClipboard,
  deserializeRuleFromClipboard,
  hasRuleInClipboard,
  onClipboardChanged,
} from "./rule-clipboard";
export { TileValue } from "./TileValue";
export type { TileBadge } from "./tile-badges";
// Tile badges
export { buildNodeMap, computeTileBadges } from "./tile-badges";
export {
  copyTileToClipboard,
  hasTileInClipboard,
  importTileFromClipboard,
  onTileClipboardChanged,
} from "./tile-clipboard";
export type { LibraryTileCluster, LibraryTileGroups, TileSourceLibrary } from "./tile-library-groups";
// Library attribution
export { groupTilesByLibrary, tileSourceNamespace } from "./tile-library-groups";
export { formatValue } from "./tile-value-utils";
export type { TileColorDef, TileVisual } from "./types";
