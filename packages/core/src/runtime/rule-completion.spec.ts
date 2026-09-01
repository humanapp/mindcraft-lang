/**
 * Rule-cluster completion: the subtree-liveness query, the watcher slot each
 * rule carries, the settle walk that resolves watchers at fiber terminal
 * transitions, and the rule-trigger host action that parks on them.
 *
 * Every fixture runs hand-built rule bytecode on a real VM and fiber scheduler.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { Dict, List, UniqueSet } from "@wendoo/core";
import type { BrainServices } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import {
  type AsyncHandle,
  BYTECODE_VERSION,
  CoreHostActions,
  createProgramServices,
  createRuleCompletionServices,
  createRuleFiringServices,
  createRuleVariableServices,
  ErrorCode,
  type ExecutionContext,
  FALSE_VALUE,
  FiberScheduler,
  FiberState,
  type FunctionBytecode,
  type HandleId,
  HandleState,
  type HandleTable,
  type Instr,
  mkCallDef,
  NIL_VALUE,
  Op,
  type PageMetadata,
  type Program,
  RuleFiringState,
  type RuleFiringStates,
  type RuleVariableStores,
  type RuleWatcherSlots,
  TRUE_VALUE,
  type Value,
  VM,
} from "@wendoo/core/runtime";
import { __test__createPlatformServices } from "@wendoo/core/runtime/__test__";

/** Root rule every fixture watches: the subject of the rule below it. */
const SUBJECT = 0;

/** Child rule of {@link SUBJECT}. */
const CHILD = 1;

/** Root rule directly below {@link SUBJECT}: the rule that waits on it. */
const WAITER = 2;

/** Constant-pool indices shared by every fixture body. */
const TRUE_CONST = 0;
const FALSE_CONST = 1;
const NIL_CONST = 2;

let services: BrainServices;

/** Distinguishes the host function ids each test registers; ids must be unique per registry. */
let hostIdCounter = 0;

before(() => {
  services = __test__createBrainServices();
});

/** A registered asynchronous host function that never settles its own handles. */
interface ParkingFn {
  /** Stable funcId to dispatch with `HOST_CALL_ASYNC`. */
  fnId: number;
  /** Settles every handle the function has left pending, oldest first. */
  resolvePending: (value: Value) => void;
}

/**
 * Registers a test-only asynchronous host function whose body records its handle
 * and returns: each dispatch parks the calling fiber until
 * {@link ParkingFn.resolvePending} settles it from outside the runtime.
 */
function makeParkingFn(): ParkingFn {
  hostIdCounter += 1;
  const fnId = 9000 + hostIdCounter;
  const pending: AsyncHandle[] = [];
  services.runtime.functions.register(
    fnId,
    `rule-completion-park-${hostIdCounter}`,
    true,
    {
      exec: (_ctx: ExecutionContext, _args: unknown, handle: AsyncHandle) => {
        pending.push(handle);
      },
    },
    mkCallDef({ type: "bag", items: [] })
  );
  return {
    fnId,
    resolvePending: (value: Value) => {
      while (pending.length > 0) {
        const handle = pending.shift();
        if (handle) handle.resolve(value);
      }
    },
  };
}

/** A registered asynchronous host function that settles every handle during its own dispatch. */
interface SettlingFn {
  /** Stable funcId to dispatch with `HOST_CALL_ASYNC`. */
  fnId: number;
  /** Rejects every later dispatch when `failing`, resolves it otherwise. */
  setFailing: (failing: boolean) => void;
}

/**
 * Registers a test-only asynchronous host function that settles each handle
 * before returning, so the awaiting fiber never suspends: it continues in the
 * same slice, or faults there when the dispatch is set to fail.
 */
function makeSettlingFn(failing: boolean): SettlingFn {
  hostIdCounter += 1;
  const fnId = 9000 + hostIdCounter;
  const holder = { failing };
  services.runtime.functions.register(
    fnId,
    `rule-completion-settle-${hostIdCounter}`,
    true,
    {
      exec: (_ctx: ExecutionContext, _args: unknown, handle: AsyncHandle) => {
        if (holder.failing) {
          handle.reject(ErrorCode.ScriptError, "rule-completion fixture fault");
          return;
        }
        handle.resolve(TRUE_VALUE);
      },
    },
    mkCallDef({ type: "bag", items: [] })
  );
  return {
    fnId,
    setFailing: (next: boolean) => {
      holder.failing = next;
    },
  };
}

