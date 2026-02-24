import { Scene } from "phaser";
import type { Archetype } from "@/brain/actor";
import { deserializeBrainFromArrayBuffer, setDefaultBrain } from "@/services/brain-persistence";

const DEFAULT_BRAIN_ARCHETYPES: Archetype[] = ["carnivore", "herbivore", "plant"];

export class Preloader extends Scene {
  constructor() {
    super("Preloader");
  }

  init() {
    //  A simple progress bar. This is the outline of the bar.
    this.add.rectangle(512, 384, 468, 32).setStrokeStyle(1, 0xffffff);

    //  This is the progress bar itself. It will increase in size from the left based on the % of progress.
    const bar = this.add.rectangle(512 - 230, 384, 4, 28, 0xffffff);

    //  Use the 'progress' event emitted by the LoaderPlugin to update the loading bar
    this.load.on("progress", (progress: number) => {
      //  Update the progress bar (our bar is 464px wide, so 100% = 464px)
      bar.width = 4 + 460 * progress;
    });
  }

  preload() {
    //  Load the assets for the game
    this.load.setPath("assets");

    // Load default .brain files for each archetype
    for (const archetype of DEFAULT_BRAIN_ARCHETYPES) {
      this.load.binary(`default-brain-${archetype}`, `brain/defs/default-${archetype}.brain`);
    }
  }

  create() {
    // Deserialize default brains from loaded binary assets and cache them
    for (const archetype of DEFAULT_BRAIN_ARCHETYPES) {
      const data = this.cache.binary.get(`default-brain-${archetype}`) as ArrayBuffer | undefined;
      if (data) {
        const brainDef = deserializeBrainFromArrayBuffer(data);
        if (brainDef) {
          setDefaultBrain(archetype, brainDef);
          console.log(`Default brain loaded for ${archetype}`);
        }
      }
    }

    this.scene.start("Playground");
  }
}
