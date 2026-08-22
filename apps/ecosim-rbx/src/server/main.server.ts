import { RunService, Workspace } from "@rbxts/services";
import { coreModule, createEntropySeededRng, createWendooEnvironment } from "@wendoo/core/app";
import { createEcosimModule } from "server/brain";
import { Engine } from "server/brain/engine";
import { buildArena } from "server/world/arena";
import { createAppLogger } from "shared/logging";

const log = createAppLogger("server");

const arena = buildArena(Workspace);
const environment = createWendooEnvironment({
  modules: [coreModule(), createEcosimModule()],
  rng: createEntropySeededRng(),
});
const engine = new Engine(environment, arena.obstacles, arena.actorContainer);

engine.loadBrains();
engine.spawnInitialPopulation();

let elapsedMs = 0;
RunService.Heartbeat.Connect((deltaSeconds) => {
  const dtMs = deltaSeconds * 1000;
  elapsedMs += dtMs;
  engine.tick(elapsedMs, dtMs);
});

log.info(
  `Ecosim arena ready: ${arena.obstacles.size()} obstacle(s), ` +
    `${engine.getActorsByArchetype("carnivore").size()} carnivore(s), ` +
    `${engine.getActorsByArchetype("herbivore").size()} herbivore(s), ` +
    `${engine.getActorsByArchetype("plant").size()} plant(s)`
);
