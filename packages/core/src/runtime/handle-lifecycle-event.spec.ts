/**
 * The lifecycle a brain reports around an asynchronous host-action call: the
 * dispatch carries the handle its result settles on, the fiber that parks on
 * that handle reports the rule it belongs to, the settle reports the handle's
 * outcome under the same id, and a root rule held from re-firing by a live
 * rule below it reports itself quiesced.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { List, UniqueSet } from "@wendoo-lang/core";
import {
  type ActionDescriptor,
  type AsyncHandle,
  BrainActionRegistry,
  BrainRuntime,
  BYTECODE_VERSION,
  ErrorCode,
  type FiberWaitingEvent,
  type FunctionBytecode,
  HandleOutcome,
  type HandleSettleEvent,
  type HostActionBinding,
  type HostActionDispatchEvent,
  type Instr,
  mkCallDef,
  NIL_VALUE,
  Op,
  type PageMetadata,
  type PlatformServices,
  type Program,
  param,
  TRUE_VALUE,
  type Value,
  VOID_VALUE,
} from "@wendoo-lang/core/runtime";
import { __test__createPlatformServices } from "@wendoo-lang/core/runtime/__test__";

/** funcId of the root rule every fixture below runs. */
const ROOT_FUNC_ID = 0;

/** funcId of the child rule the quiescence fixture nests under the root. */
const CHILD_FUNC_ID = 1;

/** Stable registry id of the asynchronous action the fixtures dispatch. */
const ASYNC_ACTION_ID = 4201;

/** Key of the asynchronous action the fixtures dispatch. */
const ASYNC_ACTION_KEY = "actuator.probe.hold";

/** Tile id of the one argument slot the action declares. */
const AMOUNT_TILE_ID = "amount";

/** How the fixture's asynchronous action ends, and when. */
type SettleMode = "atDispatch" | "deferred" | "reject";

/** The handles a deferred action has taken and not yet settled. */
interface HeldHandles {
  held: AsyncHandle[];
}

/**
 * A registry holding one asynchronous host action that settles as `mode` says:
 * at dispatch, only when the test settles it, or by rejecting at dispatch.
 */
function makeActions(mode: SettleMode, holder: HeldHandles): BrainActionRegistry {
  const actions = new BrainActionRegistry();
  const descriptor: ActionDescriptor = {
    key: ASYNC_ACTION_KEY,
    kind: "actuator",
    callDef: mkCallDef(param(AMOUNT_TILE_ID)),
    isAsync: true,
  };
  const binding: HostActionBinding = {
    binding: "host",
    id: ASYNC_ACTION_ID,
    descriptor,
    execAsync: (_ctx, _args, handle) => {
      if (mode === "atDispatch") handle.resolve(VOID_VALUE);
      else if (mode === "reject") handle.reject(ErrorCode.HostError, "probe");
      else holder.held.push(handle);
    },
  };
  actions.register(binding);
  return actions;
}

function mkFunc(code: Instr[], name: string): FunctionBytecode {
  return { code: List.from(code), numParams: 0, name };
}

/** A program whose functions are all registered as rule entry points. */
function mkRuleProgram(functions: FunctionBytecode[], constants: Value[], numbers: number[]): Program {
  const ruleFuncIds = new UniqueSet<number>();
  for (let i = 0; i < functions.length; i++) ruleFuncIds.add(i);
  return {
    version: BYTECODE_VERSION,
    functions: List.from(functions),
    constantPools: {
      numbers: List.from(numbers),
      strings: List.empty<string>(),
      values: List.from(constants),
    },
    variableNames: List.empty<string>(),
    entryPoint: ROOT_FUNC_ID,
    ruleFuncIds,
  };
}

/** The instructions dispatching the asynchronous action with one argument and awaiting it. */
const asyncDispatch: Instr[] = [{ op: Op.HOST_ACTION_CALL_ASYNC, a: ASYNC_ACTION_ID, b: 1, c: 0 }, { op: Op.AWAIT }];

/**
 * A rule whose WHEN passes and whose DO runs `body`, spawning the rules
 * `spawns` names once its DO has ended.
 */
function mkRule(body: Instr[], spawns: number[]): Instr[] {
  const spawnCode: Instr[] = spawns.map((funcId) => ({ op: Op.SPAWN_RULE, a: funcId }));
  return [
    { op: Op.WHEN_START },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.WHEN_END, a: 4 + body.length + spawnCode.length },
    { op: Op.DO_START },
    ...body,
    { op: Op.DO_END },
    ...spawnCode,
    { op: Op.JMP, a: 1 },
    { op: Op.PUSH_CONST_VAL, a: 1 },
    { op: Op.RET },
  ];
}

/** The DO body dispatching the asynchronous action and discarding its result. */
const awaitingBody: Instr[] = [{ op: Op.PUSH_CONST_NUM, a: 0 }, ...asyncDispatch, { op: Op.POP }];

function makePage(rootRuleFuncIds: number[]): PageMetadata {
  return {
    pageIndex: 0,
    pageId: "page-1-id",
    pageName: "page-1",
    rootRuleFuncIds: List.from(rootRuleFuncIds),
    actionCallSites: List.empty(),
  };
}

function makeHostServices(actions: BrainActionRegistry): Omit<PlatformServices, "brain"> {
  const all = __test__createPlatformServices({ runtime: { actions } });
  return { runtime: all.runtime, shared: all.shared, app: all.app };
}

/** Everything the fixtures collect off the brain's event channel. */
interface Observed {
  dispatches: HostActionDispatchEvent[];
  waits: FiberWaitingEvent[];
  settles: HandleSettleEvent[];
  quiesced: number[];
}

