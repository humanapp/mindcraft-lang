/**
 * End-to-end behavior of the `otherwise` and `then` trigger modes.
 *
 * Each test builds a real BrainDef through the tile API, gives its rules trigger
 * modes, links it, and runs it on a `BrainRuntime` with VM event hooks attached.
 * Firing is observed through the ticks a marker actuator ran on, through the
 * WHEN-gate events the VM emits, and through the ticks a WHEN-side sensor was
 * evaluated on.
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
  CoreOpId,
  CoreTypeIds,
  ErrorCode,
  type ExecutionContext,
  FALSE_VALUE,
  type FiberFaultEvent,
  type HostActionBinding,
  mkCallDef,
  type PageMetadata,
  type Program,
  type RuleWhenGateEvent,
  TRUE_VALUE,
  type Value,
  type VmEvents,
  VOID_VALUE,
} from "@wendoo/core/runtime";

let services: BrainServices;
let opAnd: BrainTileOperatorDef;

/** Distinguishes the host ids each test registers; ids must be unique per registry. */
let hostIdCounter = 0;

before(() => {
  services = __test__createBrainServices();
  opAnd = new BrainTileOperatorDef(CoreOpId.And, {}, services);
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
    key: `trigger-mode-marker-${hostIdCounter}`,
    actionId: 8100 + hostIdCounter,
    fnId: 9100 + hostIdCounter,
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

/** An awaited actuator that parks its rule until the test settles its handle. */
interface ParkingActuator {
  tile: BrainTileActuatorDef;
  /** Ticks the actuator's body was dispatched on, one entry per dispatch. */
  dispatchTicks: number[];
  /** Settles every handle the actuator has left pending, oldest first. */
  finish: () => void;
  /** Rejects every handle the actuator has left pending, faulting the fibers awaiting them. */
  fail: () => void;
}

/** Registers an asynchronous actuator that never settles its own handle. */
function makeParkingActuator(): ParkingActuator {
  hostIdCounter += 1;
  const dispatchTicks: number[] = [];
  const pending: AsyncHandle[] = [];
  const def = createHostActuator({
    key: `trigger-mode-park-${hostIdCounter}`,
    actionId: 8100 + hostIdCounter,
    fnId: 9100 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    isAsync: true,
    fn: {
      exec: (ctx: ExecutionContext, _args: ReadonlyList<Value>, handle: AsyncHandle) => {
        dispatchTicks.push(ctx.currentTick);
        pending.push(handle);
      },
    },
  });
  registerHost(def);
  return {
    tile: def.tile as BrainTileActuatorDef,
    dispatchTicks,
    finish: () => {
      while (pending.length > 0) {
        const handle = pending.shift();
        if (handle) handle.resolve(VOID_VALUE);
      }
    },
    fail: () => {
      while (pending.length > 0) {
        const handle = pending.shift();
        if (handle) handle.reject(ErrorCode.ScriptError, "trigger-mode fixture fault");
      }
    },
  };
}

/** An awaited actuator that settles its handle during its own dispatch, so its rule never suspends. */
interface SettlingActuator {
  tile: BrainTileActuatorDef;
  /** Ticks the actuator's body was dispatched on, one entry per dispatch. */
  dispatchTicks: number[];
  /** Rejects every later dispatch when `failing`, resolves it otherwise. */
  setFailing: (failing: boolean) => void;
}

/**
 * Registers an asynchronous actuator that settles each handle before returning:
 * its rule continues in the same slice, or faults there while it is set to fail.
 */
function makeSettlingActuator(failing: boolean): SettlingActuator {
  hostIdCounter += 1;
  const dispatchTicks: number[] = [];
  const holder = { failing };
  const def = createHostActuator({
    key: `trigger-mode-settle-${hostIdCounter}`,
    actionId: 8100 + hostIdCounter,
    fnId: 9100 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    isAsync: true,
    fn: {
      exec: (ctx: ExecutionContext, _args: ReadonlyList<Value>, handle: AsyncHandle) => {
        dispatchTicks.push(ctx.currentTick);
        if (holder.failing) {
          handle.reject(ErrorCode.ScriptError, "trigger-mode fixture fault");
          return;
        }
        handle.resolve(VOID_VALUE);
      },
    },
  });
  registerHost(def);
  return {
    tile: def.tile as BrainTileActuatorDef,
    dispatchTicks,
    setFailing: (next: boolean) => {
      holder.failing = next;
    },
  };
}

/** A WHEN-side boolean sensor whose reading the test sets, recording every evaluation. */
interface Probe {
  tile: BrainTileSensorDef;
  /** Ticks the sensor's body ran on, one entry per evaluation. */
  readTicks: number[];
  /** Sets the value every later evaluation reads. */
  set: (value: boolean) => void;
}

/** Registers a settable WHEN-side boolean sensor that records each evaluation. */
function makeProbe(initial: boolean): Probe {
  hostIdCounter += 1;
  const readTicks: number[] = [];
  const holder = { value: initial };
  const def = createHostSensor({
    key: `trigger-mode-probe-${hostIdCounter}`,
    actionId: 8100 + hostIdCounter,
    fnId: 9100 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    outputType: CoreTypeIds.Boolean,
    fn: {
      exec: (ctx: ExecutionContext) => {
        readTicks.push(ctx.currentTick);
        return holder.value ? TRUE_VALUE : FALSE_VALUE;
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
    readTicks,
    set: (value: boolean) => {
      holder.value = value;
    },
  };
}

/** A boolean literal tile. */
function boolLiteral(b: boolean): BrainTileLiteralDef {
  return new BrainTileLiteralDef(CoreTypeIds.Boolean, b, {}, services);
}

/** A one-page brain whose first page holds only its default rule. */
function newBrain(): { brainDef: BrainDef; page: BrainPageDef } {
  const brainDef = BrainDef.emptyBrainDef(services);
  return { brainDef, page: brainDef.pages().get(0)! as BrainPageDef };
}

/** Fills `rule`'s WHEN and DO sides from tile lists. */
function fillRule(rule: BrainRuleDef, whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]): void {
  for (const tile of whenTiles) __test__appendTile(rule.when(), tile);
  for (const tile of doTiles) __test__appendTile(rule.do(), tile);
}

/** Appends a root rule to `page` carrying `trigger`, filled from the tile lists. */
function addRootRule(
  page: BrainPageDef,
  trigger: RuleTriggerMode,
  whenTiles: readonly IBrainTileDef[],
  doTiles: readonly IBrainTileDef[]
): BrainRuleDef {
  const rule = page.appendNewRule() as BrainRuleDef;
  rule.setTrigger(trigger);
  fillRule(rule, whenTiles, doTiles);
  return rule;
}

/** Appends a child rule to `parent` carrying `trigger`, filled from the tile lists. */
function addChildRule(
  parent: BrainRuleDef,
  trigger: RuleTriggerMode,
  whenTiles: readonly IBrainTileDef[],
  doTiles: readonly IBrainTileDef[]
): BrainRuleDef {
  const rule = parent.appendNewRule();
  rule.setTrigger(trigger);
  fillRule(rule, whenTiles, doTiles);
  return rule;
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
  /** Fiber-fault events in emission order. */
  faults: FiberFaultEvent[];
  /** Advances the brain by one think at a 16 ms cadence. */
  think: () => void;
  /** Asks the runtime to activate `pageIndex` on the next think. */
  goToPage: (pageIndex: number) => void;
}

/** Links `brainDef`, starts it on a {@link BrainRuntime}, and collects the VM events it emits. */
function startBrain(brainDef: BrainDef): RunHarness {
  const { program, pages } = linkBrain(brainDef);
  const gates: RuleWhenGateEvent[] = [];
  const faults: FiberFaultEvent[] = [];
  const events: VmEvents = {
    onRuleWhenGate: (payload) => {
      gates.push(payload);
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
    faults,
    think: () => {
      tick += 1;
      runtime.think(tick * 16);
    },
    goToPage: (pageIndex: number) => {
      runtime.requestPageChange(pageIndex);
    },
  };
}

/** The gate events `ruleFuncId` emitted, in order. */
function gatesOf(run: RunHarness, ruleFuncId: number): RuleWhenGateEvent[] {
  return run.gates.filter((gate) => gate.ruleFuncId === ruleFuncId);
}

describe("otherwise mode -- the ladder", () => {
  /**
   * Builds the three-rule ladder `when a / otherwise when b / otherwise`, and
   * runs it for two thinks.
   */
  function runLadder(a: boolean, b: boolean): { head: number[]; middle: number[]; tail: number[] } {
    const { brainDef, page } = newBrain();
    const head = makeMarker();
    const middle = makeMarker();
    const tail = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(a)], [head.tile]);
    addRootRule(page, RuleTriggerMode.Otherwise, [boolLiteral(b)], [middle.tile]);
    addRootRule(page, RuleTriggerMode.Otherwise, [], [tail.tile]);

    const run = startBrain(brainDef);
    run.think();
    run.think();
    return { head: head.ticks, middle: middle.ticks, tail: tail.ticks };
  }

  test("the head fires alone when its expression holds", () => {
    const marks = runLadder(true, true);
    assert.deepEqual(marks.head, [1, 2]);
    assert.deepEqual(marks.middle, []);
    assert.deepEqual(marks.tail, []);
  });

  test("the middle fires alone when the head does not and its own expression holds", () => {
    const marks = runLadder(false, true);
    assert.deepEqual(marks.head, []);
    assert.deepEqual(marks.middle, [1, 2]);
    assert.deepEqual(marks.tail, []);
  });

  test("the bare tail fires when neither rule above it did", () => {
    const marks = runLadder(false, false);
    assert.deepEqual(marks.head, []);
    assert.deepEqual(marks.middle, []);
    assert.deepEqual(marks.tail, [1, 2]);
  });

  test("a parked head keeps the whole ladder quiet until it settles", () => {
    const { brainDef, page } = newBrain();
    const park = makeParkingActuator();
    const middle = makeMarker();
    const tail = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], [park.tile]);
    addRootRule(page, RuleTriggerMode.Otherwise, [boolLiteral(true)], [middle.tile]);
    addRootRule(page, RuleTriggerMode.Otherwise, [], [tail.tile]);

    const run = startBrain(brainDef);
    run.think();
    run.think();
    run.think();

    assert.deepEqual(park.dispatchTicks, [1], "the parked head does not re-fire while its action is in flight");
    assert.deepEqual(middle.ticks, [], "the head's record stays DID_FIRE while it is parked");
    assert.deepEqual(tail.ticks, []);
    assert.deepEqual(run.faults, []);
  });

  test("a child-level ladder reads its own level", () => {
    const { brainDef, page } = newBrain();
    const branch = makeMarker();
    const elseBranch = makeMarker();
    const root = page.children().get(0)! as BrainRuleDef;
    fillRule(root, [boolLiteral(true)], []);
    addChildRule(root, RuleTriggerMode.When, [boolLiteral(false)], [branch.tile]);
    addChildRule(root, RuleTriggerMode.Otherwise, [], [elseBranch.tile]);

    const run = startBrain(brainDef);
    run.think();
    run.think();

    assert.deepEqual(branch.ticks, []);
    assert.deepEqual(elseBranch.ticks, [1, 2]);
  });
});

describe("then mode -- a synchronous subject", () => {
  test("a bare then after a childless sibling runs in the same think its subject completes", () => {
    const { brainDef, page } = newBrain();
    const subject = makeMarker();
    const follower = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], [subject.tile]);
    addRootRule(page, RuleTriggerMode.Then, [], [follower.tile]);

    const run = startBrain(brainDef);
    run.think();
    run.think();

    assert.deepEqual(subject.ticks, [1, 2]);
    assert.deepEqual(follower.ticks, [1, 2], "an already-settled subject resolves the trigger without suspending");
    assert.deepEqual(run.faults, []);
  });

  test("a sibling that never fires skips its then rule every think", () => {
    const { brainDef, page } = newBrain();
    const subject = makeMarker();
    const follower = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(false)], [subject.tile]);
    addRootRule(page, RuleTriggerMode.Then, [], [follower.tile]);

    const run = startBrain(brainDef);
    run.think();
    run.think();

    assert.deepEqual(subject.ticks, []);
    assert.deepEqual(follower.ticks, []);
    const gates = gatesOf(run, run.roots[1]);
    assert.equal(gates.length, 2, "the skipped rule still reaches its gate every think");
    assert.deepEqual(
      gates.map((gate) => gate.fired),
      [false, false]
    );
  });

  test("a fired sibling with an empty DO still completes its cluster", () => {
    const { brainDef, page } = newBrain();
    const follower = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], []);
    addRootRule(page, RuleTriggerMode.Then, [], [follower.tile]);

    const run = startBrain(brainDef);
    run.think();
    run.think();

    assert.deepEqual(follower.ticks, [1, 2]);
  });

  test("a subject that faults in its own DO skips its then rule, which fires on the next clean firing", () => {
    const { brainDef, page } = newBrain();
    const settle = makeSettlingActuator(true);
    const follower = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], [settle.tile]);
    addRootRule(page, RuleTriggerMode.Then, [], [follower.tile]);

    const run = startBrain(brainDef);
    run.think();

    assert.ok(run.faults.length > 0, "the subject faulted inside its own DO, in the think it fired");
    assert.deepEqual(follower.ticks, [], "a subtree emptied by a fault is not a completion");

    settle.setFailing(false);
    run.think();

    assert.deepEqual(settle.dispatchTicks, [1, 2], "the subject re-fires the think after its fault");
    assert.deepEqual(follower.ticks, [2], "the fresh firing completed cleanly, so the then rule fired");
  });

  test("the expression filters at the wake think and is not evaluated when the trigger answers false", () => {
    const { brainDef, page } = newBrain();
    const subject = makeProbe(true);
    const filter = makeProbe(true);
    const follower = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [subject.tile], []);
    addRootRule(page, RuleTriggerMode.Then, [filter.tile], [follower.tile]);

    const run = startBrain(brainDef);
    run.think();
    assert.deepEqual(follower.ticks, [1], "the filter held, so the then rule fired");
    assert.deepEqual(filter.readTicks, [1]);

    filter.set(false);
    run.think();
    assert.deepEqual(follower.ticks, [1], "the filter did not hold, so the completion was skipped");
    assert.deepEqual(filter.readTicks, [1, 2]);

    subject.set(false);
    filter.set(true);
    run.think();
    assert.deepEqual(follower.ticks, [1], "the subject did not fire, so the then rule skipped");
    assert.deepEqual(filter.readTicks, [1, 2], "a false trigger answer never evaluates the rule's own expression");
    assert.deepEqual(run.faults, []);
  });
});

