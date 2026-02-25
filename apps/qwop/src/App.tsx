import { Menu, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import type { QwopScene } from "./game/scenes/QwopScene";
import { PhaserGame } from "./PhaserGame";

function App() {
  const [scene, setScene] = useState<QwopScene | null>(null);
  const [distance, setDistance] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [attempts, setAttempts] = useState(1);
  const [fallen, setFallen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const highScoreRef = useRef(0);

  const onSceneReady = useCallback((s: Phaser.Scene) => {
    const qwop = s as QwopScene;
    setScene(qwop);

    qwop.events.on("distance-update", (d: number) => {
      setDistance(d);
      if (d > highScoreRef.current) {
        highScoreRef.current = d;
        setHighScore(d);
      }
    });

    qwop.events.on("runner-fallen", () => {
      setFallen(true);
    });

    qwop.events.on("runner-reset", () => {
      setFallen(false);
      setDistance(0);
      setAttempts((a) => a + 1);
    });
  }, []);

  const handleReset = useCallback(() => {
    if (scene) {
      scene.scene.restart();
    }
  }, [scene]);

  const handleEditBrain = useCallback(() => {
    // noop for now -- will open brain editor in a later step
  }, []);

  const handleToggleDebug = useCallback(() => {
    scene?.toggleDebugMode();
  }, [scene]);

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <h1 className="sr-only">QWOP - Mindcraft</h1>

      {/* Game canvas */}
      <main className="flex-1 min-w-0 relative" aria-label="Game canvas" style={{ backgroundColor: "#87CEEB" }}>
        <PhaserGame onSceneReady={onSceneReady} />

        {/* Mobile sidebar toggle */}
        <button
          type="button"
          className="absolute top-3 right-3 z-40 md:hidden flex items-center justify-center w-10 h-10 rounded-lg bg-background/80 backdrop-blur border border-border shadow-md"
          onClick={() => setIsSidebarOpen((o) => !o)}
          aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        {/* Distance HUD */}
        <div
          className="absolute top-4 left-6 pointer-events-none z-10"
          style={{ fontFamily: "'Courier New', monospace" }}
        >
          <div className="text-3xl font-bold text-white" style={{ textShadow: "2px 2px 4px rgba(0,0,0,0.8)" }}>
            {distance.toFixed(1)}m
          </div>
        </div>

        {/* Fall overlay */}
        {fallen && (
          <div className="absolute inset-0 flex flex-col justify-center items-center bg-black/60 z-20">
            <div
              className="text-5xl font-bold text-red-500 mb-2"
              style={{
                fontFamily: "'Courier New', monospace",
                textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
              }}
            >
              {distance.toFixed(1)} metres
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="mt-5 px-8 py-3 text-xl font-bold bg-gray-800 text-white border-2 border-gray-500 rounded cursor-pointer hover:border-white transition-colors"
              style={{ fontFamily: "'Courier New', monospace" }}
            >
              Try Again
            </button>
          </div>
        )}
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
        distance={distance}
        highScore={highScore}
        attempts={attempts}
        fallen={fallen}
        onEditBrain={handleEditBrain}
        onReset={handleReset}
        onToggleDebug={handleToggleDebug}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
    </div>
  );
}

export default App;
