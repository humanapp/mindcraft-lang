import type { BrainDef } from "@mindcraft-lang/core/brain/model";
import { BrainEditorDialog, BrainEditorProvider } from "@mindcraft-lang/ui";
import { Menu, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArchetypeStats, ScoreSnapshot } from "@/brain/score";
import type { Archetype } from "./brain/actor";
import { buildBrainEditorConfig } from "./brain-editor-config";
import { Sidebar } from "./components/Sidebar";
import type { Playground } from "./game/scenes/Playground";
import { PhaserGame } from "./PhaserGame";
import { saveBrainToLocalStorage } from "./services/brain-persistence";

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

function App() {
  const [isBrainEditorOpen, setIsBrainEditorOpen] = useState(false);
  const [editingArchetype, setEditingArchetype] = useState<Archetype | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [timeSpeed, setTimeSpeed] = useState(1);
  const [scene, setScene] = useState<Playground | null>(null);
  const [snapshot, setSnapshot] = useState<ScoreSnapshot | null>(null);
  const prevSnapshotRef = useRef<ScoreSnapshot | null>(null);

  const brainEditorConfig = useMemo(() => buildBrainEditorConfig(editingArchetype ?? undefined), [editingArchetype]);

  useEffect(() => {
    scene?.setTimeSpeed(timeSpeed);
  }, [scene, timeSpeed]);

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

  const handleEditBrain = useCallback((archetype: Archetype) => {
    setEditingArchetype(archetype);
    setIsBrainEditorOpen(true);
  }, []);

  const handleDesiredCountChange = useCallback(
    (archetype: Archetype, count: number) => {
      scene?.setDesiredCount(archetype, count);
    },
    [scene]
  );

  const handleToggleDebug = useCallback(() => {
    scene?.toggleDebugMode();
  }, [scene]);

  const getBrainDefForEditing = (): BrainDef | undefined => {
    if (editingArchetype) {
      return scene?.getBrainDef(editingArchetype);
    }
  };

  const handleBrainSubmit = (brainDef: BrainDef) => {
    if (editingArchetype) {
      scene?.updateBrainDef(editingArchetype, brainDef);
      saveBrainToLocalStorage(editingArchetype, brainDef);
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
    <div className="h-screen flex bg-background overflow-hidden">
      <h1 className="sr-only">Mindcraft Simulation</h1>
      {/* Game Canvas -- flex-1 lets the Phaser Scale.FIT fill available space */}
      <main className="flex-1 min-w-0 relative" aria-label="Game canvas" style={{ backgroundColor: "#2d3561" }}>
        <PhaserGame onSceneReady={handleSceneReady} />
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
        onTimeSpeedChange={setTimeSpeed}
        onEditBrain={handleEditBrain}
        onDesiredCountChange={handleDesiredCountChange}
        onToggleDebug={handleToggleDebug}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {/* Brain Editor Dialog (rendered at root for proper overlay) */}
      <BrainEditorProvider config={brainEditorConfig}>
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
      </BrainEditorProvider>
    </div>
  );
}

export default App;
