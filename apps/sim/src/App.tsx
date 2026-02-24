import type { BrainDef } from "@mindcraft-lang/core/brain/model";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScoreSnapshot } from "@/brain/score";
import type { Archetype } from "./brain/actor";
import { BrainEditorDialog } from "./components/brain-editor/BrainEditorDialog";
import { Sidebar } from "./components/Sidebar";
import type { Playground } from "./game/scenes/Playground";
import { PhaserGame } from "./PhaserGame";
import { saveBrainToLocalStorage } from "./services/brain-persistence";

/** Compare two snapshots by display-relevant fields to skip no-op re-renders. */
function statsEqual(a: ScoreSnapshot[keyof ScoreSnapshot & string], b: ScoreSnapshot[keyof ScoreSnapshot & string]): boolean {
  if (typeof a === "number") return a === b;
  const sa = a as import("@/brain/score").ArchetypeStats;
  const sb = b as import("@/brain/score").ArchetypeStats;
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
  const [timeSpeed, setTimeSpeed] = useState(1);
  const [scene, setScene] = useState<Playground | null>(null);
  const [snapshot, setSnapshot] = useState<ScoreSnapshot | null>(null);
  const prevSnapshotRef = useRef<ScoreSnapshot | null>(null);

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
      {/* Game Canvas -- flex-1 lets the Phaser Scale.FIT fill available space */}
      <div className="flex-1 min-w-0" style={{ backgroundColor: "#2d3561" }}>
        <PhaserGame onSceneReady={handleSceneReady} />
      </div>

      <Sidebar
        snapshot={snapshot}
        timeSpeed={timeSpeed}
        onTimeSpeedChange={setTimeSpeed}
        onEditBrain={handleEditBrain}
        onDesiredCountChange={handleDesiredCountChange}
        onToggleDebug={handleToggleDebug}
      />

      {/* Brain Editor Dialog (rendered at root for proper overlay) */}
      <BrainEditorDialog
        isOpen={isBrainEditorOpen}
        onOpenChange={(open) => {
          setIsBrainEditorOpen(open);
          if (!open) {
            setEditingArchetype(null);
          }
        }}
        srcBrainDef={getBrainDefForEditing()}
        archetype={editingArchetype ?? undefined}
        onSubmit={handleBrainSubmit}
      />
    </div>
  );
}

export default App;
