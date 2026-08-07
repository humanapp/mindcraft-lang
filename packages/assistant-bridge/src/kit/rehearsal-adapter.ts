import type { ExecutionContext, IBrainDef, MindcraftEnvironment, MindcraftModule } from "@mindcraft-lang/core/app";
import type { BrainBuildDiagnostic } from "@mindcraft-lang/core/brain/compiler";
import type { BrainJson } from "@mindcraft-lang/core/brain/model";
import { brainJsonWithRulesEmptied } from "@mindcraft-lang/core/brain/model";
import type { IBrainRuntime, NumberPrecision } from "@mindcraft-lang/core/runtime";
import type {
  DispatchObservation,
  GateObservation,
  ScenarioInput,
  SimulationRequest,
  SimulationRun,
  TargetAdapter,
  TargetManifest,
  ThinkObservation,
} from "../target/adapter.js";
import { ADAPTER_CONTRACT_VERSION } from "../target/adapter.js";
import { createRehearsalEnvironment, createSeededRng } from "./environment.js";
import type { NumberText, ValueLabel } from "./value-text.js";
import { createTileNamer, createValueLabeler, renderArgs, renderValue } from "./value-text.js";

/** Why a rehearsal adapter refused to stage a scenario. */
export const ScenarioRejectionCode = {
  /** The scenario named a subject the driver does not offer. */
  UnknownSubject: "scenario_unknown_subject",
  /** The scenario carried an input of a kind the driver does not register. */
  UnknownInputKind: "scenario_unknown_input_kind",
} as const;

/** Why a rehearsal adapter refused to stage a scenario. */
export type ScenarioRejectionCode = (typeof ScenarioRejectionCode)[keyof typeof ScenarioRejectionCode];

/** A scenario a rehearsal adapter refused to stage, carrying the reason as a code. */
export class ScenarioRejection extends Error {
  constructor(
    readonly code: ScenarioRejectionCode,
    /** What the scenario named that the driver does not offer, in first-seen order. */
    readonly named: readonly string[],
    /** What the driver does offer, sorted. */
    readonly offered: readonly string[]
  ) {
    super(`${code}: ${named.join(", ")}; the target offers ${offered.join(", ") || "none"}`);
    this.name = "ScenarioRejection";
  }
}

/** Why a rehearsal adapter could not run the brain it was given. */
export const RehearsalRejectionCode = {
  /** The brain does not build, so there was no program to run. */
  BrainDoesNotBuild: "rehearsal_brain_does_not_build",
} as const;

/** Why a rehearsal adapter could not run the brain it was given. */
export type RehearsalRejectionCode = (typeof RehearsalRejectionCode)[keyof typeof RehearsalRejectionCode];

/**
 * A brain a rehearsal adapter could not run, carrying the reason as a code and
 * the build errors that stopped it. A rehearsal that raises this staged no
 * world and observed nothing.
 */
export class RehearsalRejection extends Error {
  constructor(
    readonly code: RehearsalRejectionCode,
    /** The error-severity build diagnostics, in the order the build reported them. */
    readonly diagnostics: readonly BrainBuildDiagnostic[]
  ) {
    super(`${code}: ${diagnostics.map((diag) => `${diag.code}@${diag.params?.rulePath ?? "document"}`).join(", ")}`);
    this.name = "RehearsalRejection";
  }
}

/**
 * The participant a rehearsal is watching: the brain it is running, and the
 * test that recognizes its executions.
 */
export interface RunningSubject {
  /** The running brain of the participant under study; a rehearsal reads its event stream. */
  readonly brain: Pick<IBrainRuntime, "events">;
  /** True when `ctx` is an execution of that participant. */
  runs(ctx: ExecutionContext): boolean;
}

/** What the kit hands a world driver to stage one rehearsal. */
export interface WorldStaging {
  /** The environment the world runs in, carrying core's modules and the target's. */
  readonly environment: MindcraftEnvironment;
  /** Population role the brain under study drives; one of the driver's own subjects. */
  readonly subject: string;
  /**
   * The brain under study, already deserialized into {@link environment}, with
   * any rules the run leaves out already emptied in it. Copying it is safe:
   * what the run excludes is part of the document.
   */
  readonly subjectBrain: IBrainDef;
  /**
   * Percepts this run scripts, ascending by `at`; every entry names a kind the
   * driver registered. Empty when the scenario scripts none.
   */
  readonly inputs: readonly ScenarioInput[];
  /** The run's seeded random stream; every random choice the world makes must draw from it. */
  next(): number;
  /**
   * Report the participant running the brain under study. Call it once, as soon
   * as that participant starts executing; nothing is observed before it.
   */
  observeSubject(subject: RunningSubject): void;
}