describe("then mode -- a subject whose cluster is in flight", () => {
  test("a then rule waits across thinks for a subject parked on an awaited actuator", () => {
    const { brainDef, page } = newBrain();
    const park = makeParkingActuator();
    const follower = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], [park.tile]);
    addRootRule(page, RuleTriggerMode.Then, [], [follower.tile]);

    const run = startBrain(brainDef);
    run.think();
    run.think();
    assert.deepEqual(follower.ticks, [], "the follower waits while the subject's action is in flight");

    park.finish();
    run.think();
    run.think();

    assert.deepEqual(
      follower.ticks,
      [4],
      "the subject resumes and settles on think 3; the woken follower takes the ordinary one-round resume"
    );
    assert.deepEqual(run.faults, []);
  });

  test("a then rule waits for a subject whose child parks on an awaited actuator across thinks", () => {
    const { brainDef, page } = newBrain();
    const park = makeParkingActuator();
    const follower = makeMarker();
    const subject = page.children().get(0)! as BrainRuleDef;
    fillRule(subject, [boolLiteral(true)], []);
    addChildRule(subject, RuleTriggerMode.When, [boolLiteral(true)], [park.tile]);
    addRootRule(page, RuleTriggerMode.Then, [], [follower.tile]);

    const run = startBrain(brainDef);
    run.think();
    run.think();
    assert.deepEqual(follower.ticks, [], "a live descendant keeps the subject's cluster in flight");

    park.finish();
    run.think();
    run.think();

    assert.deepEqual(follower.ticks, [4], "the cluster settles when its last descendant finishes, on think 3");
    assert.deepEqual(run.faults, []);
  });

  test("an otherwise sibling after a waiting then rule fires during the wait and goes quiet on the fire", () => {
    const { brainDef, page } = newBrain();
    const park = makeParkingActuator();
    const follower = makeMarker();
    const complement = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], [park.tile]);
    addRootRule(page, RuleTriggerMode.Then, [], [follower.tile]);
    addRootRule(page, RuleTriggerMode.Otherwise, [], [complement.tile]);

    const run = startBrain(brainDef);
    run.think();
    run.think();
    assert.deepEqual(follower.ticks, []);
    assert.deepEqual(complement.ticks, [1, 2], "the waiting then rule reads DID_NOT_FIRE, so its else branch runs");

    park.finish();
    run.think();
    run.think();

    assert.deepEqual(follower.ticks, [4]);
    assert.deepEqual(complement.ticks, [1, 2, 3], "the else branch still runs on the think the subject settles");
    assert.deepEqual(run.faults, []);
  });

  test("a faulted descendant abandons the sequence", () => {
    const { brainDef, page } = newBrain();
    const park = makeParkingActuator();
    const follower = makeMarker();
    const subject = page.children().get(0)! as BrainRuleDef;
    fillRule(subject, [boolLiteral(true)], []);
    addChildRule(subject, RuleTriggerMode.When, [boolLiteral(true)], [park.tile]);
    addRootRule(page, RuleTriggerMode.Then, [], [follower.tile]);

    const run = startBrain(brainDef);
    run.think();
    assert.deepEqual(follower.ticks, []);

    park.fail();
    run.think();
    run.think();
    run.think();

    assert.ok(run.faults.length > 0, "the descendant faults when its awaited action rejects");
    assert.deepEqual(follower.ticks, [], "a faulted cluster resolves the waiting trigger as a skip");
  });

  test("a fault in one branch abandons the cluster even when the fiber that empties it finishes normally", () => {
    const { brainDef, page } = newBrain();
    const failing = makeParkingActuator();
    const finishing = makeParkingActuator();
    const follower = makeMarker();
    const subject = page.children().get(0)! as BrainRuleDef;
    fillRule(subject, [boolLiteral(true)], []);
    addChildRule(subject, RuleTriggerMode.When, [boolLiteral(true)], [failing.tile]);
    addChildRule(subject, RuleTriggerMode.When, [boolLiteral(true)], [finishing.tile]);
    addRootRule(page, RuleTriggerMode.Then, [], [follower.tile]);

    const run = startBrain(brainDef);
    run.think();
    assert.deepEqual(follower.ticks, [], "both branches are in flight");

    failing.fail();
    run.think();
    assert.ok(run.faults.length > 0, "the first branch faulted");

    finishing.finish();
    run.think();
    run.think();

    assert.deepEqual(
      follower.ticks,
      [],
      "the surviving branch settled the cluster, but the fault abandoned the firing"
    );
  });
});

