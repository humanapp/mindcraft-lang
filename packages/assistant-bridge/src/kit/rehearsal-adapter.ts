import type { ExecutionContext, IBrainDef, WendooEnvironment, WendooModule } from "@wendoo/core/app";
import type { BrainBuildDiagnostic } from "@wendoo/core/brain/compiler";
import type { BrainJson } from "@wendoo/core/brain/model";
import { brainJsonWithRulesEmptied } from "@wendoo/core/brain/model";
import type { HandleId, IBrainRuntime, NumberPrecision } from "@wendoo/core/runtime";
import { HandleOutcome } from "@wendoo/core/runtime";
import type {
  GateObservation,
  OperationEnding,
  PageSwitchObservation,
  ScenarioInput,
  ScenarioInputKind,
  SimulationRequest,
  SimulationRun,
  SubjectStateChannel,
  TargetAdapter,
  TargetManifest,
  ThinkObservation,
} from "../target/adapter.js";
import { ADAPTER_CONTRACT_VERSION, DispatchOutcome } from "../target/adapter.js";
import { locateRules, ruleIdsByPath } from "../tools/workspace.js";
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
  /** The staged world holds no tile for something the document names. */
  TilesUnresolved: "rehearsal_tiles_unresolved",
} as const;

/** Why a rehearsal adapter could not run the brain it was given. */
export type RehearsalRejectionCode = (typeof RehearsalRejectionCode)[keyof typeof RehearsalRejectionCode];

/**
 * A brain a rehearsal adapter could not run, carrying the reason as a code and
 * what stopped it: the build errors for a brain that does not build, and the
 * tile ids the staged world could not resolve for one whose tiles are not all
 * present. A rehearsal that raises this staged no world and observed nothing.
 */
