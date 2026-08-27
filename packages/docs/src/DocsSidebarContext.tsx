import { assertUnreachable } from "@wendoo/core";
import type { BrainServices, IBrainTileDef, ITileCatalog } from "@wendoo/core/brain";
import type { EditorMode } from "@wendoo/ui/brain-editor/editor-mode";
import type { TileSourceLibrary } from "@wendoo/ui/brain-editor/tile-library-groups";
import { resolveTileVisualFrom } from "@wendoo/ui/brain-editor/tile-visual-utils";
import type { TileVisual } from "@wendoo/ui/brain-editor/types";
import type { PrintTransport } from "@wendoo/ui/print/standalone-print-document";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { DocsRegistry } from "./DocsRegistry";

/**
 * Identifier of the active sidebar tab. `tiles`, `patterns` and `concepts` are
 * collections of registry entries a reader navigates into; `keyboard` is a
 * single reference page built from the editor's accelerator registry and holds
 * no registry entries of its own.
 */
export type DocTab = "tiles" | "patterns" | "concepts" | "keyboard";

interface DocsSidebarContextValue {
  isOpen: boolean;
  activeTab: DocTab;
  registry: DocsRegistry;
  tileCatalog: ITileCatalog | undefined;
  brainServices: BrainServices | undefined;
  /** Installed libraries of the active project; the tiles tab subgroups entries attributed to them. */
  libraries: readonly TileSourceLibrary[] | undefined;
  /** App-supplied friendly type names keyed by type id. */
  dataTypeNames: ReadonlyMap<string, string> | undefined;
  /** App-supplied type icon URLs keyed by type id. */
  dataTypeIcons: ReadonlyMap<string, string> | undefined;
  /** Whether panel entries and the panel header link to the app's standalone docs pages. */
  showDocsPageLinks: boolean;
  /**
   * Sink for the printable doc-page document when the host cannot open the
   * browser print dialog; when absent, printing calls `window.print()`.
   */
  printTransport: PrintTransport | undefined;
  resolveTileVisual: (tileDef: IBrainTileDef) => TileVisual | undefined;
  /** The key of the entry currently shown in detail view, or null for list view. */
  navKey: string | null;
  /** The tab that the detail view belongs to (only meaningful when navKey is set). */
  navTab: DocTab | null;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setTab: (tab: DocTab) => void;
  /** Navigate to a specific entry's detail view. */
  navigateToEntry: (tab: DocTab, key: string) => void;
  /** Return to the list view. */
  navigateBack: () => void;
  /** Open the sidebar to a specific tile's doc page. Always opens the panel. */
  openDocsForTile: (tileDef: IBrainTileDef) => void;
  /**
   * The context the brain editor's keyboard stands in, or undefined while no
   * editor stands. The keyboard help page reads it; nothing else does.
   */
  editorMode: EditorMode | undefined;
  /** Records the editor's current mode. Pass as `docsIntegration.reportMode`. */
  reportEditorMode: (mode: EditorMode | undefined) => void;
}

const DocsSidebarContext = createContext<DocsSidebarContextValue | null>(null);

interface DocsSidebarProviderProps {
  children: ReactNode;
  registry?: DocsRegistry;
  tileCatalog?: ITileCatalog;
  brainServices?: BrainServices;
  /** Installed libraries of the active project; the tiles tab subgroups entries attributed to them. */
  libraries?: readonly TileSourceLibrary[];
  /** App-supplied friendly type names keyed by type id. */
  dataTypeNames?: ReadonlyMap<string, string>;
  /** App-supplied type icon URLs keyed by type id. */
  dataTypeIcons?: ReadonlyMap<string, string>;
  /** Whether panel entries and the panel header link to the app's standalone docs pages (default true). */
  showDocsPageLinks?: boolean;
  /**
   * Sink for the printable doc-page document when the host cannot open the
   * browser print dialog; when absent, printing calls `window.print()`.
   */
  printTransport?: PrintTransport;
  resolveTileVisual?: (tileDef: IBrainTileDef) => TileVisual | undefined;
  /** Initial active tab (defaults to "tiles"). */
  initialTab?: DocTab;
  /** Initial detail-view key (defaults to null -- list view). */
  initialNavKey?: string | null;
  /** Initial detail-view tab (defaults to null). */
  initialNavTab?: DocTab | null;
}

/**
 * Context provider that backs the docs sidebar's open state, active tab,
 * navigation stack, registry, and tile-visual resolution.
 */
