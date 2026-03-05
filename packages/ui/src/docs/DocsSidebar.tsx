import { getBrainServices } from "@mindcraft-lang/core/brain";
import { BookOpen, ChevronLeft, ChevronRight, GripVertical, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TileVisual } from "../brain-editor/types";
import { DocMarkdown } from "./DocMarkdown";
import type { DocsConceptEntry, DocsPatternEntry, DocsTileEntry } from "./DocsRegistry";
import { type DocTab, useDocsSidebar } from "./DocsSidebarContext";

// ---------------------------------------------------------------------------
// Panel width -- stored as a viewport-relative percentage so that resizing
// the window naturally reflows the panel. Persisted in localStorage.
// ---------------------------------------------------------------------------

const PANEL_WIDTH_KEY = "docs-sidebar-width-pct";
const DEFAULT_WIDTH_PCT = 26; // ~350px on a 1350px viewport
const MIN_WIDTH_PCT = 14;
const MAX_WIDTH_PCT = 55;
const KEYBOARD_STEP_PCT = 1;

function clampWidth(pct: number): number {
  return Math.min(MAX_WIDTH_PCT, Math.max(MIN_WIDTH_PCT, pct));
}

function readStoredWidth(): number {
  try {
    const stored = localStorage.getItem(PANEL_WIDTH_KEY);
    if (stored !== null) {
      const n = Number.parseFloat(stored);
      if (!Number.isNaN(n)) return clampWidth(n);
    }
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_WIDTH_PCT;
}

const STORAGE_DEBOUNCE_MS = 300;

function usePanelWidth(): [number, (pct: number) => void] {
  const [widthPct, setWidthPctState] = useState<number>(readStoredWidth);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setWidthPct = useCallback((pct: number) => {
    const clamped = clampWidth(pct);
    // Update React state immediately for instant visual feedback.
    setWidthPctState(clamped);
    // Debounce the localStorage write so rapid keyboard steps or a fast
    // pointer-move flush only result in one write after the gesture settles.
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      try {
        localStorage.setItem(PANEL_WIDTH_KEY, String(clamped));
      } catch {
        // localStorage unavailable
      }
    }, STORAGE_DEBOUNCE_MS);
  }, []);

  return [widthPct, setWidthPct];
}

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

  // No-docs fallback -- navKey is set but no content found in registry
  if (navKey) {
    const tileLabel = getTileLabel(navKey);
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
        <div className={`flex-1 min-h-0 overflow-y-auto ${scrollClassName}`}>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mb-3">
              <BookOpen className="w-5 h-5 text-slate-500" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-slate-300 mb-1">No documentation available</p>
            <p className="text-xs text-slate-500 max-w-48">
              {tileLabel ? `There is no doc page for "${tileLabel}" yet.` : "There is no doc page for this tile yet."}
            </p>
          </div>
        </div>
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
  const [widthPct, setWidthPct] = usePanelWidth();
  // During drag we apply the width directly without React re-renders via a
  // CSS variable on the aside element, then commit to state on pointerup.
  const asideRef = useRef<HTMLElement>(null);
  // Track whether we are mid-drag so we can suppress the CSS transition.
  const isDragging = useRef(false);

  // Move focus into the sidebar when it opens so the user can immediately
  // interact via keyboard. A short delay allows the slide-in transition to
  // start before we focus (some browsers ignore focus on off-screen elements).
  useEffect(() => {
    if (isOpen && searchRef.current) {
      const id = requestAnimationFrame(() => searchRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [isOpen]);

  // -- Resize handle pointer drag -----------------------------------------
  const handleSeparatorPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    if (asideRef.current) {
      // Disable transition during drag for immediate feedback.
      asideRef.current.style.transition = "transform 300ms ease-in-out";
    }
  }, []);

  const handleSeparatorPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const vw = window.innerWidth;
    const newPct = clampWidth(((vw - e.clientX) / vw) * 100);
    if (asideRef.current) {
      // Update the width immediately via inline style without a state update
      // to avoid re-rendering the full subtree on every pointer event.
      asideRef.current.style.width = `${newPct}%`;
    }
  }, []);

  const handleSeparatorPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      const vw = window.innerWidth;
      const newPct = clampWidth(((vw - e.clientX) / vw) * 100);
      setWidthPct(newPct);
      if (asideRef.current) {
        // Hand control back to React; the state update will sync the inline width.
        asideRef.current.style.width = "";
        asideRef.current.style.transition = "";
      }
    },
    [setWidthPct]
  );

  // -- Resize handle keyboard control -------------------------------------
  const handleSeparatorKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setWidthPct(widthPct + KEYBOARD_STEP_PCT);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setWidthPct(widthPct - KEYBOARD_STEP_PCT);
      } else if (e.key === "Home") {
        e.preventDefault();
        setWidthPct(MAX_WIDTH_PCT);
      } else if (e.key === "End") {
        e.preventDefault();
        setWidthPct(MIN_WIDTH_PCT);
      }
    },
    [widthPct, setWidthPct]
  );

  if (isMobile) {
    return isOpen ? createPortal(<MobilePanel />, document.body) : null;
  }

  // Desktop: slide-out panel from the right edge.
  // Portal to document.body so the sidebar sits alongside dialog portals
  // in DOM order, allowing natural Tab flow between them.
  // z-60 ensures it renders above the brain editor dialog's z-50 overlay.
  return createPortal(
    <aside
      ref={asideRef}
      id="docs-sidebar"
      className="fixed right-0 inset-y-0 z-60 pointer-events-auto flex flex-col bg-slate-900 border-l border-slate-700 transition-transform duration-300 ease-in-out"
      style={{
        width: `${widthPct}%`,
        transform: isOpen ? "translateX(0)" : "translateX(100%)",
      }}
      aria-label="Documentation"
      // Prevent off-screen panel from participating in tab order
      inert={!isOpen || undefined}
    >
      {/* Resize handle -- ARIA splitter/separator pattern (APG). The role="separator"
          element here is intentionally interactive (focusable, keyboard-operable),
          which is the correct pattern for a window splitter. An <hr> cannot be used
          because child elements are needed for the visual affordance. */}
      {/* biome-ignore lint/a11y/useSemanticElements: interactive splitter requires focusable div, not void <hr> */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize docs panel"
        aria-valuenow={Math.round(widthPct)}
        aria-valuemin={MIN_WIDTH_PCT}
        aria-valuemax={MAX_WIDTH_PCT}
        aria-valuetext={`${Math.round(widthPct)}% wide`}
        tabIndex={0}
        className="absolute left-0 inset-y-0 w-3 flex items-center justify-center cursor-col-resize group z-10 focus:outline-none"
        onPointerDown={handleSeparatorPointerDown}
        onPointerMove={handleSeparatorPointerMove}
        onPointerUp={handleSeparatorPointerUp}
        onPointerCancel={handleSeparatorPointerUp}
        onKeyDown={handleSeparatorKeyDown}
      >
        {/* Visual affordance: thin line + grip dots, highlighted on hover/focus */}
        <div className="w-px h-full bg-slate-700 group-hover:bg-slate-500 group-focus-visible:bg-blue-500 transition-colors" />
        <div className="absolute flex flex-col items-center gap-0.5 pointer-events-none">
          <GripVertical
            className="w-3 h-3 text-slate-600 group-hover:text-slate-400 group-focus-visible:text-blue-400 transition-colors"
            aria-hidden="true"
          />
        </div>
      </div>
      {/* Offset content to clear the handle */}
      <div className="flex flex-col flex-1 min-h-0 pl-3">
        <PanelContent searchRef={searchRef} />
      </div>
    </aside>,
    document.body
  );
}