/** A staged world the kit's run loop advances. */
export interface RehearsalWorld {
  /** Advance the world one fixed think. */
  step(): void;
  /** True while the participant under study is still in the world. */
  subjectPresent(): boolean;
  /** Brain-driven participants standing right now. */
  participants(): number;
  /** Distinct brains that have executed in this world, the subject's included. */
  brainsExecuted(): number;
  /** Tear the world down; no step follows. */
  shutdown(): void;
}

/**
 * What a target supplies to become rehearsable: the tiles its brains are
 * written in, the roles a scenario may put under study, and how its world is
 * staged and stepped. Nothing here presumes entities, positions, or physics.
 */
export interface WorldDriver {
  /** Mindcraft modules this target installs into a rehearsal environment, beyond core's own. */
  modules(): readonly MindcraftModule[];
  /** Population roles a scenario may name as its subject. */
  subjects(): readonly string[];
  /**
   * Percept kinds this target reads out of a scenario. Omit the method to
   * register none, which refuses every scripted input.
   */
  inputKinds?(): readonly string[];
  /**
   * Precision the target's device computes numbers at, applied to every brain
   * in the rehearsal environment. Omit the method for the host's native double
   * precision.
   */
  precision?(): NumberPrecision;
  /** Stage one world, ready for its first {@link RehearsalWorld.step}. */
  stage(staging: WorldStaging): Promise<RehearsalWorld>;
}

/** What a rehearsal adapter is built from. */
export interface RehearsalAdapterOptions {
  /**
   * Mindcraft identity of the target the artifact is. Inject it at build time
   * from the `identity` the target's own `mindcraft.json` declares.
   */
  readonly targetIdentity: string;
  /** Facts about this world, stated to the model before it plans. */
  readonly manifest: TargetManifest;
  /** The documentation markdown this target ships for its own tiles, keyed by tile id. */
  tileDocs(): ReadonlyMap<string, string>;
  readonly driver: WorldDriver;
}

/**
 * Rule path per program funcId for `brainDef`. Throws {@link RehearsalRejection}
 * when the brain does not build in `environment`.
 */
function ruleFuncIdPaths(environment: MindcraftEnvironment, brainDef: IBrainDef): Map<number, string> {
  const build = environment.linkBrain(brainDef);
  if (!build.program) {
    const errors: BrainBuildDiagnostic[] = [];
    build.diagnostics.forEach((diag) => {
      if (diag.severity === "error") errors.push(diag);
    });
    throw new RehearsalRejection(RehearsalRejectionCode.BrainDoesNotBuild, errors);
  }
  const paths = new Map<number, string>();
  build.program.ruleIndex.forEach((funcId, rulePath) => {
    paths.set(funcId, rulePath);
  });
  return paths;
}

/**
 * Collects what the participant under study did, one think at a time, from the
 * event stream of its own brain.
 */
class SubjectRecorder {
  private readonly rulePaths = new Map<number, string>();
  private subject: RunningSubject | undefined;
  private gates: GateObservation[] = [];
  private dispatches: DispatchObservation[] = [];
  private readonly thinks: ThinkObservation[] = [];
  /** `false` once the participant under study is gone, after which nothing is recorded. */
  private recording = false;

  /**
   * @param nameOf - Name a tile reads by, for the arguments a dispatch carried.
   * @param numberText - How a number renders, at the run's own precision.
   * @param labelOf - The word a dispatched struct or list value reads by.
   */
  constructor(
    private readonly nameOf: (tileId: string) => string,
    private readonly numberText: NumberText,
    private readonly labelOf: ValueLabel
  ) {}

  /** Bind the rule paths of the brain under study; call before the subject appears. */
  bindRulePaths(rulePaths: ReadonlyMap<number, string>): void {
    for (const [funcId, path] of rulePaths) this.rulePaths.set(funcId, path);
  }

  /** One think of the participant under study per entry, in order. */
  observations(): readonly ThinkObservation[] {
    return this.thinks;
  }

  /**
   * Start recording the participant under study: its brain's WHEN gates and the
   * host actions it dispatches. Both are rendered as the events arrive, while
   * the values they carry are still the ones the call saw.
   */
  observeSubject(subject: RunningSubject): void {
    if (this.subject) return;
    this.subject = subject;
    this.recording = true;
    const events = subject.brain.events();
    events.on("rule_when_evaluated", ({ ruleFuncId, result, fired }) => {
      if (!this.recording) return;
      this.gates.push({
        ruleId: this.ruleId(ruleFuncId),
        fired,
        result: renderValue(result, this.numberText, this.labelOf),
      });
    });
    events.on("host_action_dispatched", ({ descriptor, args, ruleFuncId }) => {
      if (!this.recording) return;
      const ruleId = ruleFuncId === undefined ? undefined : this.ruleId(ruleFuncId);
      this.dispatches.push({
        action: descriptor.key,
        args: renderArgs(descriptor.callDef.argSlots, args, this.nameOf, this.numberText, this.labelOf),
        ...(ruleId ? { ruleId } : {}),
      });
    });
  }

