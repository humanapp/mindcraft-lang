/**
 * The action-observation hooks over a bytecode-bound action: `ACTION_CALL` and
 * `ACTION_CALL_ASYNC` report the same `onHostActionDispatch` /
 * `onHostActionReturn` pair a host-bound call reports, with the action's
 * descriptor on the dispatch and its `Program.actions` slot as the return's
 * action id.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { List, UniqueSet } from "@wendoo-lang/core";
import {
  type ActionDescriptor,
  BrainRuntime,
  BYTECODE_VERSION,
  type BytecodeExecutableAction,
  type FunctionBytecode,
  type HandleId,
  HandleOutcome,
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
} from "@wendoo-lang/core/runtime";
import { __test__createPlatformServices } from "@wendoo-lang/core/runtime/__test__";

/** funcId of the single rule function every fixture below runs. */
const RULE_FUNC_ID = 0;

/** funcId of the action body every fixture below dispatches. */
const ACTION_ENTRY_FUNC_ID = 1;

/** `Program.actions` slot every fixture below dispatches. */
const ACTION_SLOT = 0;

/** Call-site id every fixture below binds its dispatch to. */
const CALL_SITE_ID = 3;

/** Key of the synchronous compiled tile the fixtures dispatch. */
const SYNC_ACTION_KEY = "user::my-cool-actuator";

/** Key of the asynchronous compiled tile the fixtures dispatch. */
const ASYNC_ACTION_KEY = "user::my-slow-actuator";

/** Value the synchronous action body returns. */
const SYNC_RESULT = 42;

/** Value the mutating action body writes over its parameter slot. */
const REWRITTEN_ARG = 99;

/** Tile id of the one argument slot every fixture action declares. */
const AMOUNT_TILE_ID = "amount";

function descriptorOf(key: string, isAsync: boolean): ActionDescriptor {
  return { key, kind: "actuator", callDef: mkCallDef(param(AMOUNT_TILE_ID)), isAsync };
}

function mkFunc(code: Instr[], numParams: number, name: string): FunctionBytecode {
  return { code: List.from(code), numParams, name };
}

/**
 * A two-function program: the rule entry at {@link RULE_FUNC_ID} running
 * `ruleCode`, and the action body at {@link ACTION_ENTRY_FUNC_ID} running
 * `actionCode` over one parameter. Constant pool: value 0 is `true`, value 1 is
 * nil, number 0 is `amount`, number 1 is {@link SYNC_RESULT}, number 2 is
 * {@link REWRITTEN_ARG}.
 */
