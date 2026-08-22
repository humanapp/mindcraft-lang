/**
 * The `host_action_dispatched` brain event and the `onHostActionDispatch` VM
 * hook that feeds it: one report per host-action call, synchronous or
 * asynchronous, carrying the action's descriptor, the positional arguments the
 * call made, and the rule the runtime attributed it to.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { List, UniqueSet } from "@wendoo-lang/core";
import {
  type ActionDescriptor,
  BrainActionRegistry,
  BrainRuntime,
  BYTECODE_VERSION,
  type FunctionBytecode,
  type HostActionBinding,
  type HostActionDispatchEvent,
  type Instr,
  mkCallDef,
  mkNumberValue,
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

/** funcId of the single rule function every fixture below runs. */
const RULE_FUNC_ID = 0;

/** Stable registry id of the synchronous action the fixtures dispatch. */
const SYNC_ACTION_ID = 4101;

/** Stable registry id of the asynchronous action the fixtures dispatch. */
const ASYNC_ACTION_ID = 4102;

/** Key of the synchronous action the fixtures dispatch. */
const SYNC_ACTION_KEY = "actuator.probe.mark";

/** Key of the asynchronous action the fixtures dispatch. */
const ASYNC_ACTION_KEY = "actuator.probe.hold";

/** Tile id of the one argument slot both actions declare. */
const AMOUNT_TILE_ID = "amount";

function descriptorOf(key: string, isAsync: boolean): ActionDescriptor {
  return { key, kind: "actuator", callDef: mkCallDef(param(AMOUNT_TILE_ID)), isAsync };
}

/** A registry holding one synchronous and one asynchronous host action. */
function makeActions(): BrainActionRegistry {
  const actions = new BrainActionRegistry();
  const sync: HostActionBinding = {
    binding: "host",
    id: SYNC_ACTION_ID,
    descriptor: descriptorOf(SYNC_ACTION_KEY, false),
    execSync: () => VOID_VALUE,
  };
  const async: HostActionBinding = {
    binding: "host",
    id: ASYNC_ACTION_ID,
    descriptor: descriptorOf(ASYNC_ACTION_KEY, true),
    execAsync: (_ctx, _args, handle) => {
      handle.resolve(VOID_VALUE);
    },
  };
  actions.register(sync);
  actions.register(async);
  return actions;
}

function mkFunc(code: Instr[]): FunctionBytecode {
  return { code: List.from(code), numParams: 0 };
}

/** A one-function program whose only function is registered as a rule entry. */
function mkRuleProgram(code: Instr[], constants: Value[], numbers: number[]): Program {
  const ruleFuncIds = new UniqueSet<number>();
  ruleFuncIds.add(RULE_FUNC_ID);
  return {
    version: BYTECODE_VERSION,
    functions: List.from([mkFunc(code)]),
    constantPools: {
      numbers: List.from(numbers),
      strings: List.empty<string>(),
      values: List.from(constants),
    },
    variableNames: List.empty<string>(),
    entryPoint: RULE_FUNC_ID,
    ruleFuncIds,
  };
}

/**
 * A rule whose WHEN passes and whose DO dispatches `dispatch` with the number
 * at constant index 0 as its one argument, discarding what the call pushes.
 */
function mkDispatchingRule(dispatch: Instr[]): Instr[] {
  return [
    { op: Op.WHEN_START },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.WHEN_END, a: 4 + dispatch.length },
    { op: Op.DO_START },
    { op: Op.PUSH_CONST_NUM, a: 0 },
    ...dispatch,
    { op: Op.POP },
    { op: Op.DO_END },
    { op: Op.JMP, a: 1 },
    { op: Op.PUSH_CONST_VAL, a: 1 },
    { op: Op.RET },
  ];
}

function makePage(): PageMetadata {
  return {
    pageIndex: 0,
    pageId: "page-1-id",
    pageName: "page-1",
    rootRuleFuncIds: List.from([RULE_FUNC_ID]),
    actionCallSites: List.empty(),
  };
}

function makeHostServices(actions: BrainActionRegistry): Omit<PlatformServices, "brain"> {
  const all = __test__createPlatformServices({ runtime: { actions } });
  return { runtime: all.runtime, shared: all.shared, app: all.app };
}

/** Dispatch reports collected from the brain event channel and from a caller-supplied VM hook. */
interface Observed {
  fromBrainEvent: HostActionDispatchEvent[];
  fromVmHook: HostActionDispatchEvent[];
}

/**
 * One dispatch report kept past its notification: the payload's argument
 * container is only valid while the notification runs, so the arguments are
 * read out on receipt.
 */