  /** Stop recording; called once the participant under study has left the world. */
  release(): void {
    this.recording = false;
  }

  /** Close the current think, keeping it only while the participant under study lives. */
  closeThink(): void {
    if (this.recording) {
      this.thinks.push({ gates: this.gates, dispatches: this.dispatches });
    }
    this.gates = [];
    this.dispatches = [];
  }

  private ruleId(ruleFuncId: number | undefined): string {
    if (ruleFuncId === undefined) return "unattributed";
    return this.rulePaths.get(ruleFuncId) ?? `funcId:${ruleFuncId}`;
  }
}

/**
 * The scenario's inputs ordered by the think they are applied before, keeping
 * scenario order among entries sharing one think. Throws
 * {@link ScenarioRejection} when an entry names a kind `driver` does not
 * register.
 */
function scheduledInputs(driver: WorldDriver, inputs: readonly ScenarioInput[]): readonly ScenarioInput[] {
  const kinds = driver.inputKinds?.() ?? [];
  const unknown = [...new Set(inputs.filter((input) => !kinds.includes(input.kind)).map((input) => input.kind))];
  if (unknown.length > 0) {
    throw new ScenarioRejection(ScenarioRejectionCode.UnknownInputKind, unknown, [...kinds].sort());
  }
  return [...inputs].sort((a, b) => a.at - b.at);
}

/** Run one rehearsal end to end over `driver`. */
async function rehearse(options: RehearsalAdapterOptions, request: SimulationRequest): Promise<SimulationRun> {
  const { driver } = options;
  const { subject, seed } = request.scenario;
  const subjects = driver.subjects();
  if (!subjects.includes(subject)) {
    throw new ScenarioRejection(ScenarioRejectionCode.UnknownSubject, [subject], [...subjects].sort());
  }
  const inputs = scheduledInputs(driver, request.scenario.inputs ?? []);

  const next = createSeededRng(seed);
  const environment = createRehearsalEnvironment({
    modules: driver.modules(),
    rng: next,
    precision: driver.precision?.(),
  });
  const numberText: NumberText = (value) => environment.appServices.numerics.formatNumber(value);
  const recorder = new SubjectRecorder(
    createTileNamer(() => environment.tileCatalogs(), environment.appServices.localizer),
    numberText,
    createValueLabeler(() => environment.tileCatalogs(), numberText)
  );

  const subjectBrain = environment.deserializeBrainJson(
    brainJsonWithRulesEmptied(request.brainDef.toJson() as BrainJson, request.excludedRules ?? [])
  );
  recorder.bindRulePaths(ruleFuncIdPaths(environment, subjectBrain));

  const world = await driver.stage({
    environment,
    subject,
    subjectBrain,
    inputs,
    next,
    observeSubject: (running) => {
      recorder.observeSubject(running);
    },
  });

  // A world may populate during its first step, so the starting population is
  // the one standing after that step.
  let initialPopulation = 0;
  for (let think = 0; think < request.thinks; think++) {
    world.step();
    if (think === 0) initialPopulation = world.participants();
    if (!world.subjectPresent()) recorder.release();
    recorder.closeThink();
  }

  const finalPopulation = world.participants();
  const brainsExecuted = world.brainsExecuted();
  world.shutdown();

  const observations = recorder.observations();
  return {
    thinks: observations.length,
    observations,
    world: { initialPopulation, finalPopulation, brainsExecuted },
  };
}

/**
 * Build a target adapter over a world driver: the kit owns the seeded
 * environment, the brain substitution, gate and dispatch observation, the run
 * loop, and the run packaging; the driver owns only its world.
 *
 * This API is provisional.
 */
export function createRehearsalAdapter(options: RehearsalAdapterOptions): TargetAdapter {
  return {
    contractVersion: ADAPTER_CONTRACT_VERSION,
    targetIdentity: options.targetIdentity,
    manifest: () => options.manifest,
    modules: () => options.driver.modules(),
    tileDocs: () => options.tileDocs(),
    subjects: () => options.driver.subjects(),
    inputKinds: () => options.driver.inputKinds?.() ?? [],
    run: (request: SimulationRequest) => rehearse(options, request),
  };
}