function mkProgram(ruleCode: Instr[], actionCode: Instr[], action: BytecodeExecutableAction, amount: number): Program {
  const ruleFuncIds = new UniqueSet<number>();
  ruleFuncIds.add(RULE_FUNC_ID);
  return {
    version: BYTECODE_VERSION,
    functions: List.from([mkFunc(ruleCode, 0, "rule"), mkFunc(actionCode, 1, "action-entry")]),
    constantPools: {
      numbers: List.from([amount, SYNC_RESULT, REWRITTEN_ARG]),
      strings: List.empty<string>(),
      values: List.from([TRUE_VALUE, NIL_VALUE]),
    },
    variableNames: List.empty<string>(),
    entryPoint: RULE_FUNC_ID,
    ruleFuncIds,
    actions: List.from([action]),
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

function makeHostServices(): Omit<PlatformServices, "brain"> {
  const all = __test__createPlatformServices();
  return { runtime: all.runtime, shared: all.shared, app: all.app };
}

/** One dispatch report kept past its notification, with its arguments read out on receipt. */
interface CapturedDispatch {
  key: string;
  args: Value[];
  ruleFuncId: number | undefined;
  handleId: HandleId | undefined;
}

/** One return report kept past its notification, with its arguments read out on receipt. */
interface CapturedReturn {
  binding: "host" | "bytecode";
  actionId: number;
  callSiteId: number;
  args: Value[];
  result: Value | undefined;
}

/** One handle settle report. */
interface CapturedSettle {
  handleId: HandleId;
  outcome: HandleOutcome;
  actionKey: string;
}

function readArgs(payload: { args: HostActionReturnEvent["args"] }): Value[] {
  const args: Value[] = [];
  for (let i = 0; i < payload.args.size(); i++) {
    args.push(payload.args.get(i));
  }
  return args;
}

interface Observed {
  dispatches: CapturedDispatch[];
  returns: CapturedReturn[];
  settles: CapturedSettle[];
  log: string[];
}

/**
 * Run `thinks` thinks of a brain whose rule dispatches the bytecode action, and
 * return every dispatch, return, and settle report plus the ordered log of the
 * reports and the action body.
 */
function observe(dispatch: Instr[], actionCode: Instr[], isAsync: boolean, amount: number, thinks: number): Observed {
  const dispatches: CapturedDispatch[] = [];
  const returns: CapturedReturn[] = [];
  const settles: CapturedSettle[] = [];
  const log: string[] = [];

  const action: BytecodeExecutableAction = {
    binding: "bytecode",
    descriptor: descriptorOf(isAsync ? ASYNC_ACTION_KEY : SYNC_ACTION_KEY, isAsync),
    entryFuncId: ACTION_ENTRY_FUNC_ID,
    numStateSlots: 0,
  };
  const program = mkProgram(mkDispatchingRule(dispatch), actionCode, action, amount);
  const runtime = new BrainRuntime(program, List.from([makePage()]), makeHostServices(), undefined, undefined, {
    onHostActionDispatch: (payload) => {
      log.push("dispatch");
      dispatches.push({
        key: payload.descriptor.key,
        args: readArgs(payload),
        ruleFuncId: payload.ruleFuncId,
        handleId: payload.handleId,
      });
    },
    onHostActionReturn: (payload) => {
      log.push("return");
      returns.push({
        binding: payload.binding,
        actionId: payload.actionId,
        callSiteId: payload.callSiteId,
        args: readArgs(payload),
        result: payload.result,
      });
    },
    onHandleSettle: (payload) => {
      log.push("settle");
      settles.push({ handleId: payload.handleId, outcome: payload.outcome, actionKey: payload.actionKey });
    },
  });

  runtime.startup();
  for (let i = 0; i < thinks; i++) {
    runtime.think(i + 1);
  }
  return { dispatches, returns, settles, log };
}

/** The instruction dispatching the bytecode action synchronously with one argument. */
const syncDispatch: Instr[] = [{ op: Op.ACTION_CALL, a: ACTION_SLOT, b: 1, c: CALL_SITE_ID }];

/** The instructions dispatching the bytecode action asynchronously and awaiting its handle. */
const asyncDispatch: Instr[] = [{ op: Op.ACTION_CALL_ASYNC, a: ACTION_SLOT, b: 1, c: CALL_SITE_ID }, { op: Op.AWAIT }];

/** An action body returning {@link SYNC_RESULT}. */
const returningBody: Instr[] = [{ op: Op.PUSH_CONST_NUM, a: 1 }, { op: Op.RET }];

/** An action body that overwrites its parameter slot before returning. */
const mutatingBody: Instr[] = [
  { op: Op.PUSH_CONST_NUM, a: 2 },
  { op: Op.STORE_LOCAL, a: 0 },
  { op: Op.PUSH_CONST_NUM, a: 1 },
  { op: Op.RET },
];

/** An action body that throws a value no handler catches. */
const faultingBody: Instr[] = [{ op: Op.PUSH_CONST_VAL, a: 1 }, { op: Op.THROW }];

describe("bytecode action observation -- a synchronous call", () => {
  test("reports the dispatch with the action's descriptor, arguments, and rule", () => {
    const { dispatches } = observe(syncDispatch, returningBody, false, 7, 1);

    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0]?.key, SYNC_ACTION_KEY);
    assert.deepEqual(dispatches[0]?.args, [mkNumberValue(7)]);
    assert.equal(dispatches[0]?.ruleFuncId, RULE_FUNC_ID);
    assert.equal(dispatches[0]?.handleId, undefined);
  });

  test("reports the return with the action slot, its call site, and the value the body produced", () => {
    const { returns } = observe(syncDispatch, returningBody, false, 7, 1);

    assert.equal(returns.length, 1);
    assert.equal(returns[0]?.binding, "bytecode");
    assert.equal(returns[0]?.actionId, ACTION_SLOT);
    assert.equal(returns[0]?.callSiteId, CALL_SITE_ID);
    assert.deepEqual(returns[0]?.args, [mkNumberValue(7)]);
    assert.deepEqual(returns[0]?.result, mkNumberValue(SYNC_RESULT));
  });

  test("reports the return after the dispatch", () => {
    const { log } = observe(syncDispatch, returningBody, false, 7, 1);

    assert.deepEqual(log, ["dispatch", "return"]);
  });

  test("reports the parameter slots as the body left them", () => {
    const { dispatches, returns } = observe(syncDispatch, mutatingBody, false, 7, 1);

    assert.deepEqual(dispatches[0]?.args, [mkNumberValue(7)]);
    assert.deepEqual(returns[0]?.args, [mkNumberValue(REWRITTEN_ARG)]);
  });
});

describe("bytecode action observation -- an asynchronous call", () => {
  test("reports the dispatch with a handle the settle joins", () => {
    const { dispatches, settles } = observe(asyncDispatch, returningBody, true, 9, 2);

    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0]?.key, ASYNC_ACTION_KEY);
    assert.notEqual(dispatches[0]?.handleId, undefined);
    assert.equal(settles.length, 1);
    assert.equal(settles[0]?.handleId, dispatches[0]?.handleId);
    assert.equal(settles[0]?.outcome, HandleOutcome.RESOLVED);
    assert.equal(settles[0]?.actionKey, ASYNC_ACTION_KEY);
  });

  test("reports the return with no value, at the dispatch", () => {
    const { returns, log } = observe(asyncDispatch, returningBody, true, 9, 2);

    assert.equal(returns.length, 1);
    assert.equal(returns[0]?.binding, "bytecode");
    assert.equal(returns[0]?.actionId, ACTION_SLOT);
    assert.equal(returns[0]?.callSiteId, CALL_SITE_ID);
    assert.deepEqual(returns[0]?.args, [mkNumberValue(9)]);
    assert.equal(returns[0]?.result, undefined);
    assert.deepEqual(log.slice(0, 2), ["dispatch", "return"]);
  });
});

describe("bytecode action observation -- a call whose body faults", () => {
  test("reports the dispatch and nothing more", () => {
    const { dispatches, returns } = observe(syncDispatch, faultingBody, false, 7, 1);

    assert.equal(dispatches.length, 1);
    assert.equal(returns.length, 0);
  });
});
