/**
 * The `rule_when_evaluated` brain event and the `onRuleWhenGate` VM hook that
 * feeds it: one report per rule per think, carrying the rule's funcId, the value
 * its WHEN section produced, and whether the gate passed.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { List, UniqueSet } from "@wendoo/core";
import {
  BrainRuntime,
  BYTECODE_VERSION,
  FALSE_VALUE,
  type FunctionBytecode,
  type Instr,
  mkNumberValue,
  NIL_VALUE,
  Op,
  type PageMetadata,
  type PlatformServices,
  type Program,
  type RuleWhenGateEvent,
  TRUE_VALUE,
  type Value,
} from "@wendoo/core/runtime";
import { __test__createPlatformServices } from "@wendoo/core/runtime/__test__";

/** funcId of the single rule function every fixture below runs. */
const RULE_FUNC_ID = 0;

function mkFunc(code: Instr[]): FunctionBytecode {
  return { code: List.from(code), numParams: 0 };
}

/** A one-function program whose only function is registered as a rule entry. */
function mkRuleProgram(code: Instr[], constants: Value[]): Program {
  const ruleFuncIds = new UniqueSet<number>();
  ruleFuncIds.add(RULE_FUNC_ID);
  return {
    version: BYTECODE_VERSION,
    functions: List.from([mkFunc(code)]),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.from(constants),
    },
    variableNames: List.empty<string>(),
    entryPoint: RULE_FUNC_ID,
    ruleFuncIds,
  };
}

/**
 * A WHEN section pushing constant `whenConstIdx` and gating on it with `gate`,
 * followed by an empty DO. Both paths return the NIL at `nilConstIdx`.
 */
function mkGatedRule(gate: Op.WHEN_END | Op.WHEN_END_PRESENT, whenConstIdx: number, nilConstIdx: number): Instr[] {
  return [
    { op: Op.WHEN_START },
    { op: Op.PUSH_CONST_VAL, a: whenConstIdx },
    { op: gate, a: 4 },
    { op: Op.DO_START },
    { op: Op.DO_END },
    { op: Op.JMP, a: 1 },
    { op: Op.PUSH_CONST_VAL, a: nilConstIdx },
    { op: Op.RET },
  ];
}

/** A rule body with no WHEN section at all: a bare DO that returns nil. */
function mkUngatedRule(nilConstIdx: number): Instr[] {
  return [{ op: Op.DO_START }, { op: Op.DO_END }, { op: Op.PUSH_CONST_VAL, a: nilConstIdx }, { op: Op.RET }];
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

/** Gate reports collected from the brain event channel and from a caller-supplied VM hook. */
interface Observed {
  fromBrainEvent: RuleWhenGateEvent[];
  fromVmHook: RuleWhenGateEvent[];
}

/** Build a runtime over `program`, run `thinks` thinks, and collect every gate report. */
function observe(program: Program, thinks = 1): Observed {
  const fromVmHook: RuleWhenGateEvent[] = [];
  const runtime = new BrainRuntime(program, List.from([makePage()]), makeHostServices(), undefined, undefined, {
    onRuleWhenGate: (payload) => {
      fromVmHook.push(payload);
    },
  });

  const fromBrainEvent: RuleWhenGateEvent[] = [];
  runtime.events().on("rule_when_evaluated", (payload) => {
    fromBrainEvent.push(payload);
  });

  runtime.startup();
  for (let i = 0; i < thinks; i++) {
    runtime.think(i + 1);
  }
  return { fromBrainEvent, fromVmHook };
}

describe("rule WHEN gate observation -- the truthiness gate", () => {
  test("a truthy WHEN reports a fire carrying the value the section produced", () => {
    const observed = observe(mkRuleProgram(mkGatedRule(Op.WHEN_END, 0, 1), [TRUE_VALUE, NIL_VALUE]));

    assert.equal(observed.fromBrainEvent.length, 1);
    const gate = observed.fromBrainEvent[0]!;
    assert.equal(gate.ruleFuncId, RULE_FUNC_ID);
    assert.equal(gate.fired, true);
    assert.deepEqual(gate.result, TRUE_VALUE);
  });

  test("a falsy WHEN reports a gate that did not pass", () => {
    const observed = observe(mkRuleProgram(mkGatedRule(Op.WHEN_END, 0, 1), [FALSE_VALUE, NIL_VALUE]));

    assert.equal(observed.fromBrainEvent.length, 1);
    assert.equal(observed.fromBrainEvent[0]?.fired, false);
    assert.deepEqual(observed.fromBrainEvent[0]?.result, FALSE_VALUE);
  });
});

describe("rule WHEN gate observation -- the presence gate", () => {
  test("an absent WHEN value reports a gate that did not pass", () => {
    const observed = observe(mkRuleProgram(mkGatedRule(Op.WHEN_END_PRESENT, 0, 0), [NIL_VALUE]));

    assert.equal(observed.fromBrainEvent.length, 1);
    assert.equal(observed.fromBrainEvent[0]?.fired, false);
  });

  test("a present but falsy WHEN value reports a fire", () => {
    const observed = observe(mkRuleProgram(mkGatedRule(Op.WHEN_END_PRESENT, 0, 1), [mkNumberValue(0), NIL_VALUE]));

    assert.equal(observed.fromBrainEvent.length, 1);
    assert.equal(observed.fromBrainEvent[0]?.fired, true);
    assert.deepEqual(observed.fromBrainEvent[0]?.result, mkNumberValue(0));
  });
});

describe("rule WHEN gate observation -- reporting cadence", () => {
  test("each think reports the gate again", () => {
    const observed = observe(mkRuleProgram(mkGatedRule(Op.WHEN_END, 0, 1), [TRUE_VALUE, NIL_VALUE]), 3);

    assert.equal(observed.fromBrainEvent.length, 3);
  });

  test("a rule with no WHEN section reports no gate", () => {
    const observed = observe(mkRuleProgram(mkUngatedRule(0), [NIL_VALUE]), 3);

    assert.equal(observed.fromBrainEvent.length, 0);
  });

  test("a caller-supplied VM hook receives every gate the brain event does", () => {
    const observed = observe(mkRuleProgram(mkGatedRule(Op.WHEN_END, 0, 1), [TRUE_VALUE, NIL_VALUE]), 2);

    assert.equal(observed.fromVmHook.length, 2);
    assert.deepEqual(observed.fromVmHook, observed.fromBrainEvent);
  });
});