describe("then mode -- chains", () => {
  test("a root-level chain of three sequences step by step", () => {
    const { brainDef, page } = newBrain();
    const park = makeParkingActuator();
    const second = makeMarker();
    const third = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], [park.tile]);
    addRootRule(page, RuleTriggerMode.Then, [], [second.tile]);
    addRootRule(page, RuleTriggerMode.Then, [], [third.tile]);

    const run = startBrain(brainDef);
    run.think();
    assert.deepEqual(second.ticks, []);
    assert.deepEqual(third.ticks, []);

    park.finish();
    run.think();
    run.think();
    run.think();

    assert.deepEqual(second.ticks, [3], "the first link wakes one round after its subject settled on think 2");
    assert.deepEqual(third.ticks, [4], "the second link wakes one round after the first link settled");
    assert.deepEqual(run.faults, []);
  });

  test("a child-level chain of three sequences at its own level", () => {
    const { brainDef, page } = newBrain();
    const first = makeMarker();
    const second = makeMarker();
    const third = makeMarker();
    const root = page.children().get(0)! as BrainRuleDef;
    fillRule(root, [boolLiteral(true)], []);
    addChildRule(root, RuleTriggerMode.When, [boolLiteral(true)], [first.tile]);
    addChildRule(root, RuleTriggerMode.Then, [], [second.tile]);
    addChildRule(root, RuleTriggerMode.Then, [], [third.tile]);

    const run = startBrain(brainDef);
    run.think();

    assert.deepEqual(first.ticks, [1]);
    assert.deepEqual(second.ticks, [1]);
    assert.deepEqual(third.ticks, [1]);
    assert.deepEqual(run.faults, []);
  });

  test("a chain whose middle subject skips takes the whole spine down without evaluating downstream", () => {
    const { brainDef, page } = newBrain();
    const filter = makeProbe(false);
    const downstreamFilter = makeProbe(true);
    const second = makeMarker();
    const third = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], []);
    addRootRule(page, RuleTriggerMode.Then, [filter.tile], [second.tile]);
    addRootRule(page, RuleTriggerMode.Then, [downstreamFilter.tile], [third.tile]);

    const run = startBrain(brainDef);
    run.think();
    run.think();

    assert.deepEqual(second.ticks, [], "the middle link's filter did not hold");
    assert.deepEqual(third.ticks, []);
    assert.deepEqual(filter.readTicks, [1, 2], "the middle link evaluates its own filter");
    assert.deepEqual(downstreamFilter.readTicks, [], "the skip cascades before the downstream expression runs");
    assert.deepEqual(run.faults, []);
  });
});

