/**
 * The chain-gate WHEN boundaries, `WHEN_END_CHAIN` and `WHEN_END_PRESENT_CHAIN`:
 * the WHEN value each fires on, the `__whenResult` it captures, the DO-section
 * skip it takes, and the firing record it writes.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Dict, List, UniqueSet } from "@wendoo/core";
import {
  BYTECODE_VERSION,
  createProgramServices,
  createRuleFiringServices,
  createRuleVariableServices,
  type ExecutionContext,
  FALSE_VALUE,
  type FunctionBytecode,
  type Instr,
  mkNumberValue,
  mkStringValue,
  NIL_VALUE,
  Op,
  type PageMetadata,
  type Program,
  RuleFiringState,
  type RuleFiringStates,
  type RuleVariableStores,
  TRUE_VALUE,
  type Value,
  VM,
  VmStatus,
} from "@wendoo/core/runtime";
import { __test__createPlatformServices } from "@wendoo/core/runtime/__test__";

/** The rule whose gate every fixture below exercises. */
const GATED_FUNC_ID = 1;

/** The rule directly above {@link GATED_FUNC_ID} at its own level: its subject. */
const SUBJECT_FUNC_ID = 0;

/** Constant-pool index of the value the gated rule's WHEN section pushes. */
const WHEN_CONST = 0;

/** Constant-pool indices of the markers the fired and skipped paths return. */
const FIRED_CONST = 1;
const SKIPPED_CONST = 2;

/** The gates that fire on a truthy WHEN result, and the gates that fire on a present one. */
const TRUTHINESS_GATES = [Op.WHEN_END, Op.WHEN_END_CHAIN] as const;
const PRESENCE_GATES = [Op.WHEN_END_PRESENT, Op.WHEN_END_PRESENT_CHAIN] as const;

/** A gate opcode under test. */
type GateOp = (typeof TRUTHINESS_GATES)[number] | (typeof PRESENCE_GATES)[number];

function mkFunc(code: Instr[]): FunctionBytecode {
  return { code: List.from(code), numParams: 0 };
}

/**
 * The gated rule's body: a WHEN section pushing the constant at
 * {@link WHEN_CONST}, `gate`, an empty DO, and two exits that name the path
 * taken -- the fired marker after the DO section, the skipped marker at the
 * gate's jump target.
 */
function mkGatedRule(gate: GateOp): Instr[] {
  return [
    { op: Op.WHEN_START }, // 0
    { op: Op.PUSH_CONST_VAL, a: WHEN_CONST }, // 1
    { op: gate, a: 4 }, // 2: not fired -> pc 6
    { op: Op.DO_START }, // 3
    { op: Op.DO_END }, // 4
    { op: Op.JMP, a: 3 }, // 5: fired -> pc 8
    { op: Op.PUSH_CONST_VAL, a: SKIPPED_CONST }, // 6
    { op: Op.RET }, // 7
    { op: Op.PUSH_CONST_VAL, a: FIRED_CONST }, // 8
    { op: Op.RET }, // 9
  ];
}

/**
 * A two-rule, one-page program: the subject at {@link SUBJECT_FUNC_ID} (never
 * run; it exists so the gated rule has a preceding sibling) and the gated rule
 * at {@link GATED_FUNC_ID}.
 *
 * @param withSubject - When false, the gated rule is the page's only root rule
 *   and therefore has no subject.
 */
function mkProgram(
  gate: GateOp,
  whenValue: Value,
  withSubject = true
): { program: Program; pages: List<PageMetadata> } {
  const ruleFuncIds = new UniqueSet<number>();
  ruleFuncIds.add(SUBJECT_FUNC_ID);
  ruleFuncIds.add(GATED_FUNC_ID);
  const program: Program = {
    version: BYTECODE_VERSION,
    functions: List.from([
      mkFunc([{ op: Op.PUSH_CONST_VAL, a: SKIPPED_CONST }, { op: Op.RET }]),
      mkFunc(mkGatedRule(gate)),
    ]),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.from([whenValue, TRUE_VALUE, FALSE_VALUE]),
    },
    variableNames: List.empty<string>(),
    entryPoint: GATED_FUNC_ID,
    ruleFuncIds,
  };
  const rootRuleFuncIds = withSubject ? List.from([SUBJECT_FUNC_ID, GATED_FUNC_ID]) : List.from([GATED_FUNC_ID]);
  const pages = List.from<PageMetadata>([
    {
      pageIndex: 0,
      pageId: "page-0",
      pageName: "page",
      rootRuleFuncIds,
      actionCallSites: List.empty(),
    },
  ]);
  return { program, pages };
}