/** Subscribe to every lifecycle channel of `runtime`. */
function observe(runtime: BrainRuntime): Observed {
  const observed: Observed = { dispatches: [], waits: [], settles: [], quiesced: [] };
  const events = runtime.events();
  events.on("host_action_dispatched", (payload) => {
    observed.dispatches.push(payload);
  });
  events.on("fiber_waiting", (payload) => {
    observed.waits.push(payload);
  });
  events.on("handle_settled", (payload) => {
    observed.settles.push(payload);
  });
  events.on("root_rule_quiesced", (payload) => {
    observed.quiesced.push(payload.ruleFuncId);
  });
  return observed;
}

/** A brain of one root rule that dispatches the asynchronous action and awaits it. */
function oneAwaitingRule(mode: SettleMode): { runtime: BrainRuntime; observed: Observed; holder: HeldHandles } {
  const holder: HeldHandles = { held: [] };
  const program = mkRuleProgram([mkFunc(mkRule(awaitingBody, []), "root")], [TRUE_VALUE, NIL_VALUE], [7]);
  const runtime = new BrainRuntime(
    program,
    List.from([makePage([ROOT_FUNC_ID])]),
    makeHostServices(makeActions(mode, holder))
  );
  return { runtime, observed: observe(runtime), holder };
}

describe("asynchronous call lifecycle", () => {
  test("a dispatch carries the handle its settle is reported under", () => {
    const { runtime, observed } = oneAwaitingRule("atDispatch");

    runtime.startup();
    runtime.think(1);

    const handleId = observed.dispatches[0]?.handleId;
    assert.ok(handleId !== undefined, "the asynchronous dispatch carries a handle id");
    assert.deepEqual(
      observed.settles.map((settle) => settle.handleId),
      [handleId]
    );
  });

  test("a settle names the action and how the call ended", () => {
    const { runtime, observed } = oneAwaitingRule("atDispatch");

    runtime.startup();
    runtime.think(1);

    assert.equal(observed.settles[0]?.actionKey, ASYNC_ACTION_KEY);
    assert.equal(observed.settles[0]?.outcome, HandleOutcome.RESOLVED);
  });

  test("a failed call settles rejected", () => {
    const { runtime, observed } = oneAwaitingRule("reject");

    runtime.startup();
    runtime.think(1);

    assert.equal(observed.settles[0]?.outcome, HandleOutcome.REJECTED);
  });

  test("a call that settles at dispatch never parks its fiber", () => {
    const { runtime, observed } = oneAwaitingRule("atDispatch");

    runtime.startup();
    runtime.think(1);

    assert.deepEqual(observed.waits, []);
  });

  test("a fiber parked on a deferred call reports the rule it is waiting for", () => {
    const { runtime, observed } = oneAwaitingRule("deferred");

    runtime.startup();
    runtime.think(1);

    assert.equal(observed.waits.length, 1);
    assert.equal(observed.waits[0]?.ruleFuncId, ROOT_FUNC_ID);
    assert.equal(observed.waits[0]?.handleId, observed.dispatches[0]?.handleId);
  });

  test("a deferred call reports no settle until the host settles it", () => {
    const { runtime, observed, holder } = oneAwaitingRule("deferred");

    runtime.startup();
    runtime.think(1);
    assert.equal(observed.settles.length, 0);

    holder.held[0]?.resolve(VOID_VALUE);

    assert.equal(observed.settles.length, 1);
    assert.equal(observed.settles[0]?.outcome, HandleOutcome.RESOLVED);
  });

  test("a rule parked on a deferred call dispatches nothing further while it waits", () => {
    const { runtime, observed } = oneAwaitingRule("deferred");

    runtime.startup();
    runtime.think(1);
    runtime.think(2);
    runtime.think(3);

    assert.equal(observed.dispatches.length, 1, "the parked rule did not re-fire");
  });
});

describe("root rule quiescence", () => {
  test("a root rule held by a parked rule below it reports itself quiesced", () => {
    const holder: HeldHandles = { held: [] };
    const program = mkRuleProgram(
      [mkFunc(mkRule([], [CHILD_FUNC_ID]), "root"), mkFunc(mkRule(awaitingBody, []), "child")],
      [TRUE_VALUE, NIL_VALUE],
      [7]
    );
    const runtime = new BrainRuntime(
      program,
      List.from([makePage([ROOT_FUNC_ID])]),
      makeHostServices(makeActions("deferred", holder))
    );
    const observed = observe(runtime);

    runtime.startup();
    runtime.think(1);
    assert.equal(observed.waits.length, 1, "the child parked on its call");
    assert.deepEqual(observed.quiesced, [], "the root ran this think");

    runtime.think(2);
    runtime.think(3);

    assert.deepEqual(observed.quiesced, [ROOT_FUNC_ID, ROOT_FUNC_ID], "the root is held once per think");
    assert.equal(observed.dispatches.length, 1, "the held root spawned no further child run");
  });

  test("a root rule re-fires once the call below it settles", () => {
    const holder: HeldHandles = { held: [] };
    const program = mkRuleProgram(
      [mkFunc(mkRule([], [CHILD_FUNC_ID]), "root"), mkFunc(mkRule(awaitingBody, []), "child")],
      [TRUE_VALUE, NIL_VALUE],
      [7]
    );
    const runtime = new BrainRuntime(
      program,
      List.from([makePage([ROOT_FUNC_ID])]),
      makeHostServices(makeActions("deferred", holder))
    );
    const observed = observe(runtime);

    runtime.startup();
    runtime.think(1);
    runtime.think(2);
    assert.deepEqual(observed.quiesced, [ROOT_FUNC_ID], "the root was held while the rule below it was parked");

    holder.held[0]?.resolve(VOID_VALUE);
    runtime.think(3);
    runtime.think(4);

    assert.ok(observed.dispatches.length > 1, "the released root ran its child again");
  });
});