describe("then mode -- page exit during a wait", () => {
  test("leaving the page cancels the waiting rule and re-entry starts clean", () => {
    const brainDef = BrainDef.emptyBrainDef(services);
    const page = brainDef.pages().get(0)! as BrainPageDef;
    const secondPage = brainDef.appendNewPage();
    assert.ok(secondPage.success, "the fixture needs a second page to switch to");

    const park = makeParkingActuator();
    const follower = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], [park.tile]);
    addRootRule(page, RuleTriggerMode.Then, [], [follower.tile]);

    const run = startBrain(brainDef);
    run.think();
    assert.deepEqual(follower.ticks, [], "the follower is waiting when the page is left");

    run.goToPage(1);
    run.think();
    park.finish();
    run.think();
    assert.deepEqual(follower.ticks, [], "a cancelled cluster never wakes its waiter");

    run.goToPage(0);
    run.think();
    run.think();
    assert.equal(park.dispatchTicks.length, 2, "re-entry re-runs the subject from a clean start");
    assert.deepEqual(follower.ticks, [], "the re-entered subject is parked again, so the follower waits again");

    park.finish();
    run.think();
    run.think();

    assert.equal(follower.ticks.length, 1, "the re-entered sequence completes once its subject settles");
    assert.deepEqual(run.faults, []);
  });
});

