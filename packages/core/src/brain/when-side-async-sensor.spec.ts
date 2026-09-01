/**
 * Behavioral tests for a rule whose WHEN section reads an asynchronous sensor.
 * Such a sensor compiles to the `HOST_ACTION_CALL_ASYNC` / `AWAIT` pair inside
 * the rule's WHEN section, so the rule's fiber suspends part-way through its
 * WHEN and resumes at the same point once the handle settles.
 *
 * Each test builds a real BrainDef through the tile API, links it, and runs it
 * on a `BrainRuntime` with VM event hooks attached. An `otherwise` sibling reads
 * the suspended rule's firing record, and a synchronous control rule pins what
 * the resumed rule's WHEN result and gate must match.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import {
  createHostActuator,
  createHostSensor,
  type HostActuatorDefinition,
  type HostSensorDefinition,
  List,
  type ReadonlyList,
} from "@wendoo/core";
import type { BrainServices } from "@wendoo/core/brain";
import { type IBrainTileDef, type ITileCatalog, RuleTriggerMode, TilePlacement } from "@wendoo/core/brain";
import { __test__appendTile, __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { runBrainLinkPipeline } from "@wendoo/core/brain/compiler";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import {
  type BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileOperatorDef,
  BrainTileSensorDef,
} from "@wendoo/core/brain/tiles";
import {
  type AsyncHandle,
  BrainRuntime,
  CoreHostActions,
  CoreOpId,
  CoreTypeIds,
  type ExecutionContext,
  FALSE_VALUE,
  type FiberFaultEvent,
  type FiberWaitingEvent,
  type HostActionBinding,
  type Instr,
  mkCallDef,
  mkSensorTileId,
  Op,
  type PageMetadata,
  type Program,
  RuleFiringState,
  type RuleWhenGateEvent,
  TRUE_VALUE,
  type Value,
  type VmEvents,
  VOID_VALUE,
} from "@wendoo/core/runtime";

let services: BrainServices;
let opEqualTo: BrainTileOperatorDef;

/** Distinguishes the host ids each test registers; ids must be unique per registry. */
let hostIdCounter = 0;

before(() => {
  services = __test__createBrainServices();
  opEqualTo = new BrainTileOperatorDef(CoreOpId.EqualTo, {}, services);
});

/** Synchronous action body shape, for narrowing a definition's untyped `actionFn`. */
type SyncActionFn = { exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => Value };

/** Asynchronous action body shape, for narrowing a definition's untyped `actionFn`. */
type AsyncActionFn = { exec: (ctx: ExecutionContext, args: ReadonlyList<Value>, handle: AsyncHandle) => void };

/** Registers one host definition's function and action on the test services. */
function registerHost(def: HostSensorDefinition | HostActuatorDefinition): void {
  const fn = def.function;
  services.runtime.functions.register(fn.id, fn.name, fn.isAsync, fn.fn, fn.callDef);
  const binding: HostActionBinding = { binding: "host", descriptor: def.descriptor, id: def.actionId };
  if (def.descriptor.isAsync) {
    binding.execAsync = (def.actionFn as AsyncActionFn).exec;
  } else {
    binding.execSync = (def.actionFn as SyncActionFn).exec;
  }
  services.runtime.actions.register(binding);
}

/** A marker actuator tile plus the list of ticks (1-based) on which it ran. */
interface Marker {
  tile: BrainTileActuatorDef;
  ticks: number[];
}

/** Registers a marker actuator that records the tick it ran on. */
function makeMarker(): Marker {
  hostIdCounter += 1;
  const ticks: number[] = [];
  const def = createHostActuator({
    key: `async-when-marker-${hostIdCounter}`,
    actionId: 7500 + hostIdCounter,
    fnId: 8500 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    fn: {
      exec: (ctx: ExecutionContext) => {
        ticks.push(ctx.currentTick);
        return VOID_VALUE;
      },
    },
  });
  registerHost(def);
  return { tile: def.tile as BrainTileActuatorDef, ticks };
}

/** A registered asynchronous WHEN-side sensor and the handles its dispatches left pending. */
interface AsyncSensor {
  /** Inline, WHEN-side tile backed by the asynchronous host action. */
  tile: BrainTileSensorDef;
  /** Ticks the sensor's asynchronous body was dispatched on, one entry per dispatch. */
  dispatchTicks: number[];
  /** Resolves every handle the sensor has left pending with `value`, oldest first. */
  resolvePending: (value: Value) => void;
}

