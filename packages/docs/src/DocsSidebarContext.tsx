import {
  type BrainServices,
  type IBrainTileDef,
  type ITileCatalog,
  LiteralDisplayFormats,
} from "@mindcraft-lang/core/brain";
import {
  applyDisplayFormat,
  type BrainTileAccessorDef,
  type BrainTileLiteralDef,
  type BrainTileVariableDef,
  getCatalogFallbackLabel,
} from "@mindcraft-lang/core/brain/tiles";
import type { TileVisual } from "@mindcraft-lang/ui/brain-editor/types";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { DocsRegistry } from "./DocsRegistry";

export type DocTab = "tiles" | "patterns" | "concepts";

interface DocsSidebarContextValue {
  isOpen: boolean;
  activeTab: DocTab;
  registry: DocsRegistry;
  tileCatalog: ITileCatalog | undefined;
  brainServices: BrainServices | undefined;
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
}

const DocsSidebarContext = createContext<DocsSidebarContextValue | null>(null);

function defaultTileLabel(tileDef: IBrainTileDef): string {
  if (tileDef.kind === "literal") {
    const literalDef = tileDef as BrainTileLiteralDef;
    const format = literalDef.displayFormat;
    return format && format !== LiteralDisplayFormats.Default && typeof literalDef.value === "number"
      ? applyDisplayFormat(literalDef.value, format)
      : literalDef.valueLabel || String(literalDef.value);
  }

  if (tileDef.kind === "variable") {
    return (tileDef as BrainTileVariableDef).varName;
  }

  if (tileDef.kind === "accessor") {
    return (tileDef as BrainTileAccessorDef).fieldName;
  }

  return getCatalogFallbackLabel(tileDef);
}

interface DocsSidebarProviderProps {
  children: ReactNode;
  registry?: DocsRegistry;
  tileCatalog?: ITileCatalog;
  brainServices?: BrainServices;
  resolveTileVisual?: (tileDef: IBrainTileDef) => TileVisual | undefined;
  /** Initial active tab (defaults to "tiles"). */
  initialTab?: DocTab;
  /** Initial detail-view key (defaults to null -- list view). */
  initialNavKey?: string | null;
  /** Initial detail-view tab (defaults to null). */
  initialNavTab?: DocTab | null;
}

export function DocsSidebarProvider({
  children,
  registry: externalRegistry,
  tileCatalog: externalTileCatalog,
  brainServices: externalBrainServices,
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
    (tileDef: IBrainTileDef): TileVisual | undefined => {
      const intrinsicVisual = tileDef.metadata as TileVisual | undefined;
      const appVisual = resolveTileVisualProp?.(tileDef);
      const appLabel = appVisual?.label;
      const resolvedAppLabel = appLabel && appLabel !== getCatalogFallbackLabel(tileDef) ? appLabel : undefined;
      const intrinsicLabel = intrinsicVisual?.label;
      const resolvedIntrinsicLabel =
        intrinsicLabel && intrinsicLabel !== getCatalogFallbackLabel(tileDef) ? intrinsicLabel : undefined;

      return {
        ...(intrinsicVisual ?? {}),
        ...(appVisual ?? {}),
        label: resolvedAppLabel ?? resolvedIntrinsicLabel ?? defaultTileLabel(tileDef),
      };
    },
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
    if (tileDef.kind === "variable") {
      setActiveTab("concepts");
      setNavKey("variables");
      setNavTab("concepts");
    } else if (tileDef.kind === "literal") {
      setActiveTab("concepts");
      setNavKey("literals");
      setNavTab("concepts");
    } else {
      setActiveTab("tiles");
      setNavKey(tileDef.tileId);
      setNavTab("tiles");
    }
  }, []);

  const handleSetTab = useCallback((tab: DocTab) => {
    setActiveTab(tab);
    setNavKey(null);
    setNavTab(null);
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
  };

  return <DocsSidebarContext.Provider value={value}>{children}</DocsSidebarContext.Provider>;
}

export function useDocsSidebar(): DocsSidebarContextValue {
  const ctx = useContext(DocsSidebarContext);
  if (!ctx) {
    throw new Error("useDocsSidebar must be used within a DocsSidebarProvider");
  }
  return ctx;
}

export function useDocsTileCatalog(): ITileCatalog | undefined {
  return useDocsSidebar().tileCatalog;
}

export function useDocsResolveTileVisual(): (tileDef: IBrainTileDef) => TileVisual | undefined {
  return useDocsSidebar().resolveTileVisual;
}

export function useDocsBrainServices(): BrainServices | undefined {
  return useDocsSidebar().brainServices;
}
