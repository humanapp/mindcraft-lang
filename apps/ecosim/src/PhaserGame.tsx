import { useLayoutEffect, useRef } from "react";
import type { EcosimEnvironmentStore } from "@/services/ecosim-environment-store";
import StartGame from "./game/main";
import type { SceneBrainState } from "./game/scenes/Playground";

interface PhaserGameProps {
  store: EcosimEnvironmentStore;
  /** Called each time the playground scene's brain availability changes. */
  onSceneBrainState?: (state: SceneBrainState) => void;
}

export function PhaserGame({ store, onSceneBrainState }: PhaserGameProps) {
  const game = useRef<Phaser.Game | null>(null);
  const callbackRef = useRef(onSceneBrainState);
  callbackRef.current = onSceneBrainState;

  useLayoutEffect(() => {
    void store;
    if (game.current === null) {
      game.current = StartGame("game-container", store, (state) => {
        callbackRef.current?.(state);
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
