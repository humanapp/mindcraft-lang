import type { ProjectManifest } from "@mindcraft-lang/app-host";
import type { BrainDef } from "@mindcraft-lang/core/app";
import type { ITileCatalog } from "@mindcraft-lang/core/brain";
import { DocsSidebar, DocsSidebarProvider, useDocsSidebar } from "@mindcraft-lang/docs";
import {
  BrainEditorDialog,
  BrainEditorProvider,
  ProjectPickerDialog,
  type ProjectPickerItem,
  Toaster,
} from "@mindcraft-lang/ui";
import { Menu, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { ArchetypeStats, ScoreSnapshot } from "@/brain/score";
import type { Archetype } from "./brain/actor";
import { buildBrainEditorConfig } from "./brain/editor/config";
import { genVisualForTile } from "./brain/editor/visual-provider";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { ProjectHeader } from "./components/ProjectHeader";
import { Sidebar } from "./components/Sidebar";
import { useSimEnvironment } from "./contexts/sim-environment";
import { createDocsRegistry } from "./docs/docs-registry";
import type { Playground } from "./game/scenes/Playground";
import { PhaserGame } from "./PhaserGame";
import { downloadTextFile } from "./utils/file-download";
import { pickFile } from "./utils/file-upload";

/** Compare two snapshots by display-relevant fields to skip no-op re-renders. */
function statsEqual(
  a: ScoreSnapshot[keyof ScoreSnapshot & string],
  b: ScoreSnapshot[keyof ScoreSnapshot & string]
): boolean {
  if (typeof a === "number") return a === b;
  const sa = a as ArchetypeStats;
  const sb = b as ArchetypeStats;
  return (
    sa.aliveCount === sb.aliveCount &&
    sa.deaths === sb.deaths &&
    Math.round(sa.totalEnergy) === Math.round(sb.totalEnergy) &&
    Math.round(sa.longestLife) === Math.round(sb.longestLife)
  );
}

function snapshotEqual(a: ScoreSnapshot, b: ScoreSnapshot): boolean {
  return (
    a.ecosystemScore === b.ecosystemScore &&
    Math.round(a.elapsed) === Math.round(b.elapsed) &&
    statsEqual(a.carnivore, b.carnivore) &&
    statsEqual(a.herbivore, b.herbivore) &&
    statsEqual(a.plant, b.plant)
  );
}

/** Wrapper that injects docs integration from the docs context into the brain editor config. */
function DocsBrainEditorProvider({ archetype, children }: { archetype: Archetype | null; children: React.ReactNode }) {
  const { openDocsForTile, isOpen: isDocsOpen, toggle: toggleDocs, close: closeDocs } = useDocsSidebar();
  const store = useSimEnvironment();
  const vfsRevision = useSyncExternalStore(store.subscribeToVfsRevision, store.getVfsRevisionSnapshot);
  const config = useMemo(
    () =>
      buildBrainEditorConfig({
        store,
        archetype: archetype ?? undefined,
        vfsRevision,
        onTileHelp: openDocsForTile,
        docsIntegration: { isOpen: isDocsOpen, toggle: toggleDocs, close: closeDocs },
      }),
    [store, archetype, vfsRevision, openDocsForTile, isDocsOpen, toggleDocs, closeDocs]
  );
  return <BrainEditorProvider config={config}>{children}</BrainEditorProvider>;
}

function App() {
  const store = useSimEnvironment();
  const [isBrainEditorOpen, setIsBrainEditorOpen] = useState(false);
  const [editingArchetype, setEditingArchetype] = useState<Archetype | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [timeSpeed, setTimeSpeed] = useState(() => store.getUiPreferences().timeScale);
  const [debugEnabled, setDebugEnabled] = useState(() => store.getUiPreferences().debugEnabled);
  const [scene, setScene] = useState<Playground | null>(null);
  const [snapshot, setSnapshot] = useState<ScoreSnapshot | null>(null);
  const prevSnapshotRef = useRef<ScoreSnapshot | null>(null);

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [projectName, setProjectName] = useState(() => store.activeProjectManifest?.name ?? "");
  const [projectList, setProjectList] = useState<ProjectManifest[]>([]);

  useEffect(() => {
    store.projectManager.listProjects().then(setProjectList, () => toast.error("Failed to load projects"));
    const unsubActive = store.projectManager.onActiveProjectChange((project) => {
      setProjectName(project?.manifest.name ?? "");
    });
    const unsubList = store.projectManager.onProjectListChange((projects) => {
      setProjectList(projects);
    });
    const unsubLoaded = store.onProjectLoaded(() => {
      const prefs = store.getUiPreferences();
      setTimeSpeed(prefs.timeScale);
      setDebugEnabled(prefs.debugEnabled);
    });
    return () => {
      unsubActive();
      unsubList();
      unsubLoaded();
    };
  }, [store]);

  useEffect(() => {
    if (!scene) return;
    const isDebug = scene.matter.world.drawDebug;
    if (debugEnabled !== isDebug) {
      scene.toggleDebugMode();
    }
  }, [scene, debugEnabled]);

  const pickerItems = useMemo<ProjectPickerItem[]>(
    () =>
      projectList.map((p) => ({
        id: p.id,
        title: p.name,
        updatedAt: p.updatedAt,
      })),
    [projectList]
  );

  const handleSelectProject = useCallback(
    (id: string) => {
      store.switchProject(id).then(
        () => {
          setIsPickerOpen(false);
        },
        () => {
          toast.error("This project is already open in another tab");
        }
      );
    },
    [store]
  );

  const handleDeleteProject = useCallback(
    (id: string) => {
      store.projectManager.delete(id).catch(() => {
        toast.error("Failed to delete project");
      });
    },
    [store]
  );

  const handleNewProject = useCallback(() => {
    setIsPickerOpen(false);
    setIsNewProjectOpen(true);
  }, []);

  const handleNewProjectConfirm = useCallback(
    (name: string) => {
      store.createProject(name).catch(() => {
        toast.error("Failed to create project");
      });
    },
    [store]
  );

  const handleExportProject = useCallback(() => {
    store.exportProject().then(
      (json) => {
        const safeName =
          (store.activeProjectManifest?.name ?? "project")
            .replace(/[^a-zA-Z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .toLowerCase() || "project";
        downloadTextFile(json, `${safeName}.mindcraft`);
      },
      () => {
        toast.error("Failed to export project");
      }
    );
  }, [store]);

  const handleImportProject = useCallback(() => {
    pickFile(".mindcraft,.json").then(
      (file) => {
        if (!file) return;
        store.importProject(file).then(
          async (result) => {
            if (!result.success || !result.projectId) {
              const errorMsg = result.diagnostics.find((d) => d.severity === "error")?.message ?? "Import failed";
              toast.error(errorMsg);
              return;
            }

            try {
              await store.switchProject(result.projectId);
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Failed to open imported project";
              toast.error(msg);
              return;
            }

            const warnings = result.diagnostics.filter((d) => d.severity === "warning");
            if (warnings.length > 0) {
              toast.warning(`Imported with ${warnings.length} warning(s)`, {
                description: warnings.map((w) => w.message).join("\n"),
              });
            } else {
              toast.success("Project imported successfully");
            }
          },
          () => {
            toast.error("Failed to import project");
          }
        );
      },
      () => {
        toast.error("Failed to open file picker");
      }
    );
  }, [store]);

  const defaultNewProjectName = useMemo(() => `Project ${projectList.length + 1}`, [projectList.length]);

  const docRevision = useSyncExternalStore(store.subscribeToDocRevision, store.getDocRevisionSnapshot);
  const vfsRevision = useSyncExternalStore(store.subscribeToVfsRevision, store.getVfsRevisionSnapshot);
  const docsResolveTileVisual = useMemo(() => {
    return (tileDef: Parameters<typeof genVisualForTile>[0]) => {
      const visual = genVisualForTile(tileDef);
      if (visual.iconUrl?.startsWith("/vfs/")) {
        return { ...visual, iconUrl: `${visual.iconUrl}?_v=${vfsRevision}` };
      }
      return visual;
    };
  }, [vfsRevision]);
  const docsRegistry = useMemo(() => {
    void docRevision;
    return createDocsRegistry(store.userTileDocEntries);
  }, [docRevision, store]);
  const docsTileCatalog = useMemo<ITileCatalog>(() => {
    return {
      get: (tileId: string) => {
        for (const catalog of store.env.tileCatalogs()) {
          const def = catalog.get(tileId);
          if (def) return def;
        }
        return undefined;
      },
    } as ITileCatalog;
  }, [store]);

  useEffect(() => {
    scene?.setTimeSpeed(timeSpeed);
  }, [scene, timeSpeed]);

  // Restore persisted population counts when the scene becomes available, and
  // re-push them whenever a different project is loaded.
  useEffect(() => {
    if (!scene) return;
    const pushCountsToScene = () => {
      const counts = store.getDesiredCounts();
      for (const [arch, count] of Object.entries(counts)) {
        scene.setDesiredCount(arch as Archetype, count);
      }
    };
    pushCountsToScene();
    return store.onDesiredCountsReloaded(pushCountsToScene);
  }, [scene, store]);

  // Poll the engine for score data. The snapshot is a fresh object each call,
  // so compare rounded display values to avoid re-renders when nothing the
  // user can see has changed.
  useEffect(() => {
    if (!scene) return;
    const id = setInterval(() => {
      const next = scene.getScoreSnapshot();
      const prev = prevSnapshotRef.current;
      if (prev && snapshotEqual(prev, next)) return;
      prevSnapshotRef.current = next;
      setSnapshot(next);
    }, 250);
    return () => clearInterval(id);
  }, [scene]);

  const handleTimeSpeedChange = useCallback(
    (speed: number) => {
      setTimeSpeed(speed);
      store.updateUiPreferences({ timeScale: speed });
    },
    [store]
  );

  const handleEditBrain = useCallback((archetype: Archetype) => {
    setEditingArchetype(archetype);
    setIsBrainEditorOpen(true);
  }, []);

  const handleDesiredCountChange = useCallback(
    (archetype: Archetype, count: number) => {
      scene?.setDesiredCount(archetype, count);
      store.setDesiredCount(archetype, count);
    },
    [scene, store]
  );

  const handleToggleDebug = useCallback(() => {
    scene?.toggleDebugMode();
    setDebugEnabled((prev) => {
      const next = !prev;
      store.updateUiPreferences({ debugEnabled: next });
      return next;
    });
  }, [scene, store]);

  const getBrainDefForEditing = (): BrainDef | undefined => {
    if (editingArchetype) {
      return scene?.getBrainDef(editingArchetype);
    }
  };

  const handleBrainSubmit = (brainDef: BrainDef) => {
    if (editingArchetype) {
      scene?.updateBrainDef(editingArchetype, brainDef);
      void store.saveBrainForArchetype(editingArchetype, brainDef);
    }
    setEditingArchetype(null);
    setIsBrainEditorOpen(false);
  };

  const handleSceneReady = useCallback((readyScene: Phaser.Scene) => {
    if (readyScene.scene.key === "Playground") {
      setScene(readyScene as Playground);
    }
  }, []);

  return (
    <DocsSidebarProvider
      registry={docsRegistry}
      tileCatalog={docsTileCatalog}
      brainServices={store.env.brainServices}
      resolveTileVisual={docsResolveTileVisual}
    >
      <div className="h-screen flex bg-background overflow-hidden">
        <h1 className="sr-only">Mindcraft Simulation</h1>
        {/* Game Canvas -- flex-1 lets the Phaser Scale.FIT fill available space */}
        <main className="flex-1 min-w-0 relative" aria-label="Game canvas" style={{ backgroundColor: "#2d3561" }}>
          <PhaserGame store={store} onSceneReady={handleSceneReady} />
          <ProjectHeader
            projectName={projectName}
            onBrowseProjects={() => setIsPickerOpen(true)}
            onNewProject={() => setIsNewProjectOpen(true)}
            onExportProject={handleExportProject}
            onImportProject={handleImportProject}
          />
          {/* Mobile sidebar toggle */}
          <button
            type="button"
            className="absolute top-3 right-3 z-40 md:hidden flex items-center justify-center w-10 h-10 rounded-lg bg-background/80 backdrop-blur border border-border shadow-md"
            onClick={() => setIsSidebarOpen((o) => !o)}
            aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </main>

        {/* Backdrop -- mobile only */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        <Sidebar
          snapshot={snapshot}
          timeSpeed={timeSpeed}
          onTimeSpeedChange={handleTimeSpeedChange}
          onEditBrain={handleEditBrain}
          onDesiredCountChange={handleDesiredCountChange}
          onToggleDebug={handleToggleDebug}
          debugEnabled={debugEnabled}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />

        {/* Brain Editor Dialog (rendered at root for proper overlay) */}
        <DocsBrainEditorProvider archetype={editingArchetype}>
          <BrainEditorDialog
            isOpen={isBrainEditorOpen}
            onOpenChange={(open) => {
              setIsBrainEditorOpen(open);
              if (!open) {
                setEditingArchetype(null);
              }
            }}
            srcBrainDef={getBrainDefForEditing()}
            onSubmit={handleBrainSubmit}
          />
        </DocsBrainEditorProvider>

        <ProjectPickerDialog
          open={isPickerOpen}
          onOpenChange={setIsPickerOpen}
          projects={pickerItems}
          activeProjectId={store.activeProjectManifest?.id}
          onSelect={handleSelectProject}
          onDelete={handleDeleteProject}
          onCreate={handleNewProject}
        />

        <NewProjectDialog
          open={isNewProjectOpen}
          onOpenChange={setIsNewProjectOpen}
          onConfirm={handleNewProjectConfirm}
          defaultName={defaultNewProjectName}
        />
      </div>

      {/* Docs sidebar -- fixed overlay, sibling to main layout */}
      <DocsSidebar />
      <Toaster />
    </DocsSidebarProvider>
  );
}

export default App;
