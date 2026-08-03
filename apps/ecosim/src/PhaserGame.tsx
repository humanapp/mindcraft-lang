import { useLayoutEffect, useRef } from "react";
import type { EcosimEnvironmentStore } from "@/services/ecosim-environment-store";
import StartGame from "./game/main";
import type { SceneStartup } from "./game/scenes/Playground";

interface PhaserGameProps {
  store: EcosimEnvironmentStore;
  /** Called once each time the playground scene starts, with the startup outcome. */
  onSceneReady?: (startup: SceneStartup) => void;
}

export function PhaserGame({ store, onSceneReady }: PhaserGameProps) {
  const game = useRef<Phaser.Game | null>(null);
  const callbackRef = useRef(onSceneReady);
  callbackRef.current = onSceneReady;

  useLayoutEffect(() => {
    void store;
    if (game.current === null) {
      game.current = StartGame("game-container", store, (startup) => {
        callbackRef.current?.(startup);
      });
    }

    return () => {
      if (game.current) {
        game.current.destroy(true);
        game.current = null;
      }
    };
  }, [store]);

  return <div id="game-container"></div>;
}