export class RehearsalRejection extends Error {
  constructor(
    readonly code: RehearsalRejectionCode,
    /** The error-severity build diagnostics, in the order the build reported them; empty when the build was not reached. */
    readonly diagnostics: readonly BrainBuildDiagnostic[],
    /** Tile ids the staged world resolved nothing for, in document order; empty when every tile resolved. */
    readonly unresolvedTiles: readonly string[] = []
  ) {
    super(
      `${code}: ${
        unresolvedTiles.length > 0
          ? unresolvedTiles.join(", ")
          : diagnostics.map((diag) => `${diag.code}@${diag.params?.rulePath ?? "document"}`).join(", ")
      }`
    );
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

/**
 * One operation of the staged world ending, as the world reports it. The handle
 * names which call started the operation, so the run can say how a call the
 * document made turned out.
 */
export interface OperationEndingReport {
  /**
   * Handle the call that started the operation was dispatched on, as the
   * `AsyncHandle` handed to the action body carries it.
   */
  readonly handleId: HandleId;
  readonly ending: OperationEnding;
}

/** What the kit hands a world driver to stage one rehearsal. */
export interface WorldStaging {
  /** The environment the world runs in, carrying core's modules and the target's. */
  readonly environment: WendooEnvironment;
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
  /**
   * Report how one operation of this world ended, at the moment it ends. The
   * run attributes the ending to the call whose handle the report names, and a
   * report naming a handle no observed call was dispatched on is ignored. Call
   * it only for the endings the runtime cannot see for itself; an operation
   * that ran to its end while its caller waited needs no report.
   */
  publishOperationEnding(report: OperationEndingReport): void;
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
  /**
   * Read every channel the driver declares, as the value each holds right now,
   * keyed by channel name and rendered by the target. Called once per think,
   * after the step, while the subject is still present. Omit the method for a
   * world that declares no channel; a channel the driver declares and this map
   * omits is reported as unchanged.
   */
  readState?(): ReadonlyMap<string, string>;
  /** Tear the world down; no step follows. */
  shutdown(): void;
}

/**
 * What a target supplies to become rehearsable: the tiles its brains are
 * written in, the roles a scenario may put under study, and how its world is
 * staged and stepped. Nothing here presumes entities, positions, or physics.
 */
export interface WorldDriver {
  /** Wendoo modules this target installs into a rehearsal environment, beyond core's own. */
  modules(): readonly WendooModule[];
  /** Population roles a scenario may name as its subject. */
  subjects(): readonly string[];
  /**
   * Percept kinds this target reads out of a scenario. Omit the method to
   * register none, which refuses every scripted input.
   */
  inputKinds?(): readonly ScenarioInputKind[];
  /**
   * State channels of the subject this target reports, in the order a delta
   * lists them. Omit the method to declare none, which reports no state at all.
   * A world staged by this driver reads them through
   * {@link RehearsalWorld.readState}.
   */
  stateChannels?(): readonly SubjectStateChannel[];
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
   * Wendoo identity of the target the artifact is. Inject it at build time
   * from the `identity` the target's own `wendoo.json` declares.
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
function ruleFuncIdRuleIds(environment: WendooEnvironment, brainDef: IBrainDef): Map<number, string> {
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

/**
 * Tile ids `brainDef` names that the environment it was read into holds no
 * definition for, in document order and without repeats. Each one stands in the
 * document as a missing-tile placeholder.
 */
function unresolvedTileIds(brainDef: IBrainDef): string[] {
  const unresolved: string[] = [];
  for (const located of locateRules(brainDef)) {
    for (const side of [located.rule.when(), located.rule.do()]) {
      const tiles = side.tiles();
      for (let i = 0; i < tiles.size(); i++) {
        const tile = tiles.get(i)!;
        if (tile.kind === "missing" && !unresolved.includes(tile.tileId)) unresolved.push(tile.tileId);
      }
    }
  }
  return unresolved;
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

/** One asynchronous call of the run, with the think it was made on. */
interface RecordedCall {
  readonly dispatch: RecordedDispatch;
  readonly think: number;
  /** `true` once the call's handle has settled. */
  settled: boolean;
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
  /** Channel changes recorded on the think being recorded, as `name=value`. */
  private state: string[] = [];
  /** Last value emitted for each channel, for the channels that have emitted one. */
  private readonly heldState = new Map<string, string>();
  /** Index of the page just left, held until the page entered is known. */
  private leftPage: number | undefined;
  private readonly thinks: ThinkObservation[] = [];
  /** Zero-based index of the think being recorded. */
  private think = 0;
  /** Every asynchronous call of the run, keyed by the handle it was dispatched on. */
  private readonly calls = new Map<HandleId, RecordedCall>();
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
      if (handleId !== undefined) this.calls.set(handleId, { dispatch, think: this.think, settled: false });
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
      const call = this.calls.get(handleId);
      if (!call) return;
      call.settled = true;
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

  /**
   * Record how one operation of the world ended against the call that started
   * it, replacing whatever the call's own handle settle said. A report naming a
   * handle no recorded call was dispatched on is ignored.
   */
  operationEnded({ handleId, ending }: OperationEndingReport): void {
    if (!this.recording) return;
    const call = this.calls.get(handleId);
    if (!call) return;
    call.dispatch.outcome = ending;
    const endedAfter = this.think - call.think;
    if (endedAfter > 0) call.dispatch.settledAfter = endedAfter;
  }

  /**
   * Record the state channels of `values` that differ from the value last
   * recorded for them, against the think being recorded. Every channel differs
   * on the first think, so the first entry a channel gets is the value it
   * started the run at.
   */
  recordState(values: ReadonlyMap<string, string>): void {
    if (!this.recording) return;
    for (const [name, value] of values) {
      if (this.heldState.get(name) === value) continue;
      this.heldState.set(name, value);
      this.state.push(`${name}=${value}`);
    }
  }

  /** Stop recording; called once the participant under study has left the world. */
  release(): void {
    this.recording = false;
  }

  /**
   * Close the run: every call that never ended anywhere the run could see is
   * reported as unended. Call it once the last think is closed.
   */
  closeRun(): void {
    for (const call of this.calls.values()) {
      if (!call.settled) call.dispatch.outcome = DispatchOutcome.Pending;
    }
    this.calls.clear();
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
        ...(this.state.length > 0 ? { state: this.state } : {}),
      });
    }
    this.gates = [];
    this.dispatches = [];
    this.quiesced = [];
    this.pageSwitch = undefined;
    this.state = [];
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

/** Run one rehearsal end to end over `driver`, recorded under `runId`. */
async function rehearse(
  options: RehearsalAdapterOptions,
  runId: string,
  request: SimulationRequest
): Promise<SimulationRun> {
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
  if (request.actionBundle) {
    environment.replaceActionBundle(request.actionBundle);
  }
  const numberText: NumberText = (value) => environment.appServices.numerics.formatNumber(value);
  const recorder = new SubjectRecorder(
    createTileNamer(() => environment.tileCatalogs(), environment.appServices.localizer),
    numberText,
    createValueLabeler(() => environment.tileCatalogs(), numberText)
  );

  const subjectBrain = environment.deserializeBrainJson(
    brainJsonWithRulesEmptied(request.brainDef.toJson() as BrainJson, request.excludedRules ?? [])
  );
  const unresolved = unresolvedTileIds(subjectBrain);
  if (unresolved.length > 0) {
    throw new RehearsalRejection(RehearsalRejectionCode.TilesUnresolved, [], unresolved);
  }
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
    publishOperationEnding: (report) => {
      recorder.operationEnded(report);
    },
  });

  // A world may populate during its first step, so the starting population is
  // the one standing after that step.
  let initialPopulation = 0;
  for (let think = 0; think < request.thinks; think++) {
    world.step();
    if (think === 0) initialPopulation = world.participants();
    if (world.subjectPresent()) {
      const values = world.readState?.();
      if (values) recorder.recordState(values);
    } else {
      recorder.release();
    }
    recorder.closeThink();
  }
  recorder.closeRun();

  const finalPopulation = world.participants();
  const brainsExecuted = world.brainsExecuted();
  world.shutdown();

  const observations = recorder.observations();
  return {
    runId,
    thinks: observations.length,
    observations,
    world: { initialPopulation, finalPopulation, brainsExecuted },
  };
}

/** Id of the `count`-th rehearsal one adapter has run, counting from one. */
function runIdOf(count: number): string {
  return `run-${count}`;
}

/**
 * Build a target adapter over a world driver: the kit owns the seeded
 * environment, the brain substitution, gate and dispatch observation, the run
 * loop, and the run packaging; the driver owns only its world.
 *
 * Each adapter numbers its own runs from one, so the ids a caller sees depend
 * only on how many rehearsals it has asked this adapter for.
 *
 * This API is provisional.
 */
export function createRehearsalAdapter(options: RehearsalAdapterOptions): TargetAdapter {
  let runs = 0;
  return {
    contractVersion: ADAPTER_CONTRACT_VERSION,
    targetIdentity: options.targetIdentity,
    manifest: () => options.manifest,
    modules: () => options.driver.modules(),
    tileDocs: () => options.tileDocs(),
    subjects: () => options.driver.subjects(),
    inputKinds: () => options.driver.inputKinds?.() ?? [],
    stateChannels: () => options.driver.stateChannels?.() ?? [],
    run: (request: SimulationRequest) => {
      runs++;
      return rehearse(options, runIdOf(runs), request);
    },
  };
}