/** A rule body whose WHEN gate takes `whenConst` and whose DO section runs `doBody`. */
function mkRule(whenConst: number, doBody: Instr[] = []): Instr[] {
  return [
    { op: Op.WHEN_START },
    { op: Op.PUSH_CONST_VAL, a: whenConst },
    { op: Op.WHEN_END, a: doBody.length + 3 },
    { op: Op.DO_START },
    ...doBody,
    { op: Op.DO_END },
    { op: Op.PUSH_CONST_VAL, a: NIL_CONST },
    { op: Op.RET },
  ];
}

/**
 * A rule body that fires only once the asynchronous host function `fnId`
 * settles: its WHEN section dispatches the call and awaits the handle, so the
 * rule's fiber parks mid-WHEN.
 */
function mkParkingRule(fnId: number): Instr[] {
  return [
    { op: Op.WHEN_START },
    { op: Op.HOST_CALL_ASYNC, a: fnId, b: 0, c: 0 },
    { op: Op.AWAIT },
    { op: Op.WHEN_END, a: 3 },
    { op: Op.DO_START },
    { op: Op.DO_END },
    { op: Op.PUSH_CONST_VAL, a: NIL_CONST },
    { op: Op.RET },
  ];
}

/**
 * A rule body that fires, then faults inside its DO section on a pop from an
 * empty operand stack.
 */
function mkFaultingRule(): Instr[] {
  return [
    { op: Op.WHEN_START },
    { op: Op.PUSH_CONST_VAL, a: TRUE_CONST },
    { op: Op.WHEN_END, a: 4 },
    { op: Op.DO_START },
    { op: Op.POP },
    { op: Op.DO_END },
    { op: Op.PUSH_CONST_VAL, a: NIL_CONST },
    { op: Op.RET },
  ];
}

/**
 * A rule body that fires and then awaits the asynchronous host function `fnId`
 * inside its DO section, so the rule's outcome is recorded before its DO can
 * fault.
 */
function mkAwaitingRule(fnId: number): Instr[] {
  return mkRule(TRUE_CONST, [{ op: Op.HOST_CALL_ASYNC, a: fnId, b: 0, c: 0 }, { op: Op.AWAIT }, { op: Op.POP }]);
}

/**
 * A rule body that fires, spawns {@link CHILD}, and then parks its own fiber on
 * the asynchronous host function `fnId`, so the rule's own fiber outlives the
 * child's.
 */
function mkParentParkingRule(fnId: number): Instr[] {
  return mkRule(TRUE_CONST, [
    { op: Op.SPAWN_RULE, a: CHILD },
    { op: Op.HOST_CALL_ASYNC, a: fnId, b: 0, c: 0 },
    { op: Op.AWAIT },
    { op: Op.POP },
  ]);
}

/** A rule body whose WHEN section awaits the rule trigger and fires on a true answer. */
function mkTriggeredRule(): Instr[] {
  return [
    { op: Op.WHEN_START },
    { op: Op.HOST_ACTION_CALL_ASYNC, a: CoreHostActions.RuleTrigger.actionId, b: 0, c: 0 },
    { op: Op.AWAIT },
    { op: Op.WHEN_END, a: 3 },
    { op: Op.DO_START },
    { op: Op.DO_END },
    { op: Op.PUSH_CONST_VAL, a: NIL_CONST },
    { op: Op.RET },
  ];
}

function mkFunc(code: Instr[]): FunctionBytecode {
  return { code: List.from(code), numParams: 0 };
}

/** A running VM, its scheduler, and the brain-instance state the mechanisms read. */
interface Harness {
  vm: VM;
  scheduler: FiberScheduler;
  handles: HandleTable;
  states: RuleFiringStates;
  slots: RuleWatcherSlots;
  context: ExecutionContext;
  /** Spawns a root-rule fiber for `funcId` and returns its fiber id. */
  spawnRoot: (funcId: number) => number;
  /** Records `state` as `ruleFuncId`'s firing outcome. */
  seedRecord: (ruleFuncId: number, state: RuleFiringState) => void;
  /** The firing record of `ruleFuncId`. */
  recordOf: (ruleFuncId: number) => RuleFiringState;
}