/**
 * Registers a test-only asynchronous boolean sensor that never settles its own
 * handle: each dispatch parks the calling fiber until
 * {@link AsyncSensor.resolvePending} settles it from outside the runtime.
 */
function makeAsyncSensor(): AsyncSensor {
  hostIdCounter += 1;
  const dispatchTicks: number[] = [];
  const pending: AsyncHandle[] = [];
  const def = createHostSensor({
    key: `async-when-sensor-${hostIdCounter}`,
    actionId: 7500 + hostIdCounter,
    fnId: 8500 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    outputType: CoreTypeIds.Boolean,
    isAsync: true,
    fn: {
      exec: (ctx: ExecutionContext, _args: ReadonlyList<Value>, handle: AsyncHandle) => {
        dispatchTicks.push(ctx.currentTick);
        pending.push(handle);
      },
    },
  });
  registerHost(def);
  const tile = new BrainTileSensorDef(def.descriptor.key, def.descriptor, {
    placement: TilePlacement.WhenSide | TilePlacement.Inline,
  });
  services.edit.tiles.registerTileDef(tile);
  return {
    tile,
    dispatchTicks,
    resolvePending: (value: Value) => {
      while (pending.length > 0) {
        const handle = pending.shift();
        if (handle) handle.resolve(value);
      }
    },
  };
}

/** Registers a synchronous WHEN-side boolean sensor that always reads `value`. */
function makeSyncSensor(value: Value): BrainTileSensorDef {
  hostIdCounter += 1;
  const def = createHostSensor({
    key: `sync-when-sensor-${hostIdCounter}`,
    actionId: 7500 + hostIdCounter,
    fnId: 8500 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    outputType: CoreTypeIds.Boolean,
    fn: { exec: () => value },
  });
  registerHost(def);
  const tile = new BrainTileSensorDef(def.descriptor.key, def.descriptor, {
    placement: TilePlacement.WhenSide | TilePlacement.Inline,
  });
  services.edit.tiles.registerTileDef(tile);
  return tile;
}

/**
 * Registers a WHEN-side boolean sensor that reads `true` and, on every
 * evaluation, records the firing record of the rule `watch` names.
 */
function makeRecordProbe(): { tile: BrainTileSensorDef; seen: RuleFiringState[]; watch: (funcId: number) => void } {
  hostIdCounter += 1;
  const seen: RuleFiringState[] = [];
  const subject = { funcId: -1 };
  const def = createHostSensor({
    key: `async-when-record-${hostIdCounter}`,
    actionId: 7500 + hostIdCounter,
    fnId: 8500 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    outputType: CoreTypeIds.Boolean,
    fn: {
      exec: (ctx: ExecutionContext) => {
        seen.push(ctx.services.brain.ruleFiring.get(subject.funcId));
        return TRUE_VALUE;
      },
    },
  });
  registerHost(def);
  const tile = new BrainTileSensorDef(def.descriptor.key, def.descriptor, {
    placement: TilePlacement.WhenSide | TilePlacement.Inline,
  });
  services.edit.tiles.registerTileDef(tile);
  return {
    tile,
    seen,
    watch: (funcId: number) => {
      subject.funcId = funcId;
    },
  };
}

/** An actuator tile that records its rule's captured `__whenResult` each time its DO side runs. */
function makeWhenResultReader(): { tile: BrainTileActuatorDef; captured: Value[] } {
  hostIdCounter += 1;
  const captured: Value[] = [];
  const def = createHostActuator({
    key: `async-when-result-${hostIdCounter}`,
    actionId: 7500 + hostIdCounter,
    fnId: 8500 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    fn: {
      exec: (ctx: ExecutionContext) => {
        captured.push(ctx.services.brain.ruleVars.getByName(ctx.currentRuleFuncId, "__whenResult"));
        return VOID_VALUE;
      },
    },
  });
  registerHost(def);
  return { tile: def.tile as BrainTileActuatorDef, captured };
}