describe("otherwise mode -- composed expressions", () => {
  test("an otherwise rule whose expression is a conjunction fires only when both hold", () => {
    const { brainDef, page } = newBrain();
    const withTrue = makeMarker();
    const withFalse = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(false)], []);
    addRootRule(page, RuleTriggerMode.Otherwise, [boolLiteral(true), opAnd, boolLiteral(true)], [withTrue.tile]);
    addRootRule(page, RuleTriggerMode.Otherwise, [boolLiteral(true), opAnd, boolLiteral(false)], [withFalse.tile]);

    const run = startBrain(brainDef);
    run.think();
    run.think();

    assert.deepEqual(withTrue.ticks, [1, 2]);
    assert.deepEqual(withFalse.ticks, []);
  });

  test("an unarmed otherwise rule does not evaluate its own expression", () => {
    const { brainDef, page } = newBrain();
    const filter = makeProbe(true);
    const complement = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], []);
    addRootRule(page, RuleTriggerMode.Otherwise, [filter.tile], [complement.tile]);

    const run = startBrain(brainDef);
    run.think();
    run.think();

    assert.deepEqual(complement.ticks, []);
    assert.deepEqual(filter.readTicks, [], "the arming read short-circuits the expression");

    const gates = gatesOf(run, run.roots[1]);
    assert.equal(gates.length, 2, "the unarmed rule still reaches its gate every think");
  });
});
