import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { useLayoutEffect, useRef } from "react";
import StartGame from "./game/main";

interface PhaserGameProps {
  env: MindcraftEnvironment;
  onSceneReady?: (scene: Phaser.Scene) => void;
}

export function PhaserGame({ env, onSceneReady }: PhaserGameProps) {
  const game = useRef<Phaser.Game | null>(null);
  const callbackRef = useRef(onSceneReady);
  callbackRef.current = onSceneReady;

  useLayoutEffect(() => {
    void env;
    if (game.current === null) {
      game.current = StartGame("game-container", env, (scene) => {
        callbackRef.current?.(scene);
      });
    }

    return () => {
      if (game.current) {
        game.current.destroy(true);
        game.current = null;
      }
    };
  }, [env]);

  return <div id="game-container"></div>;
}
