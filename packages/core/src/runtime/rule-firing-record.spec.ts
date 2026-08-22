/**
 * The per-rule firing record the VM writes at the WHEN boundary opcodes.
 *
 * `WHEN_START` marks the rule EVALUATING; both gates -- the truthiness gate
 * (`WHEN_END`) and the presence gate (`WHEN_END_PRESENT`) -- store the outcome
 * they computed. A presence-gated rule fires on a present falsy value (`0`,
 * `""`, `false`), so the record and the truthiness of the WHEN value differ.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Dict, List, UniqueSet } from "@wendoo/core";
import type { BrainServices } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { compileBrain } from "@wendoo/core/brain/compiler";
import { BrainDef } from "@wendoo/core/brain/model";
import {
  BYTECODE_VERSION,
  createProgramServices,
  createRuleFiringServices,
  type ExecutionContext,
  FALSE_VALUE,
  type FunctionBytecode,
  type Instr,
  mkNumberValue,
  mkStringValue,
  NIL_VALUE,
  Op,
  type Program,
  RuleFiringState,
  type RuleFiringStates,
  TRUE_VALUE,
  type Value,
  VM,
  VmStatus,
} from "@wendoo/core/runtime";
import { __test__createPlatformServices } from "@wendoo/core/runtime/__test__";

/** The funcId of the single rule function every raw-bytecode fixture below runs. */
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
 * A WHEN section that pushes constant `whenConstIdx` and gates on it with `gate`
 * (`WHEN_END` or `WHEN_END_PRESENT`), followed by an empty DO. Both paths return
 * the NIL at `nilConstIdx`, so the fired / not-fired outcome shows up only in
 * the firing record.
 */
function mkGatedRule(gate: Op.WHEN_END | Op.WHEN_END_PRESENT, whenConstIdx: number, nilConstIdx: number): Instr[] {
  return [
    { op: Op.WHEN_START }, // 0
    { op: Op.PUSH_CONST_VAL, a: whenConstIdx }, // 1
    { op: gate, a: 4 }, // 2: not fired -> jump to pc 6
    { op: Op.DO_START }, // 3
    { op: Op.DO_END }, // 4
    { op: Op.JMP, a: 1 }, // 5
    { op: Op.PUSH_CONST_VAL, a: nilConstIdx }, // 6: end label
    { op: Op.RET }, // 7
  ];
}

interface RunHarness {
  states: RuleFiringStates;
  status: VmStatus;
}

/**
 * Runs `program`'s entry rule function under a fresh firing-record store.
 *
 * @param seed - Record to store for the rule before the run. Seeding a state the
 *   run must overwrite keeps the assertion from passing on an unwritten store.
 * @param budget - Instruction budget for the single slice.
 */
function runRule(program: Program, seed?: RuleFiringState, budget = 100): RunHarness {
  const states: RuleFiringStates = new Dict();
  if (seed !== undefined) {
    states.set(RULE_FUNC_ID, seed);
  }
  const services = __test__createPlatformServices({
    program: createProgramServices(program, List.empty()),
    ruleFiring: createRuleFiringServices(states),
  });
  const context: ExecutionContext = {
    services,
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
  };
  const vm = new VM(program, services.runtime);
  const fiber = vm.spawnFiber(1, RULE_FUNC_ID, List.empty(), context);
  fiber.instrBudget = budget;
  const result = vm.runFiber(fiber, {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  });
  return { states, status: result.status };
}

/** The rule's record after `runRule`, including the accessor's initial value when none was written. */
function recordedState(harness: RunHarness): RuleFiringState {
  return createRuleFiringServices(harness.states).get(RULE_FUNC_ID);
}

describe("rule firing record -- initial value", () => {
  test("a rule that has never written a record reads as fired", () => {
    const states: RuleFiringStates = new Dict();
    const firing = createRuleFiringServices(states);
    assert.equal(firing.get(RULE_FUNC_ID), RuleFiringState.DID_FIRE);
    assert.equal(firing.get(41), RuleFiringState.DID_FIRE);
  });

  test("a write with no rule in scope stores nothing", () => {
    const states: RuleFiringStates = new Dict();
    const firing = createRuleFiringServices(states);
    firing.set(undefined, RuleFiringState.DID_NOT_FIRE);
    assert.equal(states.size(), 0);
  });
});

