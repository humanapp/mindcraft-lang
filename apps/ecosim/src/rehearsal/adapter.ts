import type { TargetAdapter, TargetManifest } from "@mindcraft-lang/assistant-bridge";
import type { RehearsalWorld, WorldDriver, WorldStaging } from "@mindcraft-lang/assistant-bridge/kit";
import { createRehearsalAdapter } from "@mindcraft-lang/assistant-bridge/kit";
import type { Actor, Archetype } from "@/brain/actor";
import { ARCHETYPE_NAMES } from "@/brain/archetypes";
import { getSelf } from "@/brain/execution-context-types";
import { createEcosimModule } from "@/brain/index";
import { ecosimTileDocs } from "./tile-docs";
import { createRehearsalWorld } from "./world";

/** Target identity the adapter reports: injected at build time, empty in a source run. */
const IDENTITY = typeof TARGET_IDENTITY === "string" ? TARGET_IDENTITY : "";

const MANIFEST: TargetManifest = {
  target: "ecosim, a top-down world of creatures",
  thing: "their creature",
  provides: [
    "A creature can see other creatures in front of it and can feel a bump when one touches it.",
    "A creature can move, turn, eat, shoot, and say something out loud.",
    "Creatures come in three kinds: carnivores, herbivores, and plants.",
  ],
};

/** Stage one ecosim world with the brain under study driving the subject archetype. */
async function stage(staging: WorldStaging): Promise<RehearsalWorld> {
  const subject = staging.subject as Archetype;
  /** Actor id of the creature under study; unset until its first spawn. */
  let subjectActorId: number | undefined;

  const world = await createRehearsalWorld({
    environment: staging.environment,
    next: staging.next,
    brains: { [subject]: staging.subjectBrain },
    observer: {
      // The first actor spawned in the subject role is the creature under
      // study; later ones run their brains unobserved.
      onSpawn: (actor: Actor) => {
        if (actor.archetype !== subject || subjectActorId !== undefined) return;
        subjectActorId = actor.actorId;
        staging.observeSubject({
          brain: actor.brain,
          runs: (ctx) => getSelf(ctx)?.actorId === subjectActorId,
        });
      },
    },
  });

  return {
    step: () => world.step(),
    subjectPresent: () => world.actors().some((actor) => actor.actorId === subjectActorId),
    participants: () => world.actors().length,
    brainsExecuted: () => new Set(world.actors().map((actor) => actor.brainDef)).size,
    shutdown: () => world.shutdown(),
  };
}

/** The ecosim world driver: a whole seeded world of creatures, stepped at a fixed timestep. */
const driver: WorldDriver = {
  modules: () => [createEcosimModule()],
  subjects: () => [...ARCHETYPE_NAMES],
  stage,
};

/**
 * The ecosim target adapter: installs the ecosim module for authoring, and
 * rehearses a brain by running a whole ecosim world headlessly with the brain
 * under study driving one archetype's population.
 */
export function createTargetAdapter(): TargetAdapter {
  return createRehearsalAdapter({
    targetIdentity: IDENTITY,
    manifest: MANIFEST,
    tileDocs: ecosimTileDocs,
    driver,
  });
}
