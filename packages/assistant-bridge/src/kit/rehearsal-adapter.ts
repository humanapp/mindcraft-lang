import type { ExecutionContext, IBrainDef, MindcraftEnvironment, MindcraftModule } from "@mindcraft-lang/core/app";
import type { BrainBuildDiagnostic } from "@mindcraft-lang/core/brain/compiler";
import type { BrainJson } from "@mindcraft-lang/core/brain/model";
import { brainJsonWithRulesEmptied } from "@mindcraft-lang/core/brain/model";
import type { HandleId, IBrainRuntime, NumberPrecision } from "@mindcraft-lang/core/runtime";
import { HandleOutcome } from "@mindcraft-lang/core/runtime";
import type {
  GateObservation,
  PageSwitchObservation,
  ScenarioInput,
  ScenarioInputKind,
  SimulationRequest,
  SimulationRun,
  TargetAdapter,
  TargetManifest,
  ThinkObservation,
} from "../target/adapter.js";
import { ADAPTER_CONTRACT_VERSION, DispatchOutcome } from "../target/adapter.js";
import { ruleIdsByPath } from "../tools/workspace.js";
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
  inputKinds?(): readonly ScenarioInputKind[];
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
 * Durable rule id per program funcId for `brainDef`, so what the run observes
 * is reported under the id the document addresses each rule by. Throws
 * {@link RehearsalRejection} when the brain does not build in `environment`.
 */
function ruleFuncIdRuleIds(environment: MindcraftEnvironment, brainDef: IBrainDef): Map<number, string> {
  const build = environment.linkBrain(brainDef);
  if (!build.program) {
    const errors: BrainBuildDiagnostic[] = [];
    build.diagnostics.forEach((diag) => {
      if (diag.severity === "error") errors.push(diag);
    });
    throw new RehearsalRejection(RehearsalRejectionCode.BrainDoesNotBuild, errors);
  }
  const byPath = ruleIdsByPath(brainDef);
  const ruleIds = new Map<number, string>();
  build.program.ruleIndex.forEach((funcId, rulePath) => {
    const ruleId = byPath.get(rulePath);
    if (ruleId !== undefined) ruleIds.set(funcId, ruleId);
  });
  return ruleIds;
}

/** How a run reports the terminal state a call's handle settled in. */
function outcomeOf(outcome: HandleOutcome): DispatchOutcome {
  if (outcome === HandleOutcome.REJECTED) return DispatchOutcome.Rejected;
  if (outcome === HandleOutcome.CANCELLED) return DispatchOutcome.Cancelled;
  return DispatchOutcome.Resolved;
}

/** A dispatch the recorder is still filling in as the call's lifecycle unfolds. */
type RecordedDispatch = {
  action: string;
  args: readonly string[];
  ruleId?: string;
  output?: string;
  outcome?: DispatchOutcome;
  settledAfter?: number;
};

/** One call whose handle has not settled yet, with the think it was made on. */
interface InFlightCall {
  readonly dispatch: RecordedDispatch;
  readonly think: number;
}

/**
 * Collects what the participant under study did, one think at a time, from the
 * event stream of its own brain.
 */
class SubjectRecorder {
  private readonly ruleIds = new Map<number, string>();
  private subject: RunningSubject | undefined;
  private gates: GateObservation[] = [];
  private dispatches: RecordedDispatch[] = [];
  private waiting: string[] = [];
  private quiesced: string[] = [];
  private pageSwitch: PageSwitchObservation | undefined;
  /** Index of the page just left, held until the page entered is known. */
  private leftPage: number | undefined;
  private readonly thinks: ThinkObservation[] = [];
  /** Zero-based index of the think being recorded. */
  private think = 0;
  /** Calls whose handle is still pending, keyed by the handle they settle on. */
  private readonly inFlight = new Map<HandleId, InFlightCall>();
  /** The rule parked on each handle, for the handles a rule is parked on. */
  private readonly parkedOn = new Map<HandleId, string>();
  /** The call awaiting its return report, with the output name the action declares. */
  private returning: { dispatch: RecordedDispatch; outputName: string | undefined } | undefined;
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

  /** Bind the rule ids of the brain under study; call before the subject appears. */
  bindRuleIds(ruleIds: ReadonlyMap<number, string>): void {
    for (const [funcId, ruleId] of ruleIds) this.ruleIds.set(funcId, ruleId);
  }

  /** One think of the participant under study per entry, in order. */
  observations(): readonly ThinkObservation[] {
    return this.thinks;
  }

