import type { BrainServices, IBrainTileDef, ITileCatalog } from "@mindcraft-lang/core/brain";
import type { TileVisual } from "@mindcraft-lang/ui/brain-editor/types";
import { BookOpen, ChevronLeft, Printer } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { DocsPrintView } from "./DocsPrintView";
import type { DocsRegistry } from "./DocsRegistry";
import { DocsPanelContent } from "./DocsSidebar";
import { DocsSidebarProvider, type DocTab, useDocsSidebar } from "./DocsSidebarContext";
import { useDocsPrint } from "./useDocsPrint";

// ---------------------------------------------------------------------------
// URL <-> docs state mapping
// ---------------------------------------------------------------------------

const VALID_TABS = new Set<string>(["tiles", "patterns", "concepts"]);

function parseDocsUrl(pathname: string): { tab: DocTab; key: string | null } {
  const stripped = pathname.replace(/^\/docs\/?/, "");
  const parts = stripped.split("/").filter(Boolean);
  const tab = (VALID_TABS.has(parts[0]) ? parts[0] : "tiles") as DocTab;
  const key = parts[1] ? decodeURIComponent(parts[1]) : null;
  return { tab, key };
}

function buildDocsPath(tab: DocTab, navKey: string | null, navTab: DocTab | null): string {
  if (navKey && navTab) {
    return `/docs/${navTab}/${encodeURIComponent(navKey)}`;
  }
  return `/docs/${tab}`;
}

// ---------------------------------------------------------------------------
// URL sync hook -- pushes state changes to the URL and handles popstate
// ---------------------------------------------------------------------------

function useDocsUrlSync(): void {
  const { activeTab, navKey, navTab, setTab, navigateToEntry, navigateBack } = useDocsSidebar();
  const prevPath = useRef(window.location.pathname);

  // Push URL when docs state changes
  useEffect(() => {
    const path = buildDocsPath(activeTab, navKey, navTab);
    if (path !== prevPath.current) {
      prevPath.current = path;
      history.pushState(null, "", path);
    }
  }, [activeTab, navKey, navTab]);

  // Handle browser back/forward
  const handlePopState = useCallback(() => {
    const { tab, key } = parseDocsUrl(window.location.pathname);
    prevPath.current = window.location.pathname;
    if (key) {
      navigateToEntry(tab, key);
    } else {
      navigateBack();
      setTab(tab);
    }
  }, [setTab, navigateToEntry, navigateBack]);

  useEffect(() => {
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [handlePopState]);
}

// ---------------------------------------------------------------------------
// Layout -- full-page docs view
// ---------------------------------------------------------------------------

export interface DocsPageLayoutProps {
  /** Label displayed in the back link (top-left). Defaults to "Home". */
  backLabel?: string;
  /** URL the back link navigates to. Defaults to "/". */
  backHref?: string;
}

function DocsPageLayout({ backLabel = "Home", backHref = "/" }: DocsPageLayoutProps) {
  useDocsUrlSync();
  const searchRef = useRef<HTMLInputElement>(null);
  const { navKey, navTab, registry } = useDocsSidebar();
  const { printContent, triggerPrint, getPrintRoot } = useDocsPrint();

  const detailContent = useMemo(() => {
    if (!navKey || !navTab) return null;
    if (navTab === "tiles") return registry.tiles.get(navKey)?.content ?? null;
    if (navTab === "patterns") return registry.patterns.get(navKey)?.content ?? null;
    if (navTab === "concepts") return registry.concepts.get(navKey)?.content ?? null;
    return null;
  }, [navKey, navTab, registry]);

  const canPrint = detailContent !== null;

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-slate-200">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-700 shrink-0">
        <a
          href={backHref}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          {backLabel}
        </a>
        <div className="flex items-center gap-2 text-slate-200">
          <BookOpen className="w-4 h-4" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">Documentation</span>
        </div>
        {canPrint && (
          <button
            type="button"
            onClick={() => triggerPrint(detailContent)}
            className="ml-auto flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
            aria-label="Print this page"
            title="Print this page"
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </header>

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col max-w-3xl mx-auto w-full">
        <DocsPanelContent tabBarClassName="py-2.5 text-sm" scrollClassName="p-4 md:p-6" searchRef={searchRef} />
      </div>

      {printContent && createPortal(<DocsPrintView content={printContent} />, getPrintRoot())}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocsPage -- standalone entry point
// ---------------------------------------------------------------------------

export interface DocsPageProps {
  /** The docs registry to use. */
  registry: DocsRegistry;
  /** Optional tile catalog for label/icon resolution without global brain services. */
  tileCatalog?: ITileCatalog;
  /** Optional BrainServices instance for direct access. */
  brainServices?: BrainServices;
  /** Optional tile visual resolver for app-provided labels, icons, and colors. */
  resolveTileVisual?: (tileDef: IBrainTileDef) => TileVisual | undefined;
  /** Label displayed in the back link (top-left). Defaults to "Home". */
  backLabel?: string;
  /** URL the back link navigates to. Defaults to "/". */
  backHref?: string;
  /** Optional extra children rendered alongside the layout (e.g. a Toaster). */
  children?: React.ReactNode;
}

export function DocsPage({
  registry,
  tileCatalog,
  brainServices,
  resolveTileVisual,
  backLabel,
  backHref,
  children,
}: DocsPageProps) {
  const { tab, key } = useMemo(() => parseDocsUrl(window.location.pathname), []);

  return (
    <DocsSidebarProvider
      registry={registry}
      tileCatalog={tileCatalog}
      brainServices={brainServices}
      resolveTileVisual={resolveTileVisual}
      initialTab={tab}
      initialNavKey={key}
      initialNavTab={key ? tab : null}
    >
      <DocsPageLayout backLabel={backLabel} backHref={backHref} />
      {children}
    </DocsSidebarProvider>
  );
}
