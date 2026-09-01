/**
 * Pins how a rule's trigger mode lowers to bytecode. Asserts exact opcode
 * sequences for a `when` rule, an `otherwise` rule (arming read plus a chain
 * gate), and a `then` rule (asynchronous trigger dispatch plus `AWAIT`, then
 * the ordinary gate), and the positional diagnostic code each mode reports.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { createHostActuator, createHostSensor, List, type ReadonlyList } from "@wendoo/core";
import type { BrainServices } from "@wendoo/core/brain";
import {
  CoreCapabilityBits,
  type IBrainTileDef,
  type ITileCatalog,
  RuleTriggerMode,
  TilePlacement,
} from "@wendoo/core/brain";
import { __test__appendTile, __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { compileBrain, ParseDiagCode } from "@wendoo/core/brain/compiler";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import {
  type BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileOperatorDef,
  BrainTileSensorDef,
} from "@wendoo/core/brain/tiles";
import {
  CoreHostActions,
  CoreOpId,
  CoreTypeIds,
  type ExecutionContext,
  type Instr,
  mkCallDef,
  Op,
  TRUE_VALUE,
  type UnlinkedBrainProgram,
  type Value,
  VOID_VALUE,
} from "@wendoo/core/runtime";
import { BitSet } from "@wendoo/core/util";

let services: BrainServices;
let opAnd: BrainTileOperatorDef;

/** Distinguishes the host ids each test registers; ids must be unique per registry. */
let hostIdCounter = 0;

before(() => {
  services = __test__createBrainServices();
  opAnd = new BrainTileOperatorDef(CoreOpId.And, {}, services);
});

/** Registers one host definition's function and action on the test services. */
function registerHost(
  fn: { id: number; name: string; isAsync: boolean; fn: unknown; callDef: unknown },
  descriptor: Parameters<typeof services.runtime.actions.register>[0]["descriptor"],
  actionId: number,
  actionFn: unknown
): void {
  services.runtime.functions.register(fn.id, fn.name, fn.isAsync, fn.fn as never, fn.callDef as never);
  services.runtime.actions.register({
    binding: "host",
    descriptor,
    id: actionId,
    execSync: (actionFn as { exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => Value }).exec,
  });
}

/** Registers a no-argument DO-side actuator tile. */
function makeActuator(): BrainTileActuatorDef {
  hostIdCounter += 1;
  const def = createHostActuator({
    key: `trigger-emit-actuator-${hostIdCounter}`,
    actionId: 7700 + hostIdCounter,
    fnId: 8700 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    fn: { exec: () => VOID_VALUE },
  });
  registerHost(def.function, def.descriptor, def.actionId, def.actionFn);
  return def.tile as BrainTileActuatorDef;
}

/** Registers an inline WHEN-side boolean sensor tile. */
function makeSensor(): BrainTileSensorDef {
  hostIdCounter += 1;
  const def = createHostSensor({
    key: `trigger-emit-sensor-${hostIdCounter}`,
    actionId: 7700 + hostIdCounter,
    fnId: 8700 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    outputType: CoreTypeIds.Boolean,
    fn: { exec: () => TRUE_VALUE },
  });
  registerHost(def.function, def.descriptor, def.actionId, def.actionFn);
  const tile = new BrainTileSensorDef(def.descriptor.key, def.descriptor, {
    placement: TilePlacement.WhenSide | TilePlacement.Inline,
  });
  services.edit.tiles.registerTileDef(tile);
  return tile;
}