/**
 * Builds a three-rule, one-page program from the bodies of {@link SUBJECT},
 * {@link CHILD}, and {@link WAITER} and starts a VM and scheduler on it.
 * {@link CHILD} is a child rule of {@link SUBJECT}; {@link SUBJECT} and
 * {@link WAITER} are the page's root rules, in that order.
 */
function startHarness(bodies: { subject: Instr[]; child?: Instr[]; waiter?: Instr[] }): Harness {
  const ruleFuncIds = new UniqueSet<number>();
  ruleFuncIds.add(SUBJECT);
  ruleFuncIds.add(CHILD);
  ruleFuncIds.add(WAITER);
  const ruleAncestors = new Dict<number, number>();
  ruleAncestors.set(CHILD, SUBJECT);

  const program: Program = {
    version: BYTECODE_VERSION,
    functions: List.from([
      mkFunc(bodies.subject),
      mkFunc(bodies.child ?? mkRule(TRUE_CONST)),
      mkFunc(bodies.waiter ?? mkRule(TRUE_CONST)),
    ]),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.from([TRUE_VALUE, FALSE_VALUE, NIL_VALUE]),
    },
    variableNames: List.empty<string>(),
    entryPoint: SUBJECT,
    ruleFuncIds,
    ruleAncestors,
  };
  const pages = List.from<PageMetadata>([
    {
      pageIndex: 0,
      pageId: "page-0",
      pageName: "page",
      rootRuleFuncIds: List.from([SUBJECT, WAITER]),
      actionCallSites: List.empty(),
    },
  ]);

  const states: RuleFiringStates = new Dict();
  const slots: RuleWatcherSlots = new Dict();
  const ruleVariableStores: RuleVariableStores = new Dict();
  let scheduler: FiberScheduler | undefined;

  const platformServices = __test__createPlatformServices({
    runtime: { actions: services.runtime.actions, functions: services.runtime.functions },
    program: createProgramServices(program, pages),
    ruleFiring: createRuleFiringServices(states),
    ruleVars: createRuleVariableServices(program, ruleVariableStores),
    ruleCompletion: createRuleCompletionServices(
      slots,
      new UniqueSet<number>(),
      (ruleFuncId: number) => scheduler?.hasLiveRuleSubtree(ruleFuncId) ?? false
    ),
  });
  const context: ExecutionContext = {
    services: platformServices,
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
  };

  const vm = new VM(program, platformServices.runtime);
  scheduler = new FiberScheduler(vm);
  const live = scheduler;

  return {
    vm,
    scheduler: live,
    handles: vm.handles,
    states,
    slots,
    context,
    spawnRoot: (funcId: number) => live.spawn(funcId, List.empty(), context),
    seedRecord: (ruleFuncId: number, state: RuleFiringState) => {
      states.set(ruleFuncId, state);
    },
    recordOf: (ruleFuncId: number) => createRuleFiringServices(states).get(ruleFuncId),
  };
}

/** A pending handle parked in `ruleFuncId`'s watcher slot. */
function parkWatcher(harness: Harness, ruleFuncId: number): HandleId {
  const handleId = harness.handles.createPending();
  harness.context.services.brain.ruleCompletion.setWatcher(ruleFuncId, handleId);
  return handleId;
}

