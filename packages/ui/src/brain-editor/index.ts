// Context and types

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
export { CreateLiteralDialog } from "./CreateLiteralDialog";
export { CreateVariableDialog } from "./CreateVariableDialog";
export type { BrainCommand } from "./commands";
// Commands
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
  ReplaceLastPageCommand,
  ReplaceTileCommand,
} from "./commands";
// Hooks
export { useRuleCapabilities } from "./hooks/useRuleCapabilities";
export { useTileSelection } from "./hooks/useTileSelection";
// Clipboard utilities
export {
  copyRuleToClipboard,
  deserializeRuleFromClipboard,
  hasRuleInClipboard,
  onClipboardChanged,
} from "./rule-clipboard";
export { formatValue, TileValue } from "./TileValue";
export type { TileBadge } from "./tile-badges";
// Tile badges
export { buildNodeMap, computeTileBadges } from "./tile-badges";
export {
  copyTileToClipboard,
  hasTileInClipboard,
  importTileFromClipboard,
  onTileClipboardChanged,
} from "./tile-clipboard";
export type { TileColorDef, TileVisual } from "./types";