/** What one gate run recorded, returned, and captured. */
interface GateRun {
  status: VmStatus;
  /** The gated rule's firing record after the run. */
  record: RuleFiringState;
  /** `TRUE_VALUE` when the DO section ran, `FALSE_VALUE` when the gate skipped it. */
  path: Value | undefined;
  /** The `__whenResult` the gate captured for the gated rule. */
  captured: Value;
}

/**
 * Runs the gated rule once.
 *
 * @param subjectState - Record seeded for the subject before the run; omitted
 *   leaves the subject at the store's initial value.
 */
function runGate(gate: GateOp, whenValue: Value, subjectState?: RuleFiringState, withSubject = true): GateRun {
  const { program, pages } = mkProgram(gate, whenValue, withSubject);
  const states: RuleFiringStates = new Dict();
  if (subjectState !== undefined) {
    states.set(SUBJECT_FUNC_ID, subjectState);
  }
  const ruleVariableStores: RuleVariableStores = new Dict();
  const ruleVars = createRuleVariableServices(program, ruleVariableStores);
  const services = __test__createPlatformServices({
    program: createProgramServices(program, pages),
    ruleFiring: createRuleFiringServices(states),
    ruleVars,
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
  const fiber = vm.spawnFiber(1, GATED_FUNC_ID, List.empty(), context);
  fiber.instrBudget = 100;
  const result = vm.runFiber(fiber, {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  });
  return {
    status: result.status,
    record: createRuleFiringServices(states).get(GATED_FUNC_ID),
    path: result.status === VmStatus.DONE ? result.result : undefined,
    captured: ruleVars.getByName(GATED_FUNC_ID, "__whenResult"),
  };
}

describe("chain gate -- opcode assignment", () => {
  test("the chain gates carry the numbers the VM contract records", () => {
    assert.equal(Op.WHEN_END_CHAIN, 172);
    assert.equal(Op.WHEN_END_PRESENT_CHAIN, 173);
  });
});

describe("chain gate -- the firing record it writes", () => {
  test("a rule that fires records DidFire whatever its subject recorded", () => {
    for (const subjectState of [RuleFiringState.DID_FIRE, RuleFiringState.DID_NOT_FIRE, RuleFiringState.EVALUATING]) {
      const truthiness = runGate(Op.WHEN_END_CHAIN, TRUE_VALUE, subjectState);
      assert.equal(truthiness.record, RuleFiringState.DID_FIRE, `truthiness gate, subject ${subjectState}`);
      assert.deepEqual(truthiness.path, TRUE_VALUE);

      const presence = runGate(Op.WHEN_END_PRESENT_CHAIN, mkNumberValue(7), subjectState);
      assert.equal(presence.record, RuleFiringState.DID_FIRE, `presence gate, subject ${subjectState}`);
      assert.deepEqual(presence.path, TRUE_VALUE);
    }
  });

  test("a rule that does not fire below a subject that did not fire records DidNotFire", () => {
    assert.equal(
      runGate(Op.WHEN_END_CHAIN, FALSE_VALUE, RuleFiringState.DID_NOT_FIRE).record,
      RuleFiringState.DID_NOT_FIRE
    );
    assert.equal(
      runGate(Op.WHEN_END_PRESENT_CHAIN, NIL_VALUE, RuleFiringState.DID_NOT_FIRE).record,
      RuleFiringState.DID_NOT_FIRE
    );
  });

  test("a rule that does not fire below a subject that fired records DidFire", () => {
    assert.equal(runGate(Op.WHEN_END_CHAIN, FALSE_VALUE, RuleFiringState.DID_FIRE).record, RuleFiringState.DID_FIRE);
    assert.equal(
      runGate(Op.WHEN_END_PRESENT_CHAIN, NIL_VALUE, RuleFiringState.DID_FIRE).record,
      RuleFiringState.DID_FIRE
    );
  });

  test("a rule that does not fire below a subject still evaluating records Evaluating", () => {
    assert.equal(
      runGate(Op.WHEN_END_CHAIN, FALSE_VALUE, RuleFiringState.EVALUATING).record,
      RuleFiringState.EVALUATING
    );
    assert.equal(
      runGate(Op.WHEN_END_PRESENT_CHAIN, NIL_VALUE, RuleFiringState.EVALUATING).record,
      RuleFiringState.EVALUATING
    );
  });

  test("a rule with no subject records its own outcome", () => {
    assert.equal(
      runGate(Op.WHEN_END_CHAIN, FALSE_VALUE, undefined, false).record,
      RuleFiringState.DID_NOT_FIRE,
      "a first rule at its level has no record to adopt"
    );
    assert.equal(runGate(Op.WHEN_END_CHAIN, TRUE_VALUE, undefined, false).record, RuleFiringState.DID_FIRE);
  });

  test("a base gate below the same subject records only its own outcome", () => {
    assert.equal(
      runGate(Op.WHEN_END, FALSE_VALUE, RuleFiringState.DID_FIRE).record,
      RuleFiringState.DID_NOT_FIRE,
      "the chain write belongs to the chain gates alone"
    );
    assert.equal(
      runGate(Op.WHEN_END_PRESENT, NIL_VALUE, RuleFiringState.DID_FIRE).record,
      RuleFiringState.DID_NOT_FIRE
    );
  });
});

describe("chain gate -- gate condition and capture", () => {
  test("the truthiness chain gate takes the same path as WHEN_END for every WHEN value", () => {
    const values: readonly Value[] = [
      TRUE_VALUE,
      FALSE_VALUE,
      NIL_VALUE,
      mkNumberValue(0),
      mkNumberValue(7),
      mkStringValue(""),
    ];
    for (const value of values) {
      const base = runGate(Op.WHEN_END, value, RuleFiringState.DID_NOT_FIRE);
      const chained = runGate(Op.WHEN_END_CHAIN, value, RuleFiringState.DID_NOT_FIRE);
      assert.equal(base.status, VmStatus.DONE);
      assert.deepEqual(chained.path, base.path, `path for ${value.t}`);
      assert.deepEqual(chained.captured, base.captured, `capture for ${value.t}`);
    }
  });

  test("the presence chain gate takes the same path as WHEN_END_PRESENT for every WHEN value", () => {
    const values: readonly Value[] = [
      TRUE_VALUE,
      FALSE_VALUE,
      NIL_VALUE,
      mkNumberValue(0),
      mkNumberValue(7),
      mkStringValue(""),
    ];
    for (const value of values) {
      const base = runGate(Op.WHEN_END_PRESENT, value, RuleFiringState.DID_NOT_FIRE);
      const chained = runGate(Op.WHEN_END_PRESENT_CHAIN, value, RuleFiringState.DID_NOT_FIRE);
      assert.equal(base.status, VmStatus.DONE);
      assert.deepEqual(chained.path, base.path, `path for ${value.t}`);
      assert.deepEqual(chained.captured, base.captured, `capture for ${value.t}`);
    }
  });

  test("a present but falsy WHEN value fires the presence chain gate and skips the truthiness one", () => {
    for (const value of [mkNumberValue(0), mkStringValue(""), FALSE_VALUE]) {
      assert.deepEqual(
        runGate(Op.WHEN_END_PRESENT_CHAIN, value, RuleFiringState.DID_NOT_FIRE).path,
        TRUE_VALUE,
        `a present ${value.t} runs the DO section`
      );
      assert.deepEqual(runGate(Op.WHEN_END_CHAIN, value, RuleFiringState.DID_NOT_FIRE).path, FALSE_VALUE);
    }
  });

  test("both chain gates capture the WHEN result they were handed", () => {
    const value = mkNumberValue(42);
    assert.deepEqual(runGate(Op.WHEN_END_CHAIN, value, RuleFiringState.DID_NOT_FIRE).captured, value);
    assert.deepEqual(runGate(Op.WHEN_END_PRESENT_CHAIN, value, RuleFiringState.DID_NOT_FIRE).captured, value);
  });
});