describe("rule subtree liveness", () => {
  test("a rule whose own fiber is live has a live subtree", () => {
    const harness = startHarness({ subject: mkRule(TRUE_CONST) });
    harness.spawnRoot(SUBJECT);

    assert.equal(harness.scheduler.hasLiveRuleSubtree(SUBJECT), true);
    assert.equal(harness.scheduler.hasLiveRuleSubtree(WAITER), false, "an unspawned rule has no live fiber");
  });

  test("a live descendant keeps its ancestor's subtree live", () => {
    const harness = startHarness({ subject: mkRule(TRUE_CONST) });
    harness.scheduler.spawnChildRule(CHILD, SUBJECT, harness.context);

    assert.equal(harness.scheduler.hasLiveRuleSubtree(CHILD), true);
    assert.equal(
      harness.scheduler.hasLiveRuleSubtree(SUBJECT),
      true,
      "the child's fiber reaches the subject through the rule-ancestor chain"
    );
    assert.equal(harness.scheduler.hasLiveRuleSubtree(WAITER), false, "ancestry does not cross to a sibling");
  });

  test("a subtree whose fibers have all finished is not live", () => {
    const harness = startHarness({ subject: mkRule(TRUE_CONST) });
    const fiberId = harness.spawnRoot(SUBJECT);
    harness.scheduler.tick();

    assert.equal(harness.scheduler.getFiber(fiberId)?.state, FiberState.DONE);
    assert.equal(harness.scheduler.hasLiveRuleSubtree(SUBJECT), false);
  });

  test("a fiber waiting on a handle counts as live", () => {
    const park = makeParkingFn();
    const harness = startHarness({ subject: mkParkingRule(park.fnId) });
    const fiberId = harness.spawnRoot(SUBJECT);
    harness.scheduler.tick();

    assert.equal(harness.scheduler.getFiber(fiberId)?.state, FiberState.WAITING);
    assert.equal(harness.scheduler.hasLiveRuleSubtree(SUBJECT), true);
  });
});