interface Captured {
  actionKey: string;
  isAsync: boolean;
  ruleFuncId: number | undefined;
  args: Value[];
  argTileIds: string[];
}

function capture(payload: HostActionDispatchEvent): Captured {
  const args: Value[] = [];
  const argTileIds: string[] = [];
  for (let i = 0; i < payload.args.size(); i++) {
    args.push(payload.args.get(i));
  }
  payload.descriptor.callDef.argSlots.forEach((slot) => {
    argTileIds.push(slot.argSpec.tileId);
  });
  return {
    actionKey: payload.descriptor.key,
    isAsync: payload.descriptor.isAsync,
    ruleFuncId: payload.ruleFuncId,
    args,
    argTileIds,
  };
}

/** Build a runtime over `program`, run one think, and collect every dispatch report. */
function observe(dispatch: Instr[], amount: number): { observed: Observed; captured: Captured[] } {
  const captured: Captured[] = [];
  const fromVmHook: HostActionDispatchEvent[] = [];
  const program = mkRuleProgram(mkDispatchingRule(dispatch), [TRUE_VALUE, NIL_VALUE], [amount]);
  const runtime = new BrainRuntime(
    program,
    List.from([makePage()]),
    makeHostServices(makeActions()),
    undefined,
    undefined,
    {
      onHostActionDispatch: (payload) => {
        fromVmHook.push(payload);
      },
    }
  );

  const fromBrainEvent: HostActionDispatchEvent[] = [];
  runtime.events().on("host_action_dispatched", (payload) => {
    fromBrainEvent.push(payload);
    captured.push(capture(payload));
  });

  runtime.startup();
  runtime.think(1);
  return { observed: { fromBrainEvent, fromVmHook }, captured };
}

/** The instruction dispatching the synchronous action with one argument. */
const syncDispatch: Instr[] = [{ op: Op.HOST_ACTION_CALL, a: SYNC_ACTION_ID, b: 1, c: 0 }];

/** The instructions dispatching the asynchronous action with one argument and awaiting it. */
const asyncDispatch: Instr[] = [{ op: Op.HOST_ACTION_CALL_ASYNC, a: ASYNC_ACTION_ID, b: 1, c: 0 }, { op: Op.AWAIT }];

describe("host action dispatch observation -- a synchronous call", () => {
  test("reports the action, its arguments, and the rule it was attributed to", () => {
    const { observed, captured } = observe(syncDispatch, 7);

    assert.equal(observed.fromBrainEvent.length, 1);
    assert.equal(captured[0]?.actionKey, SYNC_ACTION_KEY);
    assert.equal(captured[0]?.isAsync, false);
    assert.equal(captured[0]?.ruleFuncId, RULE_FUNC_ID);
    assert.deepEqual(captured[0]?.args, [mkNumberValue(7)]);
  });

  test("carries the call grammar the arguments are named by", () => {
    const { captured } = observe(syncDispatch, 7);

    assert.deepEqual(captured[0]?.argTileIds, [`tile.parameter->${AMOUNT_TILE_ID}`]);
  });
});

describe("host action dispatch observation -- an asynchronous call", () => {
  test("reports the same way a synchronous call does, at the moment the call is made", () => {
    const { observed, captured } = observe(asyncDispatch, 9);

    assert.equal(observed.fromBrainEvent.length, 1);
    assert.equal(captured[0]?.actionKey, ASYNC_ACTION_KEY);
    assert.equal(captured[0]?.isAsync, true);
    assert.equal(captured[0]?.ruleFuncId, RULE_FUNC_ID);
    assert.deepEqual(captured[0]?.args, [mkNumberValue(9)]);
  });
});

describe("host action dispatch observation -- reporting cadence", () => {
  test("a caller-supplied VM hook receives every dispatch the brain event does", () => {
    const { observed } = observe(syncDispatch, 7);

    assert.equal(observed.fromVmHook.length, 1);
    assert.deepEqual(observed.fromVmHook, observed.fromBrainEvent);
  });

  test("a rule whose gate does not pass dispatches nothing and reports nothing", () => {
    const program = mkRuleProgram(mkDispatchingRule(syncDispatch), [NIL_VALUE, NIL_VALUE], [7]);
    const runtime = new BrainRuntime(program, List.from([makePage()]), makeHostServices(makeActions()));
    const reported: HostActionDispatchEvent[] = [];
    runtime.events().on("host_action_dispatched", (payload) => {
      reported.push(payload);
    });

    runtime.startup();
    runtime.think(1);

    assert.equal(reported.length, 0);
  });
});
