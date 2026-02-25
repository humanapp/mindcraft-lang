import { AUTO, Game, Scale } from "phaser";
import { QwopScene } from "./scenes/QwopScene";

const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  width: 1024,
  height: 600,
  parent: "game-container",
  backgroundColor: "#87CEEB",
  scale: {
    mode: Scale.FIT,
    autoCenter: Scale.CENTER_BOTH,
  },
  physics: {
    default: "matter",
    matter: {
      gravity: { x: 0, y: 1 },
      debug: false,
    },
  },
  scene: [QwopScene],
};

export const SCENE_READY_KEY = "__onSceneReady";

const StartGame = (parent: string, onSceneReady?: (scene: Phaser.Scene) => void) => {
  const game = new Game({ ...config, parent });
  if (onSceneReady) {
    game.registry.set(SCENE_READY_KEY, onSceneReady);
  }
  return game;
};

export default StartGame;