describe("the settle walk", () => {
  test("a watcher resolves true when the watched rule fired and its cluster emptied", () => {
    const harness = startHarness({ subject: mkRule(TRUE_CONST) });
    const handleId = parkWatcher(harness, SUBJECT);
    harness.spawnRoot(SUBJECT);
    harness.scheduler.tick();

    const handle = harness.handles.get(handleId);
    assert.equal(handle?.state, HandleState.RESOLVED);
    assert.deepEqual(handle?.result, TRUE_VALUE);
    assert.equal(harness.recordOf(SUBJECT), RuleFiringState.DID_FIRE);
  });

  test("a watcher resolves false when the watched rule ended its think without firing", () => {
    const harness = startHarness({ subject: mkRule(FALSE_CONST) });
    const handleId = parkWatcher(harness, SUBJECT);
    harness.spawnRoot(SUBJECT);
    harness.scheduler.tick();

    const handle = harness.handles.get(handleId);
    assert.equal(handle?.state, HandleState.RESOLVED);
    assert.deepEqual(handle?.result, FALSE_VALUE);
    assert.equal(harness.recordOf(SUBJECT), RuleFiringState.DID_NOT_FIRE);
  });

  test("a watcher resolves false when the cluster faults after firing", () => {
    const harness = startHarness({ subject: mkFaultingRule() });
    const handleId = parkWatcher(harness, SUBJECT);
    const fiberId = harness.spawnRoot(SUBJECT);
    harness.scheduler.tick();

    assert.equal(harness.scheduler.getFiber(fiberId)?.state, FiberState.FAULT);
    assert.equal(harness.recordOf(SUBJECT), RuleFiringState.DID_FIRE, "the rule fired before it faulted");
    const handle = harness.handles.get(handleId);
    assert.equal(handle?.state, HandleState.RESOLVED);
    assert.deepEqual(handle?.result, FALSE_VALUE, "a fault abandons the sequence");
  });

  test("a watcher resolves false when a page exit cancels the cluster", () => {
    const park = makeParkingFn();
    const harness = startHarness({
      subject: mkRule(TRUE_CONST, [{ op: Op.SPAWN_RULE, a: CHILD }]),
      child: mkParkingRule(park.fnId),
    });
    const handleId = parkWatcher(harness, SUBJECT);
    harness.spawnRoot(SUBJECT);
    harness.scheduler.tick();
    assert.equal(harness.handles.get(handleId)?.state, HandleState.PENDING, "the parked child holds the cluster open");

    harness.scheduler.cancelChildRuleFibers();

    const handle = harness.handles.get(handleId);
    assert.equal(handle?.state, HandleState.RESOLVED);
    assert.deepEqual(handle?.result, FALSE_VALUE);
  });

  test("the watcher slot is empty once the walk has resolved it", () => {
    const harness = startHarness({ subject: mkRule(TRUE_CONST) });
    parkWatcher(harness, SUBJECT);
    harness.spawnRoot(SUBJECT);
    harness.scheduler.tick();

    assert.equal(harness.slots.has(SUBJECT), false);
    assert.equal(harness.context.services.brain.ruleCompletion.getWatcher(SUBJECT), undefined);
  });

  test("a cluster held open by a parked descendant resolves the think that descendant finishes", () => {
    const park = makeParkingFn();
    const harness = startHarness({
      subject: mkRule(TRUE_CONST, [{ op: Op.SPAWN_RULE, a: CHILD }]),
      child: mkParkingRule(park.fnId),
    });
    const handleId = parkWatcher(harness, SUBJECT);
    const subjectFiberId = harness.spawnRoot(SUBJECT);

    harness.scheduler.tick();
    assert.equal(harness.scheduler.getFiber(subjectFiberId)?.state, FiberState.DONE, "the subject's own fiber is done");
    assert.equal(
      harness.handles.get(handleId)?.state,
      HandleState.PENDING,
      "the watcher stays pending while the child is parked"
    );

    park.resolvePending(TRUE_VALUE);
    harness.scheduler.tick();

    const handle = harness.handles.get(handleId);
    assert.equal(handle?.state, HandleState.RESOLVED);
    assert.deepEqual(handle?.result, TRUE_VALUE);
  });

  test("a watcher resolves false when a descendant faulted before the cluster's last fiber finished", () => {
    const park = makeParkingFn();
    const harness = startHarness({ subject: mkParentParkingRule(park.fnId), child: mkFaultingRule() });
    const handleId = parkWatcher(harness, SUBJECT);
    const subjectFiberId = harness.spawnRoot(SUBJECT);

    harness.scheduler.tick();
    assert.equal(harness.recordOf(CHILD), RuleFiringState.DID_FIRE, "the child fired before it faulted");
    assert.equal(harness.scheduler.hasLiveRuleSubtree(CHILD), false, "the child's fiber is terminal");
    assert.equal(
      harness.handles.get(handleId)?.state,
      HandleState.PENDING,
      "the subject's own parked fiber holds the cluster open past the fault"
    );

    park.resolvePending(TRUE_VALUE);
    harness.scheduler.tick();

    assert.equal(
      harness.scheduler.getFiber(subjectFiberId)?.state,
      FiberState.DONE,
      "the fiber that empties the cluster finishes normally"
    );
    const handle = harness.handles.get(handleId);
    assert.equal(handle?.state, HandleState.RESOLVED);
    assert.deepEqual(handle?.result, FALSE_VALUE, "a fault anywhere in the cluster abandons the whole firing");
  });

  test("a watcher resolves false when a descendant was cancelled before the cluster's last fiber finished", () => {
    const childPark = makeParkingFn();
    const subjectPark = makeParkingFn();
    const harness = startHarness({
      subject: mkParentParkingRule(subjectPark.fnId),
      child: mkParkingRule(childPark.fnId),
    });
    const handleId = parkWatcher(harness, SUBJECT);
    const subjectFiberId = harness.spawnRoot(SUBJECT);
    harness.scheduler.tick();

    harness.scheduler.cancelChildRuleFibers();
    assert.equal(
      harness.handles.get(handleId)?.state,
      HandleState.PENDING,
      "the subject's own parked fiber holds the cluster open past the cancellation"
    );

    subjectPark.resolvePending(TRUE_VALUE);
    harness.scheduler.tick();

    assert.equal(harness.scheduler.getFiber(subjectFiberId)?.state, FiberState.DONE);
    const handle = harness.handles.get(handleId);
    assert.equal(handle?.state, HandleState.RESOLVED);
    assert.deepEqual(handle?.result, FALSE_VALUE, "a cancellation abandons the cluster exactly as a fault does");
  });
});

