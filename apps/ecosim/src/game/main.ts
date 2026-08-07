import { AUTO, Game, Scale } from "phaser";
import { WORLD_FPS, WORLD_GRAVITY, WORLD_HEIGHT, WORLD_WIDTH } from "@/brain/world-definition";
import type { EcosimEnvironmentStore } from "@/services/ecosim-environment-store";
import { Boot } from "./scenes/Boot";
import { Playground, SCENE_BRAIN_STATE_KEY, type SceneBrainState } from "./scenes/Playground";
import { Preloader } from "./scenes/Preloader";

export { SCENE_BRAIN_STATE_KEY };

export const STORE_REGISTRY_KEY = "__simStore";

//  Find out more information about the Game Config at:
//  https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  parent: "game-container",
  backgroundColor: "#2d3561",
  fps: { target: WORLD_FPS },
  scale: {
    mode: Scale.FIT,
    autoCenter: Scale.CENTER_BOTH,
  },
  physics: {
    default: "matter",
    matter: {
      gravity: WORLD_GRAVITY,
      debug: false,
    },
  },
  scene: [Boot, Preloader, Playground],
};

const StartGame = (
  parent: string,
  store: EcosimEnvironmentStore,
  onSceneBrainState?: (state: SceneBrainState) => void
) => {
  const game = new Game({ ...config, parent });
  game.registry.set(STORE_REGISTRY_KEY, store);
  if (onSceneBrainState) {
    game.registry.set(SCENE_BRAIN_STATE_KEY, onSceneBrainState);
  }
  return game;
};

export default StartGame;