/** A boolean literal tile. */
function boolLiteral(b: boolean): BrainTileLiteralDef {
  return new BrainTileLiteralDef(CoreTypeIds.Boolean, b, {}, services);
}

/** A one-page brain whose first page is empty of rules beyond the default one. */
function newBrain(): { brainDef: BrainDef; page: BrainPageDef } {
  const brainDef = BrainDef.emptyBrainDef(services);
  return { brainDef, page: brainDef.pages().get(0)! as BrainPageDef };
}

/** Fills `rule`'s WHEN and DO sides from tile lists. */
function fillRule(rule: BrainRuleDef, whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]): void {
  for (const tile of whenTiles) __test__appendTile(rule.when(), tile);
  for (const tile of doTiles) __test__appendTile(rule.do(), tile);
}

/**
 * Appends the two rules that watch a subject standing first on `page`: a bare
 * `otherwise` rule marking the thinks the subject did not fire, and a `when`
 * rule whose WHEN is `probe`, evaluated every think whatever the subject did.
 */
function addComplementAndProbe(page: BrainPageDef, complement: IBrainTileDef, probe: IBrainTileDef): void {
  const elseRule = page.appendNewRule() as BrainRuleDef;
  elseRule.setTrigger(RuleTriggerMode.Otherwise);
  fillRule(elseRule, [], [complement]);
  fillRule(page.appendNewRule() as BrainRuleDef, [probe], []);
}

/** Compiles, links, and treeshakes `brainDef` into the program a runtime loads. */
function linkBrain(brainDef: BrainDef): { program: Program; pages: List<PageMetadata> } {
  const result = runBrainLinkPipeline(
    brainDef,
    {
      catalogs: List.from<ITileCatalog>([services.edit.tiles, brainDef.catalog()]),
      actionResolver: services.runtime.actions,
      typeRegistry: services.runtime.types,
    },
    services.shared.conversions
  );
  assert.ok(result.program, "the brain must compile and link");
  return { program: result.program.program, pages: result.program.pages };
}

/** A started brain runtime, the rules it runs, and the VM events it has emitted so far. */
interface RunHarness {
  /** Root rule funcIds of page 0, in document order. */
  roots: number[];
  /** WHEN-gate events in emission order. */
  gates: RuleWhenGateEvent[];
  /** Fiber-suspension events in emission order. */
  waits: FiberWaitingEvent[];
  /** Fiber-fault events in emission order. */
  faults: FiberFaultEvent[];
  /** Advances the brain by one think at a 16 ms cadence. */
  think: () => void;
}

/** Links `brainDef`, starts it on a {@link BrainRuntime}, and collects the VM events it emits. */
function startBrain(brainDef: BrainDef): RunHarness {
  const { program, pages } = linkBrain(brainDef);
  const gates: RuleWhenGateEvent[] = [];
  const waits: FiberWaitingEvent[] = [];
  const faults: FiberFaultEvent[] = [];
  const events: VmEvents = {
    onRuleWhenGate: (payload) => {
      gates.push(payload);
    },
    onFiberWaiting: (payload) => {
      waits.push(payload);
    },
    onFiberFault: (payload) => {
      faults.push(payload);
    },
  };
  const runtime = new BrainRuntime(
    program,
    pages,
    { runtime: services.runtime, shared: services.shared, app: services.app },
    undefined,
    undefined,
    events
  );
  runtime.startup();

  const rootFuncIds = pages.get(0)!.rootRuleFuncIds;
  const roots: number[] = [];
  for (let i = 0; i < rootFuncIds.size(); i++) roots.push(rootFuncIds.get(i)!);

  let tick = 0;
  return {
    roots,
    gates,
    waits,
    faults,
    think: () => {
      tick += 1;
      runtime.think(tick * 16);
    },
  };
}

/** Index of the first instruction in `code` carrying `op`, or -1 when there is none. */
function indexOfOp(code: ReadonlyList<Instr>, op: Op): number {
  for (let i = 0; i < code.size(); i++) {
    if (code.get(i)!.op === op) return i;
  }
  return -1;
}

/** The gate events `ruleFuncId` emitted, in order. */
function gatesOf(run: RunHarness, ruleFuncId: number): RuleWhenGateEvent[] {
  return run.gates.filter((gate) => gate.ruleFuncId === ruleFuncId);
}

