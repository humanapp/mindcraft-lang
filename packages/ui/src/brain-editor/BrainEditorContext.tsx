import type { BrainServices, IBrainTileDef, ITileCatalog } from "@mindcraft-lang/core/brain";
import type { BrainDef } from "@mindcraft-lang/core/brain/model";
import { createContext, type ReactNode, useContext } from "react";
import type { TileVisual } from "./types";

/**
 * Describes a custom literal type that the host app supports beyond the
 * core String/Number types. The brain editor uses this to render additional
 * input fields in CreateLiteralDialog and to format values in TileValue.
 */
export interface CustomLiteralType {
  /** The type ID string (e.g. "struct:vector2"). */
  typeId: string;
  /** Human-readable description shown in the create-literal dialog. */
  description: string;
  /** Returns true when the current input state is valid. */
  isValid: (state: Record<string, string>) => boolean;
  /** Parse the input state into the runtime value. */
  parseValue: (state: Record<string, string>) => unknown;
  /** Render the input fields for this literal type. */
  renderInputFields: (
    state: Record<string, string>,
    onChange: (key: string, value: string) => void,
    onSubmit: () => void
  ) => ReactNode;
  /** Format a value for display in tiles. */
  formatValue: (value: unknown) => string;
}

/**
 * Configuration injected by the host app into the brain editor.
 *
 * This decouples the shared brain editor UI from app-specific concerns
 * like tile data type icons, variable factory detection, and custom types.
 */
export interface BrainEditorConfig {
  /** Maps data type IDs to icon URLs (e.g. CoreTypeIds.Number -> "/assets/.../number.svg"). */
  dataTypeIcons: ReadonlyMap<string, string>;
  /** Maps data type IDs to human-readable names (e.g. CoreTypeIds.Number -> "number"). */
  dataTypeNames: ReadonlyMap<string, string>;
  /** Resolves app-owned tile presentation without mutating core semantic catalogs. */
  resolveTileVisual?: (tileDef: IBrainTileDef) => TileVisual | undefined;
  /** Returns true if the given tile ID is an app-specific variable factory tile. */
  isAppVariableFactoryTileId?: (tileId: string) => boolean;
  /** Custom literal types beyond the core String/Number. */
  customLiteralTypes: ReadonlyArray<CustomLiteralType>;
  /** Optional callback to load a default brain (replaces the archetype-specific load). */
  getDefaultBrain?: () => BrainDef | undefined;
  /** Optional BrainServices instance for direct access to tiles, types, etc. */
  brainServices?: BrainServices;
  /** Tile catalogs from the host environment (core + user tile catalogs). */
  tileCatalogs?: readonly ITileCatalog[];
  /** Optional callback invoked when the user requests help for a tile (e.g. right-click -> Help). */
  onTileHelp?: (tileDef: IBrainTileDef) => void;
  /** Optional docs sidebar integration for the brain editor dialog toolbar. */
  docsIntegration?: {
    isOpen: boolean;
    toggle: () => void;
    close: () => void;
  };
}

const BrainEditorContext = createContext<BrainEditorConfig | null>(null);

/** Provider for the brain editor configuration. Wrap any subtree that uses brain editor components. */
export function BrainEditorProvider({ config, children }: { config: BrainEditorConfig; children: ReactNode }) {
  return <BrainEditorContext.Provider value={config}>{children}</BrainEditorContext.Provider>;
}

/** Read the active {@link BrainEditorConfig}. Throws when used outside a {@link BrainEditorProvider}. */
export function useBrainEditorConfig(): BrainEditorConfig {
  const config = useContext(BrainEditorContext);
  if (!config) {
    throw new Error("useBrainEditorConfig must be used within a BrainEditorProvider");
  }
  return config;
}
