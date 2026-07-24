import { useLayoutEffect, useRef } from "react";
import type { EcosimEnvironmentStore } from "@/services/ecosim-environment-store";
import StartGame from "./game/main";

interface PhaserGameProps {
  store: EcosimEnvironmentStore;
  onSceneReady?: (scene: Phaser.Scene) => void;
}

export function PhaserGame({ store, onSceneReady }: PhaserGameProps) {
  const game = useRef<Phaser.Game | null>(null);
  const callbackRef = useRef(onSceneReady);
  callbackRef.current = onSceneReady;

  useLayoutEffect(() => {
    void store;
    if (game.current === null) {
      game.current = StartGame("game-container", store, (scene) => {
        callbackRef.current?.(scene);
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
