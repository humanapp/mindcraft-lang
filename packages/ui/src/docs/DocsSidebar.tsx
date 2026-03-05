import { getBrainServices } from "@mindcraft-lang/core/brain";
import { BookOpen, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TileVisual } from "../brain-editor/types";
import { DocMarkdown } from "./DocMarkdown";
import type { DocsConceptEntry, DocsPatternEntry, DocsTileEntry } from "./DocsRegistry";
import { type DocTab, useDocsSidebar } from "./DocsSidebarContext";

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 767px)").matches);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}

const TABS: { id: DocTab; label: string }[] = [
  { id: "tiles", label: "Tiles" },
  { id: "patterns", label: "Patterns" },
  { id: "concepts", label: "Concepts" },
];

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

function matchesSearch(query: string, ...fields: (string | string[] | undefined)[]): boolean {
  const q = query.toLowerCase();
  for (const field of fields) {
    if (!field) continue;
    if (Array.isArray(field)) {
      for (const f of field) {
        if (f.toLowerCase().includes(q)) return true;
      }
    } else {
      if (field.toLowerCase().includes(q)) return true;
    }
  }
  return false;
}

/** Resolve display label for a tile from the tile catalog. */
function getTileLabel(tileId: string): string {
  const tileDef = getBrainServices().tiles.get(tileId);
  if (tileDef) {
    const visual = tileDef.visual as TileVisual | undefined;
    if (visual?.label) return visual.label;
  }
  // Fallback: extract the last segment after ->
  const arrow = tileId.indexOf("->");
  return arrow >= 0 ? tileId.slice(arrow + 2) : tileId;
}

