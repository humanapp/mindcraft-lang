/**
 * The `onHostActionReturn` VM hook: one report per host-action call at the
 * moment the call hands control back to the runtime, carrying the action's
 * registry id, the call site it was bound to, the positional arguments, and the
 * value a synchronous call produced.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { List, UniqueSet } from "@wendoo/core";
import {
  type ActionDescriptor,
  BrainActionRegistry,
  BrainRuntime,
  BYTECODE_VERSION,
  type FunctionBytecode,
  type HostActionBinding,
  type HostActionReturnEvent,
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
} from "@wendoo/core/runtime";
import { __test__createPlatformServices } from "@wendoo/core/runtime/__test__";

/** funcId of the single rule function every fixture below runs. */
const RULE_FUNC_ID = 0;

/** Call-site id every fixture below binds its dispatch to. */
const CALL_SITE_ID = 3;

/** Stable registry id of the synchronous action the fixtures dispatch. */
const SYNC_ACTION_ID = 4201;

/** Stable registry id of the asynchronous action the fixtures dispatch. */
const ASYNC_ACTION_ID = 4202;

/** Stable registry id of the synchronous action whose body throws. */
const FAULTING_ACTION_ID = 4203;

/** Value the synchronous action returns. */
const SYNC_RESULT = 42;

/** Tile id of the one argument slot every fixture action declares. */
const AMOUNT_TILE_ID = "amount";

function descriptorOf(key: string, isAsync: boolean): ActionDescriptor {
  return { key, kind: "actuator", callDef: mkCallDef(param(AMOUNT_TILE_ID)), isAsync };
}

/**
 * A registry holding a synchronous action, an asynchronous action, and a
 * synchronous action whose body throws. Each body appends `"body"` to `log` so a
 * caller can order the report against the work the call did.
 */
function makeActions(log: string[]): BrainActionRegistry {
  const actions = new BrainActionRegistry();
  const sync: HostActionBinding = {
    binding: "host",
    id: SYNC_ACTION_ID,
    descriptor: descriptorOf("actuator.probe.mark", false),
    execSync: () => {
      log.push("body");
      return mkNumberValue(SYNC_RESULT);
    },
  };
  const async: HostActionBinding = {
    binding: "host",
    id: ASYNC_ACTION_ID,
    descriptor: descriptorOf("actuator.probe.hold", true),
    execAsync: (_ctx, _args, handle) => {
      log.push("body");
      handle.resolve(VOID_VALUE);
    },
  };
  const faulting: HostActionBinding = {
    binding: "host",
    id: FAULTING_ACTION_ID,
    descriptor: descriptorOf("actuator.probe.fail", false),
    execSync: () => {
      throw new Error("probe failure");
    },
  };
  actions.register(sync);
  actions.register(async);
  actions.register(faulting);
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
 * A rule whose WHEN passes and whose DO dispatches `dispatch` with the number at
 * constant index 0 as its one argument, discarding what the call pushes.
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

/**
 * One return report kept past its notification: the payload's argument container
 * is only valid while the notification runs, so the arguments are read out on
 * receipt.
 */
interface Captured {
  actionId: number;
  callSiteId: number;
  args: Value[];
  result: Value | undefined;
}

function capture(payload: HostActionReturnEvent): Captured {
  const args: Value[] = [];
  for (let i = 0; i < payload.args.size(); i++) {
    args.push(payload.args.get(i));
  }
  return {
    actionId: payload.actionId,
    callSiteId: payload.callSiteId,
    args,
    result: payload.result,
  };
}

/**
 * Build a runtime over a rule that runs `dispatch`, run one think, and return
 * every return report plus the ordered log of bodies and reports.
 */
function observe(dispatch: Instr[], amount: number): { captured: Captured[]; log: string[] } {
  const log: string[] = [];
  const captured: Captured[] = [];
  const program = mkRuleProgram(mkDispatchingRule(dispatch), [TRUE_VALUE, NIL_VALUE], [amount]);
  const runtime = new BrainRuntime(
    program,
    List.from([makePage()]),
    makeHostServices(makeActions(log)),
    undefined,
    undefined,
    {
      onHostActionDispatch: () => {
        log.push("dispatch");
      },
      onHostActionReturn: (payload) => {
        log.push("return");
        captured.push(capture(payload));
      },
    }
  );

  runtime.startup();
  runtime.think(1);
  return { captured, log };
}

/** The instruction dispatching the synchronous action with one argument. */
const syncDispatch: Instr[] = [{ op: Op.HOST_ACTION_CALL, a: SYNC_ACTION_ID, b: 1, c: CALL_SITE_ID }];

/** The instructions dispatching the asynchronous action with one argument and awaiting it. */
const asyncDispatch: Instr[] = [
  { op: Op.HOST_ACTION_CALL_ASYNC, a: ASYNC_ACTION_ID, b: 1, c: CALL_SITE_ID },
  { op: Op.AWAIT },
];

/** The instruction dispatching the synchronous action whose body throws. */
const faultingDispatch: Instr[] = [{ op: Op.HOST_ACTION_CALL, a: FAULTING_ACTION_ID, b: 1, c: CALL_SITE_ID }];

describe("host action return observation -- a synchronous call", () => {
  test("reports the action, its call site, its arguments, and the value it produced", () => {
    const { captured } = observe(syncDispatch, 7);

    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.actionId, SYNC_ACTION_ID);
    assert.equal(captured[0]?.callSiteId, CALL_SITE_ID);
    assert.deepEqual(captured[0]?.args, [mkNumberValue(7)]);
    assert.deepEqual(captured[0]?.result, mkNumberValue(SYNC_RESULT));
  });

  test("reports after the body has run, where the dispatch report precedes it", () => {
    const { log } = observe(syncDispatch, 7);

    assert.deepEqual(log, ["dispatch", "body", "return"]);
  });
});

describe("host action return observation -- an asynchronous call", () => {
  test("reports the action, its call site, and its arguments, with no value", () => {
    const { captured } = observe(asyncDispatch, 9);

    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.actionId, ASYNC_ACTION_ID);
    assert.equal(captured[0]?.callSiteId, CALL_SITE_ID);
    assert.deepEqual(captured[0]?.args, [mkNumberValue(9)]);
    assert.equal(captured[0]?.result, undefined);
  });

  test("reports after the body has started, where the dispatch report precedes it", () => {
    const { log } = observe(asyncDispatch, 9);

    assert.deepEqual(log, ["dispatch", "body", "return"]);
  });
});

describe("host action return observation -- a call whose body throws", () => {
  test("reports the dispatch and nothing more", () => {
    const { captured, log } = observe(faultingDispatch, 7);

    assert.equal(captured.length, 0);
    assert.deepEqual(log, ["dispatch"]);
  });
});
