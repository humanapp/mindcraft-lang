import type { IBrainDef, MindcraftEnvironment, MindcraftModule } from "@mindcraft-lang/core/app";
import type { BrainJson } from "@mindcraft-lang/core/brain/model";
import type { Actor, Archetype } from "@/brain/actor";
import { ARCHETYPE_NAMES } from "@/brain/archetypes";
import { createEcosimModule } from "@/brain/index";
import { ecosimTileDocs } from "./tile-docs";
import { renderValue } from "./value-text";
import { createRehearsalWorld, type WorldObserver } from "./world";

/** Facts about this world that a session states before it plans. */
export interface TargetManifest {
  /** Target platform name, as a person would read it. */
  readonly target: string;
  /**
   * What the person is programming, as a noun phrase a prompt reads inline,
   * for example "their creature".
   */
  readonly thing: string;
  /** What the target's body provides, one plain sentence per entry. */
  readonly provides: readonly string[];
}

/** The staged world one rehearsal runs. */
export interface SimulationScenario {
  /** Seed for every random choice the run makes; the same seed reproduces the run exactly. */
  readonly seed: number;
  /** Population role the brain under study drives, from {@link TargetAdapter.subjects}. */
  readonly subject: string;
}

/** One rehearsal request. */
export interface SimulationRequest {
  /** Brain the subject role executes for this run. */
  readonly brainDef: IBrainDef;
  readonly scenario: SimulationScenario;
  /** Number of fixed-step thinks to run. */
  readonly thinks: number;
}

/** One rule's WHEN gate on one think. */
export interface GateObservation {
  /** Rule id in `pageIndex/ruleIndex[/childIndex...]` form. */
  readonly ruleId: string;
  /** `true` when the gate passed and the rule's DO section ran. */
  readonly fired: boolean;
  /** The value the WHEN section produced, rendered compactly. */
  readonly result: string;
}

/** One host action the brain under study dispatched on one think. */
export interface DispatchObservation {
  /** Stable action key, for example `actuator.move`. */
  readonly action: string;
  /** Rule the dispatch was attributed to, absent when the runtime could not attribute it. */
  readonly ruleId?: string;
}

/** Everything observed of the brain under study during one think. */
export interface ThinkObservation {
  readonly gates: readonly GateObservation[];
  readonly dispatches: readonly DispatchObservation[];
}

/** What the staged world looked like, independent of the brain under study. */
export interface WorldObservation {
  /** Entities alive when the run started. */
  readonly initialPopulation: number;
  /** Entities alive when the run ended. */
  readonly finalPopulation: number;
  /** Distinct brains that executed during the run, the subject's included. */
  readonly brainsExecuted: number;
}

/** One completed rehearsal. */
export interface SimulationRun {
  /** Thinks the subject actually executed; at most the requested count. */
  readonly thinks: number;
  /** One entry per executed think, in order. */
  readonly observations: readonly ThinkObservation[];
  readonly world: WorldObservation;
}

/**
 * A target's headless integration surface: what an authoring session installs
 * to edit this world's brains, what it tells the author about the world, and
 * how a brain is rehearsed in it.
 */
export interface TargetAdapter {
  /** Id this target is registered under. */
  readonly targetId: string;
  /** Facts about this world, stated to the author before planning. */
  manifest(): TargetManifest;
  /** Mindcraft modules this target installs into an authoring environment, beyond core's own. */
  modules(): readonly MindcraftModule[];
  /** The documentation markdown this target ships for its own tiles, keyed by tile id. */
  tileDocs(): ReadonlyMap<string, string>;
  /** Population roles a scenario may name as its subject. */
  subjects(): readonly string[];
  /**
   * Run one rehearsal. Throws if `scenario.subject` is not one of
   * {@link subjects} or the brain does not build.
   */
  run(request: SimulationRequest): Promise<SimulationRun>;
}

/** Rule path per program funcId for `brainDef`, from its own link result. */
function ruleFuncIdPaths(env: MindcraftEnvironment, brainDef: IBrainDef): Map<number, string> {
  const build = env.linkBrain(brainDef);
  const paths = new Map<number, string>();
  build.program?.ruleIndex.forEach((funcId, rulePath) => {
    paths.set(funcId, rulePath);
  });
  return paths;
}

/** Collects what the entity under study did, one tick at a time. */
class SubjectRecorder implements WorldObserver {
  /** Actor id of the entity under study; unset until its first spawn. */
  private subjectActorId: number | undefined;
  /** Rule path per program funcId, from the linked brain under study. */
  private readonly rulePaths = new Map<number, string>();
  private gates: GateObservation[] = [];
  private dispatches: DispatchObservation[] = [];
  private readonly ticks: ThinkObservation[] = [];
  /** `false` once the entity under study is gone, after which nothing is recorded. */
  private recording = false;

