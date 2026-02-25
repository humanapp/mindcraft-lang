import { useLayoutEffect, useRef } from "react";
import StartGame from "./game/main";

interface PhaserGameProps {
  onSceneReady?: (scene: Phaser.Scene) => void;
}

export function PhaserGame({ onSceneReady }: PhaserGameProps) {
  const game = useRef<Phaser.Game | null>(null);
  const callbackRef = useRef(onSceneReady);
  callbackRef.current = onSceneReady;

  useLayoutEffect(() => {
    if (game.current === null) {
      game.current = StartGame("game-container", (scene) => {
        callbackRef.current?.(scene);
      });
    }

    return () => {
      if (game.current) {
        game.current.destroy(true);
        game.current = null;
      }
    };
  }, []);

  return <div id="game-container" />;
}