/** Registers an inline WHEN-side sensor tile declaring the presence-gated capability. */
function makePresenceGatedSensor(): BrainTileSensorDef {
  hostIdCounter += 1;
  const def = createHostSensor({
    key: `trigger-emit-presence-${hostIdCounter}`,
    actionId: 7700 + hostIdCounter,
    fnId: 8700 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    outputType: CoreTypeIds.Number,
    fn: { exec: () => TRUE_VALUE },
    capabilities: new BitSet().set(CoreCapabilityBits.PresenceGated),
  });
  registerHost(def.function, def.descriptor, def.actionId, def.actionFn);
  const tile = new BrainTileSensorDef(def.descriptor.key, def.descriptor, {
    placement: TilePlacement.WhenSide | TilePlacement.Inline,
    capabilities: new BitSet().set(CoreCapabilityBits.PresenceGated),
  });
  services.edit.tiles.registerTileDef(tile);
  return tile;
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

/** Every catalog the compiler needs for `brainDef`. */
function catalogsFor(brainDef: BrainDef): List<ITileCatalog> {
  return List.from([services.edit.tiles, brainDef.catalog()]);
}

/** Compiles `brainDef`, asserting it produced a program. */
function compile(brainDef: BrainDef): UnlinkedBrainProgram {
  const result = compileBrain(
    brainDef,
    catalogsFor(brainDef),
    services.shared.conversions,
    services.runtime.actions,
    services.runtime.types
  );
  assert.ok(result.program, "the brain must compile");
  return result.program;
}

/** The diagnostic codes `brainDef` compiles with. */
function compileDiagCodes(brainDef: BrainDef): number[] {
  const result = compileBrain(
    brainDef,
    catalogsFor(brainDef),
    services.shared.conversions,
    services.runtime.actions,
    services.runtime.types
  );
  const codes: number[] = [];
  for (let i = 0; i < result.diagnostics.size(); i++) {
    codes.push(result.diagnostics.get(i)!.code);
  }
  return codes;
}

/** The opcodes of `funcId`'s compiled body, in emission order. */
function opsOf(program: UnlinkedBrainProgram, funcId: number): Op[] {
  const code = program.functions.get(funcId)!.code;
  const ops: Op[] = [];
  for (let i = 0; i < code.size(); i++) ops.push(code.get(i)!.op);
  return ops;
}

/** The instruction at `funcId`'s first occurrence of `op`, or undefined when there is none. */
function firstInstr(program: UnlinkedBrainProgram, funcId: number, op: Op): Instr | undefined {
  const code = program.functions.get(funcId)!.code;
  for (let i = 0; i < code.size(); i++) {
    if (code.get(i)!.op === op) return code.get(i)!;
  }
  return undefined;
}

/** Every opcode appearing anywhere in `program`. */
function allOps(program: UnlinkedBrainProgram): Op[] {
  const ops: Op[] = [];
  for (let f = 0; f < program.functions.size(); f++) {
    for (const op of opsOf(program, f)) ops.push(op);
  }
  return ops;
}

/** Gives the rule at `index` on the page `mode`, appending rules until it exists. */
function ruleAt(page: BrainPageDef, index: number): BrainRuleDef {
  while (page.children().size() <= index) page.appendNewRule();
  return page.children().get(index)! as BrainRuleDef;
}

describe("when-mode emission is unchanged", () => {
  test("a when rule with an expression emits WHEN_START, the expression, and the truthiness gate", () => {
    const { brainDef, page } = newBrain();
    fillRule(ruleAt(page, 0), [makeSensor()], [makeActuator()]);

    const program = compile(brainDef);

    assert.deepEqual(opsOf(program, 0), [
      Op.WHEN_START,
      Op.HOST_ACTION_CALL,
      Op.WHEN_END,
      Op.DO_START,
      Op.HOST_ACTION_CALL,
      Op.DO_END,
      Op.PUSH_CONST_VAL,
      Op.RET,
    ]);
  });

  test("a when rule with an empty WHEN emits no WHEN boundary at all", () => {
    const { brainDef, page } = newBrain();
    fillRule(ruleAt(page, 0), [], [makeActuator()]);

    const program = compile(brainDef);

    assert.deepEqual(opsOf(program, 0), [Op.DO_START, Op.HOST_ACTION_CALL, Op.DO_END, Op.PUSH_CONST_VAL, Op.RET]);
  });

  test("a when rule whose WHEN root is a bare presence-gated sensor takes the presence gate", () => {
    const { brainDef, page } = newBrain();
    fillRule(ruleAt(page, 0), [makePresenceGatedSensor()], [makeActuator()]);

    assert.deepEqual(opsOf(compile(brainDef), 0), [
      Op.WHEN_START,
      Op.HOST_ACTION_CALL,
      Op.WHEN_END_PRESENT,
      Op.DO_START,
      Op.HOST_ACTION_CALL,
      Op.DO_END,
      Op.PUSH_CONST_VAL,
      Op.RET,
    ]);
  });

  test("an all-when brain emits no trigger prologue and no chain gate anywhere", () => {
    const { brainDef, page } = newBrain();
    fillRule(ruleAt(page, 0), [makeSensor()], [makeActuator()]);
    fillRule(ruleAt(page, 1), [], [makeActuator()]);
    fillRule(ruleAt(page, 2), [makePresenceGatedSensor()], []);
    fillRule(ruleAt(page, 2).appendNewRule(), [makeSensor(), opAnd, boolLiteral(true)], [makeActuator()]);

    const program = compile(brainDef);
    const ops = allOps(program);

    assert.ok(!ops.includes(Op.WHEN_END_CHAIN), "no chain gate is emitted");
    assert.ok(!ops.includes(Op.WHEN_END_PRESENT_CHAIN), "no presence chain gate is emitted");
    assert.ok(!ops.includes(Op.HOST_ACTION_CALL_ASYNC), "no asynchronous trigger dispatch is emitted");
    assert.ok(!ops.includes(Op.AWAIT), "no trigger await is emitted");
    for (let f = 0; f < program.functions.size(); f++) {
      const code = program.functions.get(f)!.code;
      for (let i = 0; i < code.size(); i++) {
        const ins = code.get(i)!;
        if (ins.op !== Op.HOST_ACTION_CALL) continue;
        assert.notEqual(ins.a, CoreHostActions.Otherwise.actionId, "no otherwise arming read is emitted");
      }
    }
  });
});

describe("otherwise-mode emission", () => {
  test("an empty expression emits the arming read alone plus the chain gate", () => {
    const { brainDef, page } = newBrain();
    fillRule(ruleAt(page, 0), [makeSensor()], []);
    const rule = ruleAt(page, 1);
    rule.setTrigger(RuleTriggerMode.Otherwise);
    fillRule(rule, [], [makeActuator()]);

    const program = compile(brainDef);

    assert.deepEqual(opsOf(program, 1), [
      Op.WHEN_START,
      Op.HOST_ACTION_CALL,
      Op.WHEN_END_CHAIN,
      Op.DO_START,
      Op.HOST_ACTION_CALL,
      Op.DO_END,
      Op.PUSH_CONST_VAL,
      Op.RET,
    ]);
    assert.equal(firstInstr(program, 1, Op.HOST_ACTION_CALL)!.a, CoreHostActions.Otherwise.actionId);
    assert.equal(firstInstr(program, 1, Op.HOST_ACTION_CALL)!.b, 0, "the arming read takes no arguments");
  });

  test("a non-empty expression short-circuits behind the arming read", () => {
    const { brainDef, page } = newBrain();
    fillRule(ruleAt(page, 0), [makeSensor()], []);
    const rule = ruleAt(page, 1);
    rule.setTrigger(RuleTriggerMode.Otherwise);
    fillRule(rule, [makeSensor()], [makeActuator()]);

    const program = compile(brainDef);

    assert.deepEqual(opsOf(program, 1), [
      Op.WHEN_START,
      Op.HOST_ACTION_CALL,
      Op.JMP_IF_FALSE,
      Op.HOST_ACTION_CALL,
      Op.JMP,
      Op.PUSH_CONST_VAL,
      Op.WHEN_END_CHAIN,
      Op.DO_START,
      Op.HOST_ACTION_CALL,
      Op.DO_END,
      Op.PUSH_CONST_VAL,
      Op.RET,
    ]);
  });

  test("a bare presence-gated expression takes the presence chain gate", () => {
    const { brainDef, page } = newBrain();
    fillRule(ruleAt(page, 0), [makeSensor()], []);
    const rule = ruleAt(page, 1);
    rule.setTrigger(RuleTriggerMode.Otherwise);
    fillRule(rule, [makePresenceGatedSensor()], [makeActuator()]);

    const ops = opsOf(compile(brainDef), 1);

    assert.ok(ops.includes(Op.WHEN_END_PRESENT_CHAIN));
    assert.ok(!ops.includes(Op.WHEN_END_CHAIN));
  });
});

describe("then-mode emission", () => {
  test("an empty expression emits the trigger dispatch, its AWAIT, and the ordinary gate", () => {
    const { brainDef, page } = newBrain();
    fillRule(ruleAt(page, 0), [makeSensor()], []);
    const rule = ruleAt(page, 1);
    rule.setTrigger(RuleTriggerMode.Then);
    fillRule(rule, [], [makeActuator()]);

    const program = compile(brainDef);

    assert.deepEqual(opsOf(program, 1), [
      Op.WHEN_START,
      Op.HOST_ACTION_CALL_ASYNC,
      Op.AWAIT,
      Op.WHEN_END,
      Op.DO_START,
      Op.HOST_ACTION_CALL,
      Op.DO_END,
      Op.PUSH_CONST_VAL,
      Op.RET,
    ]);
    const dispatch = firstInstr(program, 1, Op.HOST_ACTION_CALL_ASYNC)!;
    assert.equal(dispatch.a, CoreHostActions.RuleTrigger.actionId);
    assert.equal(dispatch.b, 0, "the trigger takes no arguments");
  });

  test("a non-empty expression sits behind a conditional jump so a false trigger skips it", () => {
    const { brainDef, page } = newBrain();
    fillRule(ruleAt(page, 0), [makeSensor()], []);
    const rule = ruleAt(page, 1);
    rule.setTrigger(RuleTriggerMode.Then);
    fillRule(rule, [makeSensor()], [makeActuator()]);

    const program = compile(brainDef);

    assert.deepEqual(opsOf(program, 1), [
      Op.WHEN_START,
      Op.HOST_ACTION_CALL_ASYNC,
      Op.AWAIT,
      Op.JMP_IF_FALSE,
      Op.HOST_ACTION_CALL,
      Op.JMP,
      Op.PUSH_CONST_VAL,
      Op.WHEN_END,
      Op.DO_START,
      Op.HOST_ACTION_CALL,
      Op.DO_END,
      Op.PUSH_CONST_VAL,
      Op.RET,
    ]);
  });

  test("the trigger's dispatch call site is recorded in the page's action call sites", () => {
    const { brainDef, page } = newBrain();
    fillRule(ruleAt(page, 0), [makeSensor()], []);
    const rule = ruleAt(page, 1);
    rule.setTrigger(RuleTriggerMode.Then);
    fillRule(rule, [], [makeActuator()]);

    const program = compile(brainDef);
    const callSites = program.pages.get(0)!.actionCallSites;
    let found = false;
    for (let i = 0; i < callSites.size(); i++) {
      const entry = callSites.get(i)!;
      if (entry.binding === "host" && entry.actionId === CoreHostActions.RuleTrigger.actionId) found = true;
    }
    assert.ok(found, "the trigger dispatch is a host action call site like any other");
  });
});

describe("trigger-mode diagnostics", () => {
  test("otherwise mode on the first rule at its level is rejected", () => {
    const { brainDef, page } = newBrain();
    const rule = ruleAt(page, 0);
    rule.setTrigger(RuleTriggerMode.Otherwise);
    fillRule(rule, [], [makeActuator()]);

    assert.deepEqual(compileDiagCodes(brainDef), [ParseDiagCode.OtherwiseTriggerNoPrecedingSiblingRule]);
  });

  test("then mode on the first rule at its level is rejected", () => {
    const { brainDef, page } = newBrain();
    const rule = ruleAt(page, 0);
    rule.setTrigger(RuleTriggerMode.Then);
    fillRule(rule, [], [makeActuator()]);

    assert.deepEqual(compileDiagCodes(brainDef), [ParseDiagCode.ThenTriggerNoPrecedingSiblingRule]);
  });

  test("otherwise mode on the first child rule at its level is rejected", () => {
    const { brainDef, page } = newBrain();
    const root = ruleAt(page, 0);
    fillRule(root, [makeSensor()], []);
    const child = root.appendNewRule();
    child.setTrigger(RuleTriggerMode.Otherwise);
    fillRule(child, [], [makeActuator()]);

    assert.deepEqual(compileDiagCodes(brainDef), [ParseDiagCode.OtherwiseTriggerNoPrecedingSiblingRule]);
  });

  test("then mode on a rule with a preceding sibling compiles clean", () => {
    const { brainDef, page } = newBrain();
    fillRule(ruleAt(page, 0), [makeSensor()], []);
    const rule = ruleAt(page, 1);
    rule.setTrigger(RuleTriggerMode.Then);
    fillRule(rule, [], [makeActuator()]);

    assert.deepEqual(compileDiagCodes(brainDef), []);
  });

  test("otherwise mode on a rule with a preceding sibling compiles clean", () => {
    const { brainDef, page } = newBrain();
    fillRule(ruleAt(page, 0), [makeSensor()], []);
    const rule = ruleAt(page, 1);
    rule.setTrigger(RuleTriggerMode.Otherwise);
    fillRule(rule, [makeSensor()], [makeActuator()]);

    assert.deepEqual(compileDiagCodes(brainDef), []);
  });
});