  constructor(private readonly subject: Archetype) {}

  /** Bind the rule paths of the brain under study; call before the first spawn. */
  bindRulePaths(rulePaths: ReadonlyMap<number, string>): void {
    for (const [funcId, path] of rulePaths) this.rulePaths.set(funcId, path);
  }

  /** One think of the entity under study per entry, in order. */
  observations(): readonly ThinkObservation[] {
    return this.ticks;
  }

  /** True when `actorId` is the entity under study. */
  isSubject(actorId: number): boolean {
    return this.recording && actorId === this.subjectActorId;
  }

  /**
   * Take the first actor spawned in the subject role as the entity under study
   * and start recording its brain; later ones run their brains unobserved.
   */
  onSpawn(actor: Actor): void {
    if (actor.archetype !== this.subject || this.subjectActorId !== undefined) return;
    this.subjectActorId = actor.actorId;
    this.recording = true;
    actor.brain.events().on("rule_when_evaluated", ({ ruleFuncId, result, fired }) => {
      if (!this.recording) return;
      this.gates.push({ ruleId: this.ruleId(ruleFuncId), fired, result: renderValue(result) });
    });
  }

  /** Stop recording; called once the entity under study has left the world. */
  release(): void {
    this.recording = false;
  }

  /** Record one host action the entity under study dispatched. */
  onDispatch(actorId: number, action: string, ruleFuncId: number | undefined): void {
    if (!this.isSubject(actorId)) return;
    const ruleId = ruleFuncId === undefined ? undefined : this.ruleId(ruleFuncId);
    this.dispatches.push({ action, ...(ruleId ? { ruleId } : {}) });
  }

  /** Close the current tick, keeping it only while the entity under study lives. */
  closeTick(): void {
    if (this.recording) {
      this.ticks.push({ gates: this.gates, dispatches: this.dispatches });
    }
    this.gates = [];
    this.dispatches = [];
  }

  private ruleId(ruleFuncId: number | undefined): string {
    if (ruleFuncId === undefined) return "unattributed";
    return this.rulePaths.get(ruleFuncId) ?? `funcId:${ruleFuncId}`;
  }
}

/** Id this target is registered under. */
const TARGET_ID = "ecosim";

const MANIFEST: TargetManifest = {
  target: "ecosim, a top-down world of creatures",
  thing: "their creature",
  provides: [
    "A creature can see other creatures in front of it and can feel a bump when one touches it.",
    "A creature can move, turn, eat, shoot, and say something out loud.",
    "Creatures come in three kinds: carnivores, herbivores, and plants.",
  ],
};

/**
 * The ecosim target adapter: installs the ecosim module for authoring, and
 * rehearses a brain by running a whole ecosim world headlessly at a fixed
 * timestep with the brain under study driving one archetype's population.
 */
export function createTargetAdapter(): TargetAdapter {
  return {
    targetId: TARGET_ID,
    manifest: () => MANIFEST,
    modules: () => [createEcosimModule()],
    tileDocs: () => ecosimTileDocs(),
    subjects: () => [...ARCHETYPE_NAMES],
    run: async (request: SimulationRequest): Promise<SimulationRun> => {
      const subject = request.scenario.subject as Archetype;
      if (!ARCHETYPE_NAMES.includes(subject)) {
        throw new Error(`unknown subject: ${request.scenario.subject}`);
      }

      const recorder = new SubjectRecorder(subject);
      const world = await createRehearsalWorld({
        seed: request.scenario.seed,
        observer: recorder,
        brains: (environment) => {
          const runBrain = environment.deserializeBrainJson(request.brainDef.toJson() as BrainJson);
          recorder.bindRulePaths(ruleFuncIdPaths(environment, runBrain));
          return { [subject]: runBrain };
        },
      });

      // The world populates during its first step, so the starting population
      // is the one standing after that step.
      let initialPopulation = 0;
      for (let tick = 0; tick < request.thinks; tick++) {
        world.step();
        const alive = world.actors();
        if (tick === 0) initialPopulation = alive.length;
        if (!alive.some((actor) => recorder.isSubject(actor.actorId))) {
          recorder.release();
        }
        recorder.closeTick();
      }

      const alive = world.actors();
      const brainsExecuted = new Set(alive.map((actor) => actor.brainDef)).size;
      world.shutdown();

      const observations = recorder.observations();
      return {
        thinks: observations.length,
        observations,
        world: { initialPopulation, finalPopulation: alive.length, brainsExecuted },
      };
    },
  };
}