describe("rule firing record -- the truthiness gate", () => {
  test("a truthy WHEN records that the rule fired", () => {
    const harness = runRule(
      mkRuleProgram(mkGatedRule(Op.WHEN_END, 0, 1), [TRUE_VALUE, NIL_VALUE]),
      RuleFiringState.DID_NOT_FIRE
    );
    assert.equal(harness.status, VmStatus.DONE);
    assert.equal(recordedState(harness), RuleFiringState.DID_FIRE);
  });

  test("a falsy WHEN records that the rule did not fire", () => {
    const harness = runRule(
      mkRuleProgram(mkGatedRule(Op.WHEN_END, 0, 1), [FALSE_VALUE, NIL_VALUE]),
      RuleFiringState.DID_FIRE
    );
    assert.equal(harness.status, VmStatus.DONE);
    assert.equal(recordedState(harness), RuleFiringState.DID_NOT_FIRE);
  });
});

describe("rule firing record -- the presence gate", () => {
  test("an absent (nil) WHEN value records that the rule did not fire", () => {
    const harness = runRule(
      mkRuleProgram(mkGatedRule(Op.WHEN_END_PRESENT, 0, 0), [NIL_VALUE]),
      RuleFiringState.DID_FIRE
    );
    assert.equal(harness.status, VmStatus.DONE);
    assert.equal(recordedState(harness), RuleFiringState.DID_NOT_FIRE);
  });

  test("a present WHEN value records that the rule fired", () => {
    const harness = runRule(
      mkRuleProgram(mkGatedRule(Op.WHEN_END_PRESENT, 0, 1), [mkNumberValue(7), NIL_VALUE]),
      RuleFiringState.DID_NOT_FIRE
    );
    assert.equal(harness.status, VmStatus.DONE);
    assert.equal(recordedState(harness), RuleFiringState.DID_FIRE);
  });

  test("a present but falsy WHEN value records that the rule fired", () => {
    const falsyButPresent: readonly Value[] = [mkNumberValue(0), mkStringValue(""), FALSE_VALUE];
    for (const value of falsyButPresent) {
      const harness = runRule(
        mkRuleProgram(mkGatedRule(Op.WHEN_END_PRESENT, 0, 1), [value, NIL_VALUE]),
        RuleFiringState.DID_NOT_FIRE
      );
      assert.equal(harness.status, VmStatus.DONE);
      assert.equal(
        recordedState(harness),
        RuleFiringState.DID_FIRE,
        `a present ${value.t} must record a fire, whatever its truthiness`
      );
    }
  });
});

describe("rule firing record -- an incomplete WHEN evaluation", () => {
  test("a WHEN cut short by budget exhaustion leaves the rule evaluating", () => {
    // WHEN_START then a long push/pop run; a budget of 3 stops the fiber inside
    // the WHEN section, before either gate runs.
    const code: Instr[] = [{ op: Op.WHEN_START }];
    for (let i = 0; i < 10; i++) {
      code.push({ op: Op.PUSH_CONST_VAL, a: 0 });
      code.push({ op: Op.POP });
    }
    code.push({ op: Op.PUSH_CONST_VAL, a: 0 });
    code.push({ op: Op.WHEN_END, a: 3 });
    code.push({ op: Op.DO_START });
    code.push({ op: Op.DO_END });
    code.push({ op: Op.PUSH_CONST_VAL, a: 1 });
    code.push({ op: Op.RET });

    const harness = runRule(mkRuleProgram(code, [TRUE_VALUE, NIL_VALUE]), RuleFiringState.DID_FIRE, 3);
    assert.equal(harness.status, VmStatus.YIELDED, "the budget must run out inside the WHEN section");
    assert.equal(recordedState(harness), RuleFiringState.EVALUATING);
  });
});

describe("rule firing record -- a rule with no WHEN condition", () => {
  test("an empty WHEN emits no boundary opcodes and leaves the record at its initial value", () => {
    const services: BrainServices = __test__createBrainServices();
    const brainDef = BrainDef.emptyBrainDef(services);
    const compiled = compileBrain(
      brainDef,
      List.from([services.edit.tiles, brainDef.catalog()]),
      services.shared.conversions,
      services.runtime.actions,
      services.runtime.types
    );
    assert.ok(compiled.program, "an empty brain must compile");
    const program = compiled.program;
    const ruleFuncId = program.pages.get(0)!.rootRuleFuncIds.get(0)!;
    assert.equal(ruleFuncId, RULE_FUNC_ID, "the first rule of the first page is funcId 0");

    const code = program.functions.get(ruleFuncId)!.code;
    for (const boundary of [Op.WHEN_START, Op.WHEN_END, Op.WHEN_END_PRESENT]) {
      assert.equal(
        code.findIndex((ins) => ins.op === boundary),
        -1,
        "a rule with no WHEN condition emits no WHEN boundary opcode"
      );
    }

    const harness = runRule(program);
    assert.equal(harness.status, VmStatus.DONE);
    assert.equal(harness.states.size(), 0, "the rule writes no record at all");
    assert.equal(recordedState(harness), RuleFiringState.DID_FIRE);
  });
});
