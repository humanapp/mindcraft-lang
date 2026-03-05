import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { DocsRegistry } from "./DocsRegistry";

export type DocTab = "tiles" | "patterns" | "concepts";

interface DocsSidebarContextValue {
  isOpen: boolean;
  activeTab: DocTab;
  registry: DocsRegistry;
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
}

const DocsSidebarContext = createContext<DocsSidebarContextValue | null>(null);

interface DocsSidebarProviderProps {
  children: ReactNode;
  registry?: DocsRegistry;
}

export function DocsSidebarProvider({ children, registry: externalRegistry }: DocsSidebarProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DocTab>("tiles");
  const [navKey, setNavKey] = useState<string | null>(null);
  const [navTab, setNavTab] = useState<DocTab | null>(null);
  const registry = useMemo(() => externalRegistry ?? new DocsRegistry(), [externalRegistry]);

  const navigateToEntry = useCallback((tab: DocTab, key: string) => {
    setActiveTab(tab);
    setNavKey(key);
    setNavTab(tab);
  }, []);

  const navigateBack = useCallback(() => {
    setNavKey(null);
    setNavTab(null);
  }, []);

  const handleSetTab = useCallback((tab: DocTab) => {
    setActiveTab(tab);
    setNavKey(null);
    setNavTab(null);
  }, []);

  const value: DocsSidebarContextValue = {
    isOpen,
    activeTab,
    registry,
    navKey,
    navTab,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((o) => !o),
    setTab: handleSetTab,
    navigateToEntry,
    navigateBack,
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
