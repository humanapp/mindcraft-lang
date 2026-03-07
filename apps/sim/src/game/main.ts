import { AUTO, Game, Scale } from "phaser";
import { Boot } from "./scenes/Boot";
import { Playground, SCENE_READY_KEY } from "./scenes/Playground";
import { Preloader } from "./scenes/Preloader";

export { SCENE_READY_KEY };

//  Find out more information about the Game Config at:
//  https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  width: 1024,
  height: 768,
  parent: "game-container",
  backgroundColor: "#2d3561",
  scale: {
    mode: Scale.FIT,
    autoCenter: Scale.CENTER_BOTH,
  },
  physics: {
    default: "matter",
    matter: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [Boot, Preloader, Playground],
};

const StartGame = (parent: string, onSceneReady?: (scene: Phaser.Scene) => void) => {
  const game = new Game({ ...config, parent });
  if (onSceneReady) {
    game.registry.set(SCENE_READY_KEY, onSceneReady);
  }
  return game;
};

export default StartGame;