describe("the rule trigger host action", () => {
  /** Dispatches the trigger for `callerFuncId` and returns the handle it was given. */
  function dispatchTrigger(harness: Harness, callerFuncId: number): HandleId {
    const action = services.runtime.actions.getById(CoreHostActions.RuleTrigger.actionId);
    assert.ok(action && action.binding === "host" && action.execAsync, "the rule trigger must be registered");
    const handleId = harness.handles.createPending();
    harness.context.currentRuleFuncId = callerFuncId;
    action.execAsync(harness.context, List.empty<Value>(), {
      id: handleId,
      resolve: (value: Value) => harness.handles.resolve(handleId, value),
      reject: () => {},
      cancel: () => {},
    });
    return handleId;
  }

  test("the trigger carries the ids the VM contract records", () => {
    assert.equal(CoreHostActions.RuleTrigger.actionId, 9);
    assert.equal(CoreHostActions.RuleTrigger.fnId, 107);
  });

  test("the trigger is not offered as a tile", () => {
    const action = services.runtime.actions.getById(CoreHostActions.RuleTrigger.actionId);
    assert.ok(action, "the action is registered for the compiler to emit");
    assert.equal(
      services.edit.tiles.get(`sensor:${CoreHostActions.RuleTrigger.key}`),
      undefined,
      "the trigger is compiler-emitted surface with no tile"
    );
  });

  test("a subject that fired and settled answers true at once", () => {
    const harness = startHarness({ subject: mkRule(TRUE_CONST) });
    harness.seedRecord(SUBJECT, RuleFiringState.DID_FIRE);

    const handleId = dispatchTrigger(harness, WAITER);

    const handle = harness.handles.get(handleId);
    assert.equal(handle?.state, HandleState.RESOLVED);
    assert.deepEqual(handle?.result, TRUE_VALUE);
    assert.equal(harness.slots.has(SUBJECT), false, "an immediate answer occupies no watcher slot");
  });

  test("a subject that faulted in its own DO after firing answers false at once", () => {
    const harness = startHarness({ subject: mkFaultingRule() });
    const subjectFiberId = harness.spawnRoot(SUBJECT);
    harness.scheduler.tick();
    assert.equal(harness.scheduler.getFiber(subjectFiberId)?.state, FiberState.FAULT);
    assert.equal(harness.recordOf(SUBJECT), RuleFiringState.DID_FIRE, "the rule fired before it faulted");

    const handleId = dispatchTrigger(harness, WAITER);

    const handle = harness.handles.get(handleId);
    assert.equal(handle?.state, HandleState.RESOLVED);
    assert.deepEqual(handle?.result, FALSE_VALUE, "the subtree a fault emptied is not a completion");
  });

  test("a fresh firing clears the abandonment its predecessor left", () => {
    const settle = makeSettlingFn(true);
    const harness = startHarness({ subject: mkAwaitingRule(settle.fnId) });

    harness.spawnRoot(SUBJECT);
    harness.scheduler.tick();
    const afterFault = harness.handles.get(dispatchTrigger(harness, WAITER));
    assert.deepEqual(afterFault?.result, FALSE_VALUE, "the abandoned firing skips the rule below it");

    settle.setFailing(false);
    const watcherId = parkWatcher(harness, SUBJECT);
    harness.spawnRoot(SUBJECT);
    harness.scheduler.tick();

    const watcher = harness.handles.get(watcherId);
    assert.equal(watcher?.state, HandleState.RESOLVED);
    assert.deepEqual(watcher?.result, TRUE_VALUE, "the next firing completed with no fault in its cluster");
    const afterClean = harness.handles.get(dispatchTrigger(harness, WAITER));
    assert.deepEqual(afterClean?.result, TRUE_VALUE);
  });

  test("a subject settled without firing answers false at once", () => {
    const harness = startHarness({ subject: mkRule(FALSE_CONST) });
    harness.seedRecord(SUBJECT, RuleFiringState.DID_NOT_FIRE);

    const handleId = dispatchTrigger(harness, WAITER);

    const handle = harness.handles.get(handleId);
    assert.equal(handle?.state, HandleState.RESOLVED);
    assert.deepEqual(handle?.result, FALSE_VALUE);
  });

  test("a rule with no subject answers false at once", () => {
    const harness = startHarness({ subject: mkRule(TRUE_CONST) });

    const handleId = dispatchTrigger(harness, SUBJECT);

    const handle = harness.handles.get(handleId);
    assert.equal(handle?.state, HandleState.RESOLVED);
    assert.deepEqual(handle?.result, FALSE_VALUE);
  });

  test("a subject whose cluster is in flight parks the handle in its watcher slot", () => {
    const harness = startHarness({ subject: mkRule(TRUE_CONST) });
    harness.spawnRoot(SUBJECT);
    harness.seedRecord(WAITER, RuleFiringState.EVALUATING);

    const handleId = dispatchTrigger(harness, WAITER);

    assert.equal(harness.handles.get(handleId)?.state, HandleState.PENDING);
    assert.equal(harness.slots.get(SUBJECT), handleId);
    assert.equal(
      harness.recordOf(WAITER),
      RuleFiringState.DID_NOT_FIRE,
      "the waiting rule records that it has not fired, so a chain-gated sibling below it evaluates"
    );
  });

  test("a parked trigger resumes its rule through AWAIT when the subject's cluster settles", () => {
    const park = makeParkingFn();
    const harness = startHarness({ subject: mkParkingRule(park.fnId), waiter: mkTriggeredRule() });
    harness.spawnRoot(SUBJECT);
    harness.spawnRoot(WAITER);

    harness.scheduler.tick();
    assert.equal(harness.recordOf(SUBJECT), RuleFiringState.EVALUATING, "the subject is parked mid-WHEN");
    assert.equal(
      harness.recordOf(WAITER),
      RuleFiringState.DID_NOT_FIRE,
      "the trigger's pre-wait write survives its own rule's WHEN_START"
    );
    assert.equal(harness.slots.get(SUBJECT) !== undefined, true, "the trigger parked on the subject");

    park.resolvePending(TRUE_VALUE);
    harness.scheduler.tick();
    assert.equal(harness.recordOf(SUBJECT), RuleFiringState.DID_FIRE, "the subject resumed, fired, and completed");
    assert.equal(harness.recordOf(WAITER), RuleFiringState.DID_NOT_FIRE, "a resumed waiter joins the next round");

    harness.scheduler.tick();
    assert.equal(harness.recordOf(WAITER), RuleFiringState.DID_FIRE, "a true trigger answer fires the waiting rule");
    assert.equal(harness.slots.has(SUBJECT), false);
  });

  test("a page exit during a wait leaves no pending trigger handle, whichever rule it cancels first", () => {
    for (const cancelSubjectFirst of [true, false]) {
      const park = makeParkingFn();
      const harness = startHarness({ subject: mkParkingRule(park.fnId), waiter: mkTriggeredRule() });
      const subjectFiberId = harness.spawnRoot(SUBJECT);
      const waiterFiberId = harness.spawnRoot(WAITER);
      harness.scheduler.tick();

      const triggerHandleId = harness.slots.get(SUBJECT);
      assert.ok(triggerHandleId !== undefined, "the trigger parked on the subject");

      const order = cancelSubjectFirst ? [subjectFiberId, waiterFiberId] : [waiterFiberId, subjectFiberId];
      for (const fiberId of order) {
        harness.scheduler.cancel(fiberId);
      }

      const label = cancelSubjectFirst ? "subject cancelled first" : "waiter cancelled first";
      assert.notEqual(
        harness.handles.get(triggerHandleId)?.state,
        HandleState.PENDING,
        `the trigger handle settles with the cascade (${label})`
      );
      assert.equal(harness.slots.has(SUBJECT), false, `the watcher slot is empty again (${label})`);
      assert.equal(harness.scheduler.getFiber(waiterFiberId)?.state, FiberState.CANCELLED);
    }
  });

  test("a parked trigger answers false when the subject's cluster ends unfired", () => {
    const park = makeParkingFn();
    const harness = startHarness({ subject: mkParkingRule(park.fnId), waiter: mkTriggeredRule() });
    harness.spawnRoot(SUBJECT);
    harness.spawnRoot(WAITER);

    harness.scheduler.tick();
    park.resolvePending(FALSE_VALUE);
    harness.scheduler.tick();
    harness.scheduler.tick();

    assert.equal(harness.recordOf(SUBJECT), RuleFiringState.DID_NOT_FIRE);
    assert.equal(harness.recordOf(WAITER), RuleFiringState.DID_NOT_FIRE, "the waiting rule takes the skip path");
  });
});