/** Resolve icon URL for a tile from the tile catalog. */
function getTileIconUrl(tileId: string): string | undefined {
  const tileDef = getBrainServices().tiles.get(tileId);
  if (tileDef) {
    const visual = tileDef.visual as TileVisual | undefined;
    return visual?.iconUrl;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

function SearchBar({ value, onChange, inputRef }: SearchBarProps) {
  return (
    <div className="px-3 py-2 border-b border-slate-700 shrink-0">
      <div className="flex items-center gap-2 rounded-md bg-slate-800 border border-slate-600 px-2.5 py-1.5">
        <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search docs..."
          className="flex-1 bg-transparent text-sm text-slate-300 placeholder:text-slate-500 outline-none"
          aria-label="Search documentation"
        />
      </div>
    </div>
  );
}

interface TabBarProps {
  activeTab: DocTab;
  setTab: (tab: DocTab) => void;
  itemClassName?: string;
}

function TabBar({ activeTab, setTab, itemClassName = "py-2 text-xs" }: TabBarProps) {
  return (
    <div className="flex border-b border-slate-700 shrink-0" role="tablist" aria-label="Documentation sections">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => setTab(tab.id)}
            className={`flex-1 font-medium transition-colors border-b-2 ${itemClassName} ${
              isActive
                ? "text-slate-100 border-slate-400"
                : "text-slate-500 border-transparent hover:text-slate-300 hover:border-slate-600"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category section with collapsible groups
// ---------------------------------------------------------------------------

interface CategorySectionProps {
  category: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function CategorySection({ category, children, defaultOpen = true }: CategorySectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="flex items-center gap-1.5 w-full px-1 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider hover:text-slate-300 transition-colors"
      >
        <ChevronRight className={`w-3 h-3 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden="true" />
        {category}
      </button>
      {isOpen && <div className="space-y-1">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List item cards
// ---------------------------------------------------------------------------

interface TileCardProps {
  entry: DocsTileEntry;
  onClick: () => void;
}

function TileCard({ entry, onClick }: TileCardProps) {
  const label = getTileLabel(entry.tileId);
  const iconUrl = getTileIconUrl(entry.tileId);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-slate-800/50 hover:bg-slate-700/60 border border-slate-700/50 hover:border-slate-600 transition-colors text-left"
    >
      {iconUrl ? (
        <img src={iconUrl} alt="" className="w-6 h-6 shrink-0" aria-hidden="true" />
      ) : (
        <div className="w-6 h-6 rounded bg-slate-600 opacity-40 shrink-0" aria-hidden="true" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-200 truncate">{label}</div>
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
    </button>
  );
}

interface PatternCardProps {
  entry: DocsPatternEntry;
  onClick: () => void;
}

function PatternCard({ entry, onClick }: PatternCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-slate-800/50 hover:bg-slate-700/60 border border-slate-700/50 hover:border-slate-600 transition-colors text-left"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-200 truncate">{entry.title}</div>
        <div className="text-xs text-slate-500 truncate">{entry.tags.join(", ")}</div>
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
    </button>
  );
}

interface ConceptCardProps {
  entry: DocsConceptEntry;
  onClick: () => void;
}

function ConceptCard({ entry, onClick }: ConceptCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-slate-800/50 hover:bg-slate-700/60 border border-slate-700/50 hover:border-slate-600 transition-colors text-left"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-200 truncate">{entry.title}</div>
        <div className="text-xs text-slate-500 truncate">{entry.tags.join(", ")}</div>
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Content panel -- shared between desktop and mobile
// ---------------------------------------------------------------------------

interface DocsPanelContentProps {
  tabBarClassName?: string;
  scrollClassName?: string;
  searchRef?: React.Ref<HTMLInputElement>;
}

function DocsPanelContent({ tabBarClassName, scrollClassName = "p-3", searchRef }: DocsPanelContentProps) {
  const { activeTab, setTab, registry, navKey, navTab, navigateToEntry, navigateBack } = useDocsSidebar();
  const [search, setSearch] = useState("");

  // Reset search when tab changes
  const handleSetTab = useCallback(
    (tab: DocTab) => {
      setTab(tab);
      setSearch("");
    },
    [setTab]
  );

  const openDetail = useCallback(
    (key: string) => {
      navigateToEntry(activeTab, key);
    },
    [activeTab, navigateToEntry]
  );

  // Filter entries based on search
  const filteredTiles = useMemo(() => {
    const tiles = Array.from(registry.tiles.values());
    if (!search) return tiles;
    return tiles.filter((t) => matchesSearch(search, getTileLabel(t.tileId), t.tileId, t.tags, t.category, t.content));
  }, [registry, search]);

  const filteredPatterns = useMemo(() => {
    const patterns = Array.from(registry.patterns.values());
    if (!search) return patterns;
    return patterns.filter((p) => matchesSearch(search, p.title, p.tags, p.category, p.content));
  }, [registry, search]);

  const filteredConcepts = useMemo(() => {
    const concepts = Array.from(registry.concepts.values());
    if (!search) return concepts;
    return concepts.filter((c) => matchesSearch(search, c.title, c.tags, c.content));
  }, [registry, search]);

  // Group tiles by category
  const tilesByCategory = useMemo(() => {
    const groups = new Map<string, DocsTileEntry[]>();
    for (const tile of filteredTiles) {
      const existing = groups.get(tile.category);
      if (existing) {
        existing.push(tile);
      } else {
        groups.set(tile.category, [tile]);
      }
    }
    return groups;
  }, [filteredTiles]);

  // Group patterns by category
  const patternsByCategory = useMemo(() => {
    const groups = new Map<string, DocsPatternEntry[]>();
    for (const pattern of filteredPatterns) {
      const existing = groups.get(pattern.category);
      if (existing) {
        existing.push(pattern);
      } else {
        groups.set(pattern.category, [pattern]);
      }
    }
    return groups;
  }, [filteredPatterns]);

  // Resolve detail content
  const detailContent = useMemo(() => {
    if (!navKey || !navTab) return null;
    if (navTab === "tiles") {
      return registry.tiles.get(navKey)?.content ?? null;
    }
    if (navTab === "patterns") {
      return registry.patterns.get(navKey)?.content ?? null;
    }
    if (navTab === "concepts") {
      return registry.concepts.get(navKey)?.content ?? null;
    }
    return null;
  }, [navKey, navTab, registry]);

  // Detail view
  if (navKey && detailContent) {
    return (
      <>
        <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-700 shrink-0">
          <button
            type="button"
            onClick={navigateBack}
            className="flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors text-sm"
            aria-label="Back to list"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            Back
          </button>
        </div>
        <article
          className={`flex-1 min-h-0 overflow-y-auto ${scrollClassName}`}
          onWheel={(e) => e.nativeEvent.stopPropagation()}
        >
          <DocMarkdown>{detailContent}</DocMarkdown>
        </article>
      </>
    );
  }

  // List view
  return (
    <>
      <SearchBar value={search} onChange={setSearch} inputRef={searchRef} />
      <TabBar activeTab={activeTab} setTab={handleSetTab} itemClassName={tabBarClassName} />
      <div
        role="tabpanel"
        className={`flex-1 min-h-0 overflow-y-auto ${scrollClassName}`}
        onWheel={(e) => e.nativeEvent.stopPropagation()}
      >
        {activeTab === "tiles" && (
          <>
            {filteredTiles.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-6">No tiles match your search.</p>
            )}
            {Array.from(tilesByCategory.entries()).map(([category, tiles]) => (
              <CategorySection key={category} category={category}>
                {tiles.map((tile) => (
                  <TileCard key={tile.tileId} entry={tile} onClick={() => openDetail(tile.tileId)} />
                ))}
              </CategorySection>
            ))}
          </>
        )}

        {activeTab === "patterns" && (
          <>
            {filteredPatterns.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-6">No patterns match your search.</p>
            )}
            {Array.from(patternsByCategory.entries()).map(([category, patterns]) => (
              <CategorySection key={category} category={category}>
                {patterns.map((pattern) => (
                  <PatternCard key={pattern.id} entry={pattern} onClick={() => openDetail(pattern.id)} />
                ))}
              </CategorySection>
            ))}
          </>
        )}

        {activeTab === "concepts" && (
          <>
            {filteredConcepts.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-6">No concepts match your search.</p>
            )}
            <div className="space-y-1">
              {filteredConcepts.map((concept) => (
                <ConceptCard key={concept.id} entry={concept} onClick={() => openDetail(concept.id)} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Desktop panel
// ---------------------------------------------------------------------------

function PanelContent({ searchRef }: { searchRef?: React.Ref<HTMLInputElement> }) {
  const { close } = useDocsSidebar();

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-2 text-slate-200">
          <BookOpen className="w-4 h-4" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">Docs</span>
        </div>
        <button
          type="button"
          onClick={close}
          className="flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
          aria-label="Close docs"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <DocsPanelContent tabBarClassName="py-2 text-xs" scrollClassName="p-3" searchRef={searchRef} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Mobile panel
// ---------------------------------------------------------------------------

function MobilePanel() {
  const { close } = useDocsSidebar();

  return (
    <div className="fixed inset-0 z-60 pointer-events-auto bg-slate-900 flex flex-col">
      {/* Header with back button */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-700 shrink-0">
        <button
          type="button"
          onClick={close}
          className="flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors text-sm"
          aria-label="Close docs"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          Back
        </button>
        <div className="flex items-center gap-2 text-slate-200 ml-2">
          <BookOpen className="w-4 h-4" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">Docs</span>
        </div>
      </div>

      <DocsPanelContent tabBarClassName="py-2.5 text-sm" scrollClassName="p-4" />
    </div>
  );
}

export function DocsSidebar() {
  const { isOpen } = useDocsSidebar();
  const isMobile = useIsMobile();
  const searchRef = useRef<HTMLInputElement>(null);

  // Move focus into the sidebar when it opens so the user can immediately
  // interact via keyboard. A short delay allows the slide-in transition to
  // start before we focus (some browsers ignore focus on off-screen elements).
  useEffect(() => {
    if (isOpen && searchRef.current) {
      const id = requestAnimationFrame(() => searchRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [isOpen]);

  if (isMobile) {
    return isOpen ? createPortal(<MobilePanel />, document.body) : null;
  }

  // Desktop: slide-out panel from the right edge.
  // Portal to document.body so the sidebar sits alongside dialog portals
  // in DOM order, allowing natural Tab flow between them.
  // z-60 ensures it renders above the brain editor dialog's z-50 overlay.
  return createPortal(
    <aside
      id="docs-sidebar"
      className="fixed right-0 inset-y-0 z-60 pointer-events-auto w-87.5 flex flex-col bg-slate-900 border-l border-slate-700 transition-transform duration-300 ease-in-out"
      style={{ transform: isOpen ? "translateX(0)" : "translateX(100%)" }}
      aria-label="Documentation"
      // Prevent off-screen panel from participating in tab order
      inert={!isOpen || undefined}
    >
      <PanelContent searchRef={searchRef} />
    </aside>,
    document.body
  );
}