  /**
   * Start recording the participant under study: its brain's WHEN gates, the
   * host actions it dispatches and how each of those calls ends, the rules it
   * parks and holds, and the pages it switches between. Everything a call
   * carried is rendered as the event arrives, while the values are still the
   * ones the call saw.
   */
  observeSubject(subject: RunningSubject): void {
    if (this.subject) return;
    this.subject = subject;
    this.recording = true;
    const events = subject.brain.events();
    events.on("rule_when_evaluated", ({ ruleFuncId, result, fired }) => {
      if (!this.recording) return;
      const ruleId = this.ruleId(ruleFuncId);
      this.running(ruleId);
      this.gates.push({
        ruleId,
        fired,
        result: renderValue(result, this.numberText, this.labelOf),
      });
    });
    events.on("host_action_dispatched", ({ descriptor, args, ruleFuncId, handleId }) => {
      if (!this.recording) return;
      const ruleId = ruleFuncId === undefined ? undefined : this.ruleId(ruleFuncId);
      if (ruleId) this.running(ruleId);
      const dispatch: RecordedDispatch = {
        action: descriptor.key,
        args: renderArgs(descriptor.callDef.argSlots, args, this.nameOf, this.numberText, this.labelOf),
        ...(ruleId ? { ruleId } : {}),
      };
      this.dispatches.push(dispatch);
      this.returning = { dispatch, outputName: descriptor.outputs?.[0]?.name };
      if (handleId !== undefined) this.inFlight.set(handleId, { dispatch, think: this.think });
    });
    events.on("host_action_returned", ({ result }) => {
      const returning = this.returning;
      this.returning = undefined;
      if (!this.recording || !returning || result === undefined || returning.outputName === undefined) return;
      returning.dispatch.output = `${returning.outputName}=${renderValue(result, this.numberText, this.labelOf)}`;
    });
    events.on("fiber_waiting", ({ handleId, ruleFuncId }) => {
      if (!this.recording || ruleFuncId === undefined) return;
      const ruleId = this.ruleId(ruleFuncId);
      this.parkedOn.set(handleId, ruleId);
      if (!this.waiting.includes(ruleId)) this.waiting.push(ruleId);
    });
    events.on("handle_settled", ({ handleId, outcome }) => {
      if (!this.recording) return;
      this.unpark(handleId);
      const call = this.inFlight.get(handleId);
      if (!call) return;
      this.inFlight.delete(handleId);
      const settledAfter = this.think - call.think;
      if (settledAfter > 0) call.dispatch.settledAfter = settledAfter;
      if (settledAfter > 0 || outcome !== HandleOutcome.RESOLVED) call.dispatch.outcome = outcomeOf(outcome);
    });
    events.on("root_rule_quiesced", ({ ruleFuncId }) => {
      if (!this.recording) return;
      this.quiesced.push(this.ruleId(ruleFuncId));
    });
    events.on("page_deactivated", ({ pageIndex }) => {
      if (!this.recording) return;
      // Leaving a page cancels every fiber it had running, parked ones included.
      this.parkedOn.clear();
      this.waiting = [];
      this.leftPage = pageIndex;
    });
    events.on("page_activated", ({ pageIndex }) => {
      if (!this.recording) return;
      const from = this.leftPage;
      this.leftPage = undefined;
      this.pageSwitch = from === undefined ? { to: pageIndex } : { from, to: pageIndex };
    });
  }

  /** Stop recording; called once the participant under study has left the world. */
  release(): void {
    this.recording = false;
  }

  /**
   * Close the run: every call still in flight ended nowhere the run could see,
   * so it is reported as unended. Call it once the last think is closed.
   */
  closeRun(): void {
    for (const call of this.inFlight.values()) call.dispatch.outcome = DispatchOutcome.Pending;
    this.inFlight.clear();
  }

  /** Close the current think, keeping it only while the participant under study lives. */
  closeThink(): void {
    if (this.recording) {
      this.thinks.push({
        gates: this.gates,
        dispatches: this.dispatches,
        ...(this.waiting.length > 0 ? { waiting: [...this.waiting] } : {}),
        ...(this.quiesced.length > 0 ? { quiesced: this.quiesced } : {}),
        ...(this.pageSwitch ? { pageSwitch: this.pageSwitch } : {}),
      });
    }
    this.gates = [];
    this.dispatches = [];
    this.quiesced = [];
    this.pageSwitch = undefined;
    this.think++;
  }

  /** Note that `ruleId` is executing, so it is no longer parked on anything. */
  private running(ruleId: string): void {
    const index = this.waiting.indexOf(ruleId);
    if (index < 0) return;
    this.waiting.splice(index, 1);
    for (const [handleId, parked] of this.parkedOn) {
      if (parked === ruleId) this.parkedOn.delete(handleId);
    }
  }

  /** Note that whatever rule was parked on `handleId` is parked no longer. */
  private unpark(handleId: HandleId): void {
    const ruleId = this.parkedOn.get(handleId);
    if (ruleId === undefined) return;
    this.parkedOn.delete(handleId);
    const index = this.waiting.indexOf(ruleId);
    if (index >= 0) this.waiting.splice(index, 1);
  }

  private ruleId(ruleFuncId: number | undefined): string {
    if (ruleFuncId === undefined) return "unattributed";
    return this.ruleIds.get(ruleFuncId) ?? `funcId:${ruleFuncId}`;
  }
}

/**
 * The scenario's inputs ordered by the think they are applied before, keeping
 * scenario order among entries sharing one think. Throws
 * {@link ScenarioRejection} when an entry names a kind `driver` does not
 * register.
 */
function scheduledInputs(driver: WorldDriver, inputs: readonly ScenarioInput[]): readonly ScenarioInput[] {
  const names = (driver.inputKinds?.() ?? []).map((kind) => kind.name);
  const unknown = [...new Set(inputs.filter((input) => !names.includes(input.kind)).map((input) => input.kind))];
  if (unknown.length > 0) {
    throw new ScenarioRejection(ScenarioRejectionCode.UnknownInputKind, unknown, [...names].sort());
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
  recorder.bindRuleIds(ruleFuncIdRuleIds(environment, subjectBrain));

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
  recorder.closeRun();

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
