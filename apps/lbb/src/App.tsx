import RAPIER, { init as initRapier } from "@dimforge/rapier3d-compat";
import { useEffect, useState } from "react";
import { Layout } from "./app/Layout";
import { useEditorStore } from "./editor/editor-store";
import { useWorldStore } from "./world/world-store";

const CHUNK_GRID = { x: 4, y: 4, z: 4 };

let rapierInitPromise: Promise<void> | null = null;
function ensureRapierInit(): Promise<void> {
  if (!rapierInitPromise) {
    rapierInitPromise = initRapier();
  }
  return rapierInitPromise;
}

function useKeyboardShortcuts() {
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if (mod && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      }
      if (mod && e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);
}

export function App() {
  const [ready, setReady] = useState(false);
  const initPhysics = useWorldStore((s) => s.initPhysics);
  const initTerrain = useWorldStore((s) => s.initTerrain);

  useKeyboardShortcuts();

  useEffect(() => {
    let cancelled = false;

    ensureRapierInit().then(() => {
      if (cancelled) return;
      initPhysics(RAPIER);
      initTerrain(CHUNK_GRID);
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [initPhysics, initTerrain]);

  if (!ready) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#71717a",
          fontSize: 14,
        }}
      >
        Initializing...
      </div>
    );
  }

  return <Layout />;
}