describe("a WHEN section suspended on an asynchronous sensor", () => {
  test("the sensor's asynchronous dispatch and its AWAIT compile inside the rule's WHEN section", () => {
    const { brainDef, page } = newBrain();
    const sensor = makeAsyncSensor();
    fillRule(page.children().get(0)! as BrainRuleDef, [sensor.tile], [makeMarker().tile]);

    const { program, pages } = linkBrain(brainDef);
    const ruleFuncId = pages.get(0)!.rootRuleFuncIds.get(0)!;
    const code = program.functions.get(ruleFuncId)!.code;
    const whenStart = indexOfOp(code, Op.WHEN_START);
    const dispatch = indexOfOp(code, Op.HOST_ACTION_CALL_ASYNC);
    const awaitAt = indexOfOp(code, Op.AWAIT);
    const whenEnd = indexOfOp(code, Op.WHEN_END);

    assert.ok(whenStart >= 0, "the rule opens a WHEN section");
    assert.ok(dispatch > whenStart, "the asynchronous dispatch follows WHEN_START");
    assert.equal(awaitAt, dispatch + 1, "AWAIT immediately follows the asynchronous dispatch");
    assert.ok(whenEnd > awaitAt, "the gate closes the WHEN section after the AWAIT");
  });

  test("the rule parks mid-WHEN and its record reads EVALUATING while the handle stays pending", () => {
    const { brainDef, page } = newBrain();
    const sensor = makeAsyncSensor();
    const subject = makeMarker();
    const complement = makeMarker();
    const probe = makeRecordProbe();
    fillRule(page.children().get(0)! as BrainRuleDef, [sensor.tile], [subject.tile]);
    addComplementAndProbe(page, complement.tile, probe.tile);

    const run = startBrain(brainDef);
    probe.watch(run.roots[0]);
    run.think();
    run.think();
    run.think();

    assert.deepEqual(sensor.dispatchTicks, [1], "a parked rule is not respawned, so its sensor dispatches once");
    assert.equal(run.waits.length, 1, "the rule suspends exactly once");
    assert.equal(run.waits[0].ruleFuncId, run.roots[0], "the suspension is attributed to the rule that awaited");
    assert.deepEqual(gatesOf(run, run.roots[0]), [], "a WHEN that never finishes reaches no gate");
    assert.deepEqual(
      probe.seen,
      [RuleFiringState.EVALUATING, RuleFiringState.EVALUATING, RuleFiringState.EVALUATING],
      "the parked rule's record stays EVALUATING between WHEN_START and its gate"
    );
    assert.deepEqual(subject.ticks, [], "the DO side does not run while the WHEN is suspended");
    assert.deepEqual(complement.ticks, [], "an EVALUATING subject keeps the otherwise sibling quiet");
    assert.deepEqual(run.faults, []);
  });

  test("a handle resolving truthy resumes the WHEN in the next think and runs the DO", () => {
    const { brainDef, page } = newBrain();
    const sensor = makeAsyncSensor();
    const subject = makeMarker();
    const complement = makeMarker();
    const probe = makeRecordProbe();
    fillRule(page.children().get(0)! as BrainRuleDef, [sensor.tile], [subject.tile]);
    addComplementAndProbe(page, complement.tile, probe.tile);

    const run = startBrain(brainDef);
    probe.watch(run.roots[0]);
    run.think();
    sensor.resolvePending(TRUE_VALUE);
    run.think();
    run.think();

    assert.deepEqual(subject.ticks, [2], "the DO runs on the think after the handle settled");
    assert.deepEqual(
      probe.seen,
      [RuleFiringState.EVALUATING, RuleFiringState.DID_FIRE, RuleFiringState.EVALUATING],
      "the record moves to DID_FIRE on the resume think, then to EVALUATING as the rule re-parks"
    );
    assert.deepEqual(complement.ticks, [], "a subject that fires keeps the otherwise sibling quiet");
    assert.deepEqual(sensor.dispatchTicks, [1, 3], "the completed rule respawns and dispatches its sensor again");

    const gates = gatesOf(run, run.roots[0]);
    assert.equal(gates.length, 1);
    assert.equal(gates[0].fired, true);
    assert.deepEqual(gates[0].result, TRUE_VALUE);
    assert.deepEqual(run.faults, []);
  });

  test("a handle resolving falsy resumes the WHEN, fails the gate, and releases the otherwise sibling", () => {
    const { brainDef, page } = newBrain();
    const sensor = makeAsyncSensor();
    const subject = makeMarker();
    const complement = makeMarker();
    const probe = makeRecordProbe();
    fillRule(page.children().get(0)! as BrainRuleDef, [sensor.tile], [subject.tile]);
    addComplementAndProbe(page, complement.tile, probe.tile);

    const run = startBrain(brainDef);
    probe.watch(run.roots[0]);
    run.think();
    sensor.resolvePending(FALSE_VALUE);
    run.think();

    assert.deepEqual(subject.ticks, [], "a falsy WHEN result does not run the DO");
    assert.deepEqual(
      probe.seen,
      [RuleFiringState.EVALUATING, RuleFiringState.DID_NOT_FIRE],
      "the record moves to DID_NOT_FIRE on the resume think"
    );
    assert.deepEqual(complement.ticks, [2], "the otherwise sibling fires on the think the gate landed not-fired");

    const gates = gatesOf(run, run.roots[0]);
    assert.equal(gates.length, 1);
    assert.equal(gates[0].fired, false);
    assert.deepEqual(gates[0].result, FALSE_VALUE);
    assert.deepEqual(run.faults, []);
  });
});