export function DocsSidebarProvider({
  children,
  registry: externalRegistry,
  tileCatalog: externalTileCatalog,
  brainServices: externalBrainServices,
  libraries,
  dataTypeNames,
  dataTypeIcons,
  showDocsPageLinks,
  printTransport,
  resolveTileVisual: resolveTileVisualProp,
  initialTab,
  initialNavKey,
  initialNavTab,
}: DocsSidebarProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DocTab>(initialTab ?? "tiles");
  const [navKey, setNavKey] = useState<string | null>(initialNavKey ?? null);
  const [navTab, setNavTab] = useState<DocTab | null>(initialNavTab ?? null);
  const registry = useMemo(() => externalRegistry ?? new DocsRegistry(), [externalRegistry]);
  const tileCatalog = useMemo(() => externalTileCatalog, [externalTileCatalog]);
  const resolveTileVisual = useCallback(
    (tileDef: IBrainTileDef): TileVisual | undefined => resolveTileVisualFrom(resolveTileVisualProp, tileDef),
    [resolveTileVisualProp]
  );

  const navigateToEntry = useCallback((tab: DocTab, key: string) => {
    setActiveTab(tab);
    setNavKey(key);
    setNavTab(tab);
  }, []);

  const navigateBack = useCallback(() => {
    setNavKey(null);
    setNavTab(null);
  }, []);

  const openDocsForTile = useCallback((tileDef: IBrainTileDef) => {
    setIsOpen(true);
    // Variable and literal tiles are dynamic (one per variable/value) and
    // don't have individual tile doc pages. Redirect to the relevant concept.
    switch (tileDef.kind) {
      case "variable":
        setActiveTab("concepts");
        setNavKey("variables");
        setNavTab("concepts");
        break;
      case "literal":
        setActiveTab("concepts");
        setNavKey("literals");
        setNavTab("concepts");
        break;
      case "undefined":
      case "sensor":
      case "actuator":
      case "parameter":
      case "operator":
      case "factory":
      case "controlFlow":
      case "modifier":
      case "accessor":
      case "page":
      case "output":
      case "missing":
        setActiveTab("tiles");
        setNavKey(tileDef.tileId);
        setNavTab("tiles");
        break;
      default:
        assertUnreachable(tileDef.kind);
    }
  }, []);

  const handleSetTab = useCallback((tab: DocTab) => {
    setActiveTab(tab);
    setNavKey(null);
    setNavTab(null);
  }, []);

  const [editorMode, setEditorMode] = useState<EditorMode | undefined>(undefined);
  const reportEditorMode = useCallback((mode: EditorMode | undefined) => {
    setEditorMode(mode);
    // The keyboard tab is withdrawn with the editor that stands it, so a reader
    // left on it is moved off before it disappears from under them.
    if (mode === undefined) setActiveTab((tab) => (tab === "keyboard" ? "tiles" : tab));
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((o) => !o), []);

  const value: DocsSidebarContextValue = {
    isOpen,
    activeTab,
    registry,
    tileCatalog,
    brainServices: externalBrainServices,
    libraries,
    dataTypeNames,
    dataTypeIcons,
    showDocsPageLinks: showDocsPageLinks ?? true,
    printTransport,
    resolveTileVisual,
    navKey,
    navTab,
    open,
    close,
    toggle,
    setTab: handleSetTab,
    navigateToEntry,
    navigateBack,
    openDocsForTile,
    editorMode,
    reportEditorMode,
  };

  return <DocsSidebarContext.Provider value={value}>{children}</DocsSidebarContext.Provider>;
}

/** Access the docs sidebar context. Throws when used outside a {@link DocsSidebarProvider}. */
export function useDocsSidebar(): DocsSidebarContextValue {
  const ctx = useContext(DocsSidebarContext);
  if (!ctx) {
    throw new Error("useDocsSidebar must be used within a DocsSidebarProvider");
  }
  return ctx;
}

/** Read the tile catalog from the docs sidebar context. */
export function useDocsTileCatalog(): ITileCatalog | undefined {
  return useDocsSidebar().tileCatalog;
}

/** Read the tile-visual resolver from the docs sidebar context. */
export function useDocsResolveTileVisual(): (tileDef: IBrainTileDef) => TileVisual | undefined {
  return useDocsSidebar().resolveTileVisual;
}

/** Read the brain services from the docs sidebar context. */
export function useDocsBrainServices(): BrainServices | undefined {
  return useDocsSidebar().brainServices;
}