describe("a resumed WHEN section against a synchronous control rule", () => {
  test("an asynchronous operand resolving true yields the control rule's WHEN result and gate", () => {
    const { brainDef, page } = newBrain();
    const sensor = makeAsyncSensor();
    const asyncReader = makeWhenResultReader();
    const controlReader = makeWhenResultReader();
    // `[true] [=] [sensor]` leaves the left operand and the call's argument
    // buffer on the operand stack while the sensor's AWAIT suspends the fiber.
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true), opEqualTo, sensor.tile], [asyncReader.tile]);
    fillRule(
      page.appendNewRule() as BrainRuleDef,
      [boolLiteral(true), opEqualTo, makeSyncSensor(TRUE_VALUE)],
      [controlReader.tile]
    );

    const run = startBrain(brainDef);
    run.think();
    sensor.resolvePending(TRUE_VALUE);
    run.think();

    const asyncGates = gatesOf(run, run.roots[0]);
    const controlGates = gatesOf(run, run.roots[1]);
    assert.equal(asyncGates.length, 1, "the suspended rule reaches its gate once, on the resume think");
    assert.equal(controlGates.length, 2, "the control rule reaches its gate every think");
    assert.deepEqual(asyncGates[0].result, controlGates[0].result);
    assert.equal(asyncGates[0].fired, controlGates[0].fired);
    assert.deepEqual(asyncReader.captured, [TRUE_VALUE]);
    assert.deepEqual(controlReader.captured, [TRUE_VALUE, TRUE_VALUE]);
    assert.deepEqual(run.faults, []);
  });

  test("an asynchronous operand resolving false yields the control rule's WHEN result and gate", () => {
    const { brainDef, page } = newBrain();
    const sensor = makeAsyncSensor();
    const asyncReader = makeWhenResultReader();
    const controlReader = makeWhenResultReader();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true), opEqualTo, sensor.tile], [asyncReader.tile]);
    fillRule(
      page.appendNewRule() as BrainRuleDef,
      [boolLiteral(true), opEqualTo, makeSyncSensor(FALSE_VALUE)],
      [controlReader.tile]
    );

    const run = startBrain(brainDef);
    run.think();
    sensor.resolvePending(FALSE_VALUE);
    run.think();

    const asyncGates = gatesOf(run, run.roots[0]);
    const controlGates = gatesOf(run, run.roots[1]);
    assert.equal(asyncGates.length, 1);
    assert.equal(controlGates.length, 2);
    assert.deepEqual(asyncGates[0].result, controlGates[0].result);
    assert.equal(asyncGates[0].fired, controlGates[0].fired);
    assert.equal(asyncGates[0].fired, false);
    assert.deepEqual(asyncReader.captured, [], "a rule whose gate fails does not run its DO");
    assert.deepEqual(controlReader.captured, []);
    assert.deepEqual(run.faults, []);
  });
});
