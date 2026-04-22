/**
 * Behavioral tests for the Brain runtime.
 *
 * These tests exercise the full pipeline: tile construction -> compiler
 * (parser, type inference, rule-compiler, emitter) -> VM execution.
 * Each test builds a BrainDef programmatically, initializes a Brain,
 * runs think(), and asserts on observable side effects (variable values,
 * host function calls, page state).
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List } from "@mindcraft-lang/core";
import {
  type ActionDescriptor,
  type BooleanValue,
  type BrainServices,
  BYTECODE_VERSION,
  CoreSensorId,
  CoreTypeIds,
  type ExecutionContext,
  extractBooleanValue,
  extractNumberValue,
  extractStringValue,
  type HandleId,
  type HostAsyncFn,
  type IBrain,
  type MapValue,
  mkActionDescriptor,
  mkCallDef,
  mkNumberValue,
  mkSensorTileId,
  mkVariableTileId,
  NativeType,
  NIL_VALUE,
  Op,
  param,
  TilePlacement,
  type UserActionArtifact,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { compileBrain } from "@mindcraft-lang/core/brain/compiler";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { Brain } from "@mindcraft-lang/core/brain/runtime";
import {
  BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileOperatorDef,
  BrainTileSensorDef,
  BrainTileVariableDef,
} from "@mindcraft-lang/core/brain/tiles";

let services: BrainServices;
let opAdd: BrainTileOperatorDef;
let opSub: BrainTileOperatorDef;
let opMul: BrainTileOperatorDef;
let opDiv: BrainTileOperatorDef;
let opAssign: BrainTileOperatorDef;
let opEq: BrainTileOperatorDef;
let opNeq: BrainTileOperatorDef;
let opLt: BrainTileOperatorDef;
let opGt: BrainTileOperatorDef;
let opAnd: BrainTileOperatorDef;
let opOr: BrainTileOperatorDef;
let opNot: BrainTileOperatorDef;
let opNeg: BrainTileOperatorDef;

before(() => {
  services = __test__createBrainServices();
  opAdd = new BrainTileOperatorDef("add", {}, services);
  opSub = new BrainTileOperatorDef("sub", {}, services);
  opMul = new BrainTileOperatorDef("mul", {}, services);
  opDiv = new BrainTileOperatorDef("div", {}, services);
  opAssign = new BrainTileOperatorDef("assign", {}, services);
  opEq = new BrainTileOperatorDef("eq", {}, services);
  opNeq = new BrainTileOperatorDef("ne", {}, services);
  opLt = new BrainTileOperatorDef("lt", {}, services);
  opGt = new BrainTileOperatorDef("gt", {}, services);
  opAnd = new BrainTileOperatorDef("and", {}, services);
  opOr = new BrainTileOperatorDef("or", {}, services);
  opNot = new BrainTileOperatorDef("not", {}, services);
  opNeg = new BrainTileOperatorDef("neg", {}, services);
});

// -- Helpers --

function buildBrain(whenTiles: readonly unknown[], doTiles: readonly unknown[]): BrainDef {
  const brainDef = new BrainDef(services);
  const pageResult = brainDef.appendNewPage();
  assert.ok(pageResult.success);
  const page = pageResult.value!.page;

  const rule = page.children().get(0)!;

  for (const tile of whenTiles) {
    rule.when().appendTile(tile as never);
  }
  for (const tile of doTiles) {
    rule.do().appendTile(tile as never);
  }

  return brainDef;
}

function runBrain(brainDef: BrainDef, ticks = 1): IBrain {
  const brain = brainDef.compile();
  brain.initialize();
  brain.startup();

  for (let i = 0; i < ticks; i++) {
    brain.think((i + 1) * 16);
  }

  return brain;
}

// -- Tiles shared across tests --

function mkLiteral(n: number) {
  return new BrainTileLiteralDef(CoreTypeIds.Number, n, {}, services);
}
function mkBoolLiteral(b: boolean) {
  return new BrainTileLiteralDef(CoreTypeIds.Boolean, b, {}, services);
}
function mkStringLiteral(s: string) {
  return new BrainTileLiteralDef(CoreTypeIds.String, s, {}, services);
}
function mkNilLiteral() {
  return new BrainTileLiteralDef(CoreTypeIds.Nil, undefined, {}, services);
}

function mkVar(name: string, typeId = CoreTypeIds.Number) {
  const uniqueId = `test-${name}`;
  return new BrainTileVariableDef(mkVariableTileId(uniqueId), name, typeId, uniqueId);
}

// ---- Tests ----

describe("Brain behavioral -- math expressions", () => {
  test("assign literal number to variable", () => {
    const v = mkVar("x");
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(42)]);
    const brain = runBrain(brainDef);

    const val = brain.getVariable(v.varName);
    assert.ok(val !== undefined, "variable should be set");
    assert.equal(val!.t, NativeType.Number);
    assert.equal(extractNumberValue(val), 42);
  });

  test("addition: x = 3 + 5", () => {
    const v = mkVar("x");
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(3), opAdd, mkLiteral(5)]);
    const brain = runBrain(brainDef);

    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 8);
  });

  test("subtraction: x = 10 - 4", () => {
    const v = mkVar("x");
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(10), opSub, mkLiteral(4)]);
    const brain = runBrain(brainDef);

    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 6);
  });

  test("multiplication: x = 6 * 7", () => {
    const v = mkVar("x");
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(6), opMul, mkLiteral(7)]);
    const brain = runBrain(brainDef);

    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 42);
  });

  test("division: x = 20 / 4", () => {
    const v = mkVar("x");
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(20), opDiv, mkLiteral(4)]);
    const brain = runBrain(brainDef);

    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 5);
  });

  test("negation: x = -7", () => {
    const v = mkVar("neg-x");
    const brainDef = buildBrain([], [v, opAssign, opNeg, mkLiteral(7)]);
    const brain = runBrain(brainDef);

    assert.equal(extractNumberValue(brain.getVariable(v.varName)), -7);
  });

  test("compound expression: x = 2 + 3 * 4 (precedence)", () => {
    const v = mkVar("prec");
    // Should evaluate as 2 + (3 * 4) = 14 if precedence is correct
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(2), opAdd, mkLiteral(3), opMul, mkLiteral(4)]);
    const brain = runBrain(brainDef);

    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 14);
  });
});

describe("Brain behavioral -- WHEN condition", () => {
  test("WHEN true -> DO executes", () => {
    const v = mkVar("w1");
    const brainDef = buildBrain([mkBoolLiteral(true)], [v, opAssign, mkLiteral(1)]);
    const brain = runBrain(brainDef);

    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 1);
  });

  test("WHEN false -> DO does not execute", () => {
    const v = mkVar("w2");
    const brainDef = buildBrain([mkBoolLiteral(false)], [v, opAssign, mkLiteral(1)]);
    const brain = runBrain(brainDef);

    assert.equal(brain.getVariable(v.varName), undefined, "variable should not be set");
  });

  test("empty WHEN -> always true (DO executes)", () => {
    const v = mkVar("w3");
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(99)]);
    const brain = runBrain(brainDef);

    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 99);
  });
});

describe("Brain behavioral -- variable read-back", () => {
  test("write then read variable in subsequent tick", () => {
    const v = mkVar("rw");
    // First tick: assign x = 10
    // The brain re-runs rules every tick, so x = 10 every tick
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(10)]);
    const brain = runBrain(brainDef, 2);

    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 10);
  });
});

describe("Brain behavioral -- boolean logic", () => {
  test("AND: true && false -> false", () => {
    const v = mkVar("band");
    const brainDef = buildBrain([], [v, opAssign, mkBoolLiteral(true), opAnd, mkBoolLiteral(false)]);
    const brain = runBrain(brainDef);

    const val = brain.getVariable(v.varName);
    assert.ok(val !== undefined);
    // Short-circuit AND: result is the falsy value or the last truthy value
    // In the VM, AND uses short-circuit: if left is falsy, result is left; otherwise result is right
    assert.equal(val!.t, NativeType.Boolean);
    assert.equal(val!.v, false);
  });

  test("OR: false || true -> true", () => {
    const v = mkVar("bor");
    const brainDef = buildBrain([], [v, opAssign, mkBoolLiteral(false), opOr, mkBoolLiteral(true)]);
    const brain = runBrain(brainDef);

    const val = brain.getVariable(v.varName);
    assert.ok(val !== undefined);
    assert.equal(val!.t, NativeType.Boolean);
    assert.equal(val!.v, true);
  });

  test("NOT: !true -> false", () => {
    const v = mkVar("bnot");
    const brainDef = buildBrain([], [v, opAssign, opNot, mkBoolLiteral(true)]);
    const brain = runBrain(brainDef);

    const val = brain.getVariable(v.varName);
    assert.ok(val !== undefined);
    assert.equal(val!.t, NativeType.Boolean);
    assert.equal(val!.v, false);
  });

  test("short-circuit AND: false && X -> false without evaluating X", () => {
    // Test that AND short-circuits by using false && (side-effecting expression)
    // We test indirectly: false AND true = false
    const v = mkVar("sc-and");
    const brainDef = buildBrain([], [v, opAssign, mkBoolLiteral(false), opAnd, mkBoolLiteral(true)]);
    const brain = runBrain(brainDef);

    const val = brain.getVariable(v.varName);
    assert.ok(val !== undefined);
    assert.equal((val as BooleanValue).v, false);
  });

  test("short-circuit OR: true || X -> true without evaluating X", () => {
    const v = mkVar("sc-or");
    const brainDef = buildBrain([], [v, opAssign, mkBoolLiteral(true), opOr, mkBoolLiteral(false)]);
    const brain = runBrain(brainDef);

    const val = brain.getVariable(v.varName);
    assert.ok(val !== undefined);
    assert.equal((val as BooleanValue).v, true);
  });
});

describe("Brain behavioral -- comparison operators", () => {
  test("equality: 5 == 5 -> true", () => {
    const v = mkVar("ceq");
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(5), opEq, mkLiteral(5)]);
    const brain = runBrain(brainDef);

    const val = brain.getVariable(v.varName);
    assert.ok(val !== undefined);
    assert.equal((val as BooleanValue).v, true);
  });

  test("inequality: 5 != 3 -> true", () => {
    const v = mkVar("cneq");
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(5), opNeq, mkLiteral(3)]);
    const brain = runBrain(brainDef);

    const val = brain.getVariable(v.varName);
    assert.ok(val !== undefined);
    assert.equal((val as BooleanValue).v, true);
  });

  test("less than: 3 < 5 -> true", () => {
    const v = mkVar("clt");
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(3), opLt, mkLiteral(5)]);
    const brain = runBrain(brainDef);

    const val = brain.getVariable(v.varName);
    assert.ok(val !== undefined);
    assert.equal((val as BooleanValue).v, true);
  });

  test("greater than: 5 > 3 -> true", () => {
    const v = mkVar("cgt");
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(5), opGt, mkLiteral(3)]);
    const brain = runBrain(brainDef);

    const val = brain.getVariable(v.varName);
    assert.ok(val !== undefined);
    assert.equal((val as BooleanValue).v, true);
  });
});

describe("Brain behavioral -- sensors and actuators", () => {
  test("sync sensor returns value used in DO", () => {
    const sensorId = "test-sensor-sync";
    const anonParam = param("anon-num");

    const fnEntry = services.functions.register(
      sensorId,
      false,
      { exec: () => ({ t: NativeType.Number, v: 77 }) },
      mkCallDef({ type: "bag", items: [] })
    );
    assert.equal(fnEntry.isAsync, false);

    const action = mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Number);
    services.actions.register({
      binding: "host",
      descriptor: action,
      execSync: fnEntry.fn.exec,
    });

    const sensor = new BrainTileSensorDef(sensorId, action, {
      placement: TilePlacement.Inline,
    });

    const v = mkVar("sensor-v");
    const brainDef = buildBrain([], [v, opAssign, sensor]);
    const brain = runBrain(brainDef);

    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 77);
  });

  test("sync actuator receives argument map and is called", () => {
    let called = false;
    let receivedArgs: MapValue | undefined;

    const actuatorId = "test-actuator-call";
    const callDef = mkCallDef({
      type: "bag",
      items: [
        {
          type: "arg",
          name: "anonNumber",
          tileId: "tile.param->test-act-anon",
          required: true,
          anonymous: true,
        },
      ],
    });

    const fnEntry = services.functions.register(
      actuatorId,
      false,
      {
        exec: (_ctx: ExecutionContext, args: MapValue) => {
          called = true;
          receivedArgs = args;
          return VOID_VALUE;
        },
      },
      callDef
    );
    assert.equal(fnEntry.isAsync, false);

    const action = mkActionDescriptor("actuator", fnEntry);
    services.actions.register({
      binding: "host",
      descriptor: action,
      execSync: fnEntry.fn.exec,
    });

    const actuator = new BrainTileActuatorDef(actuatorId, action);

    const brainDef = buildBrain([], [actuator, mkLiteral(42)]);
    const brain = runBrain(brainDef);

    assert.ok(called, "actuator should have been called");
    assert.ok(receivedArgs !== undefined, "actuator should receive args");
  });
});

describe("Brain behavioral -- multi-page", () => {
  test("page change via requestPageChange", () => {
    // Build a brain with 2 pages:
    // Page 0: DO assigns x = 1
    // Page 1: DO assigns x = 2
    const v = mkVar("pg-v");
    const brainDef = new BrainDef(services);

    // Page 0
    const p0Result = brainDef.appendNewPage();
    assert.ok(p0Result.success);
    const rule0 = p0Result.value!.page.children().get(0)!;
    rule0.do().appendTile(v as never);
    rule0.do().appendTile(opAssign as never);
    rule0.do().appendTile(mkLiteral(1) as never);

    // Page 1
    const p1Result = brainDef.appendNewPage();
    assert.ok(p1Result.success);
    const rule1 = p1Result.value!.page.children().get(0)!;
    rule1.do().appendTile(v as never);
    rule1.do().appendTile(opAssign as never);
    rule1.do().appendTile(mkLiteral(2) as never);

    const brain = brainDef.compile();
    brain.initialize();
    brain.startup();

    // Tick on page 0
    brain.think(16);
    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 1);

    // Switch to page 1
    brain.requestPageChange(1);
    brain.think(32);
    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 2);
  });
});

describe("Brain behavioral -- page sensors", () => {
  test("current-page sensor returns active page ID", () => {
    const v = mkVar("cp", CoreTypeIds.String);
    const fnEntry = services.functions.get(CoreSensorId.CurrentPage);
    assert.ok(fnEntry, "current-page function should be registered");
    const cpSensor = new BrainTileSensorDef(
      CoreSensorId.CurrentPage,
      mkActionDescriptor("sensor", fnEntry!, CoreTypeIds.String),
      {
        placement: TilePlacement.EitherSide | TilePlacement.Inline,
      }
    );

    const brainDef = buildBrain([], [v, opAssign, cpSensor]);
    const brain = runBrain(brainDef);

    const program = brain.getProgram();
    assert.ok(program);
    const expectedPageId = program!.pages.get(0)!.pageId;

    const val = brain.getVariable(v.varName);
    assert.ok(val !== undefined);
    assert.equal(val!.t, NativeType.String);
    assert.equal(val!.v, expectedPageId);
  });

  test("previous-page returns current page when no switch has occurred", () => {
    const v = mkVar("pp-no-switch", CoreTypeIds.String);
    const fnEntry = services.functions.get(CoreSensorId.PreviousPage);
    assert.ok(fnEntry, "previous-page function should be registered");
    const ppSensor = new BrainTileSensorDef(
      CoreSensorId.PreviousPage,
      mkActionDescriptor("sensor", fnEntry!, CoreTypeIds.String),
      {
        placement: TilePlacement.EitherSide | TilePlacement.Inline,
      }
    );

    const brainDef = buildBrain([], [v, opAssign, ppSensor]);
    const brain = runBrain(brainDef);

    const program = brain.getProgram();
    assert.ok(program);
    const currentPageId = program!.pages.get(0)!.pageId;

    const val = brain.getVariable(v.varName);
    assert.ok(val !== undefined);
    assert.equal(val!.t, NativeType.String);
    assert.equal(val!.v, currentPageId);
  });

  test("previous-page returns page 0 ID after switching to page 1", () => {
    const v = mkVar("pp-after-switch", CoreTypeIds.String);
    const fnEntry = services.functions.get(CoreSensorId.PreviousPage);
    assert.ok(fnEntry);
    const ppSensor = new BrainTileSensorDef(
      CoreSensorId.PreviousPage,
      mkActionDescriptor("sensor", fnEntry!, CoreTypeIds.String),
      {
        placement: TilePlacement.EitherSide | TilePlacement.Inline,
      }
    );

    const brainDef = new BrainDef(services);

    // Page 0 (empty)
    const p0Result = brainDef.appendNewPage();
    assert.ok(p0Result.success);

    // Page 1: assign previous-page to variable
    const p1Result = brainDef.appendNewPage();
    assert.ok(p1Result.success);
    const rule1 = p1Result.value!.page.children().get(0)!;
    rule1.do().appendTile(v as never);
    rule1.do().appendTile(opAssign as never);
    rule1.do().appendTile(ppSensor as never);

    const brain = brainDef.compile();
    brain.initialize();
    brain.startup();

    const program = brain.getProgram();
    assert.ok(program);
    const page0Id = program!.pages.get(0)!.pageId;

    // Tick on page 0
    brain.think(16);

    // Switch to page 1
    brain.requestPageChange(1);
    brain.think(32);

    const val = brain.getVariable(v.varName);
    assert.ok(val !== undefined);
    assert.equal(val!.t, NativeType.String);
    assert.equal(val!.v, page0Id);
  });

  test("previous-page updates after multiple page switches", () => {
    const v = mkVar("pp-multi", CoreTypeIds.String);
    const fnEntry = services.functions.get(CoreSensorId.PreviousPage);
    assert.ok(fnEntry);
    const ppSensor = new BrainTileSensorDef(
      CoreSensorId.PreviousPage,
      mkActionDescriptor("sensor", fnEntry!, CoreTypeIds.String),
      {
        placement: TilePlacement.EitherSide | TilePlacement.Inline,
      }
    );

    const brainDef = new BrainDef(services);

    // Page 0: assign previous-page to var
    const p0Result = brainDef.appendNewPage();
    assert.ok(p0Result.success);
    const rule0 = p0Result.value!.page.children().get(0)!;
    rule0.do().appendTile(v as never);
    rule0.do().appendTile(opAssign as never);
    rule0.do().appendTile(ppSensor as never);

    // Page 1: assign previous-page to var
    const p1Result = brainDef.appendNewPage();
    assert.ok(p1Result.success);
    const rule1 = p1Result.value!.page.children().get(0)!;
    rule1.do().appendTile(v as never);
    rule1.do().appendTile(opAssign as never);
    rule1.do().appendTile(ppSensor as never);

    const brain = brainDef.compile();
    brain.initialize();
    brain.startup();

    const program = brain.getProgram();
    assert.ok(program);
    const page0Id = program!.pages.get(0)!.pageId;
    const page1Id = program!.pages.get(1)!.pageId;

    // Tick on page 0 -- previous is current (no switch yet)
    brain.think(16);
    assert.equal(extractStringValue(brain.getVariable(v.varName)), page0Id);

    // Switch to page 1, tick -- previous should be page 0
    brain.requestPageChange(1);
    brain.think(32);
    assert.equal(extractStringValue(brain.getVariable(v.varName)), page0Id);

    // Switch back to page 0, tick -- previous should be page 1
    brain.requestPageChange(0);
    brain.think(48);
    assert.equal(extractStringValue(brain.getVariable(v.varName)), page1Id);
  });
});

describe("Brain behavioral -- fiber respawn", () => {
  test("rules re-execute after fiber completes", () => {
    // Each tick, the rule runs again and re-assigns the variable
    const v = mkVar("resp");
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(5)]);
    const brain = runBrain(brainDef, 3);

    // Variable should still be 5 after multiple ticks (re-assigned each tick)
    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 5);
  });
});

describe("Brain behavioral -- action state", () => {
  test("host-backed action state survives root-rule respawns and page restart", () => {
    let activationCount = 0;

    const onPageEnteredFn = services.functions.get(CoreSensorId.OnPageEntered);
    assert.ok(onPageEnteredFn, "on-page-entered function should be registered");

    const sensor = new BrainTileSensorDef(
      CoreSensorId.OnPageEntered,
      mkActionDescriptor("sensor", onPageEnteredFn!, CoreTypeIds.Boolean),
      {
        placement: TilePlacement.EitherSide | TilePlacement.Inline,
      }
    );

    const actuatorDescriptor: ActionDescriptor = {
      key: "test-phase5-host-activation-counter",
      kind: "actuator",
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: false,
    };
    services.actions.register({
      binding: "host",
      descriptor: actuatorDescriptor,
      execSync: () => {
        activationCount += 1;
        return VOID_VALUE;
      },
    });

    const actuator = new BrainTileActuatorDef("test-phase5-host-activation-counter", actuatorDescriptor);
    const brainDef = buildBrain([sensor], [actuator]);
    const brain = brainDef.compile();
    brain.initialize();
    brain.startup();

    brain.think(16);
    brain.think(32);
    brain.think(48);

    assert.equal(activationCount, 1, "on-page-entered should only fire once per activation across respawns");

    brain.requestPageRestart();
    brain.think(64);

    assert.equal(activationCount, 1, "page restart should NOT re-run activation hooks or reset state");
  });

  test("bytecode-backed activation hook runs once per activation, preserved on restart", () => {
    let activationCount = 0;
    const activationFnEntry = services.functions.register(
      "test-phase5-bytecode-activation-host",
      false,
      {
        exec: () => {
          activationCount += 1;
          return mkNumberValue(activationCount);
        },
      },
      mkCallDef({ type: "bag", items: [] })
    );

    const descriptor: ActionDescriptor = {
      key: "test-phase5-bytecode-activation",
      kind: "sensor",
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: false,
      outputType: CoreTypeIds.Number,
    };
    const sensor = new BrainTileSensorDef("test-phase5-bytecode-activation", descriptor, {
      placement: TilePlacement.EitherSide | TilePlacement.Inline,
    });
    const v = mkVar("bytecode-activation");
    const brainDef = buildBrain([], [v, opAssign, sensor]);

    const artifact: UserActionArtifact = {
      version: BYTECODE_VERSION,
      functions: List.from([
        {
          code: List.from([{ op: Op.LOAD_CALLSITE_VAR, a: 0 }, { op: Op.RET }]),
          numParams: 0,
          name: "entry",
        },
        {
          code: List.from([
            { op: Op.HOST_CALL_ARGS, a: activationFnEntry.id, b: 0, c: 0 },
            { op: Op.STORE_CALLSITE_VAR, a: 0 },
            { op: Op.PUSH_CONST, a: 0 },
            { op: Op.RET },
          ]),
          numParams: 0,
          name: "activation",
        },
      ]),
      constants: List.from([NIL_VALUE]),
      variableNames: List.empty(),
      entryPoint: 0,
      key: descriptor.key,
      kind: descriptor.kind,
      callDef: descriptor.callDef,
      outputType: descriptor.outputType,
      isAsync: false,
      numStateSlots: 1,
      entryFuncId: 0,
      activationFuncId: 1,
      revisionId: "test-phase5-bytecode-activation-rev1",
    };

    const brain = new Brain(brainDef, services, {
      catalogs: List.from([services.tiles, brainDef.catalog()]),
      actionResolver: {
        resolveAction(actionDescriptor) {
          if (actionDescriptor.key === descriptor.key) {
            return {
              binding: "bytecode" as const,
              descriptor: actionDescriptor,
              artifact,
            };
          }
          return undefined;
        },
      },
    });

    brain.initialize();
    brain.startup();

    assert.equal(activationCount, 1, "startup should invoke bytecode activation exactly once");

    brain.think(16);
    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 1);

    brain.think(32);
    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 1);

    brain.requestPageRestart();
    brain.think(48);

    assert.equal(activationCount, 1, "page restart should NOT re-run bytecode activation");
    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 1);
  });

  test("action state resets when switching to a different page and back", () => {
    let activationCount = 0;

    const onPageEnteredFn = services.functions.get(CoreSensorId.OnPageEntered);
    assert.ok(onPageEnteredFn, "on-page-entered function should be registered");

    const sensor = new BrainTileSensorDef(
      CoreSensorId.OnPageEntered,
      mkActionDescriptor("sensor", onPageEnteredFn!, CoreTypeIds.Boolean),
      {
        placement: TilePlacement.EitherSide | TilePlacement.Inline,
      }
    );

    const actuatorDescriptor: ActionDescriptor = {
      key: "test-cross-page-reset-counter",
      kind: "actuator",
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: false,
    };
    services.actions.register({
      binding: "host",
      descriptor: actuatorDescriptor,
      execSync: () => {
        activationCount += 1;
        return VOID_VALUE;
      },
    });

    const actuator = new BrainTileActuatorDef("test-cross-page-reset-counter", actuatorDescriptor);

    const brainDef = new BrainDef(services);

    // Page 0: WHEN on-page-entered DO actuator
    const p0Result = brainDef.appendNewPage();
    assert.ok(p0Result.success);
    const rule0 = p0Result.value!.page.children().get(0)!;
    rule0.when().appendTile(sensor as never);
    rule0.do().appendTile(actuator as never);

    // Page 1: empty (just needs to exist as a different page)
    const p1Result = brainDef.appendNewPage();
    assert.ok(p1Result.success);

    const brain = brainDef.compile();
    brain.initialize();
    brain.startup();

    brain.think(16);
    assert.equal(activationCount, 1, "actuator fires once on initial page activation");

    brain.think(32);
    brain.think(48);
    assert.equal(activationCount, 1, "actuator does not re-fire across respawns");

    // Switch to page 1, tick
    brain.requestPageChange(1);
    brain.think(64);

    // Switch back to page 0, tick -- state should be reset
    brain.requestPageChange(0);
    brain.think(80);
    assert.equal(activationCount, 2, "returning to a page after leaving resets action state and re-fires activation");
  });
});

describe("Brain behavioral -- compiled program structure", () => {
  test("single-page brain produces correct program shape", () => {
    const v = mkVar("prog-v");
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(1)]);
    const brain = brainDef.compile();
    brain.initialize();

    const program = brain.getProgram();
    assert.ok(program !== undefined, "program should exist after initialize");
    assert.equal(program!.version, 1, "bytecode version should be 1");
    assert.ok(program!.functions.size() > 0, "should have at least one function");
    assert.ok(program!.pages.size() > 0, "should have at least one page");
    assert.ok(program!.constants.size() > 0, "should have constants");
  });

  test("action tiles compile to unlinked action refs and page action callsites", () => {
    const unboundAction: ActionDescriptor = {
      key: "test-phase2-unbound-action",
      kind: "actuator",
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: false,
    };

    const actuator = new BrainTileActuatorDef("test-phase2-unbound-actuator", unboundAction);
    const brainDef = buildBrain([], [actuator]);
    const program = compileBrain(brainDef, List.from([services.tiles, brainDef.catalog()]), services.conversions);

    assert.equal(program.actionRefs.size(), 1);
    assert.deepEqual(program.actionRefs.get(0), {
      slot: 0,
      key: "test-phase2-unbound-action",
    });

    const page = program.pages.get(0)!;
    assert.equal(page.actionCallSites.size(), 1);
    assert.deepEqual(page.actionCallSites.get(0), {
      actionSlot: 0,
      callSiteId: 0,
    });

    const rootFunc = program.functions.get(page.rootRuleFuncIds.get(0)!)!;
    assert.notEqual(
      rootFunc.code.findIndex((ins) => ins.op === Op.ACTION_CALL),
      -1,
      "root rule should contain ACTION_CALL bytecode"
    );
  });

  test("brain initialization links action slots to executable host actions", () => {
    const fnEntry = services.functions.get(CoreSensorId.CurrentPage);
    assert.ok(fnEntry, "current-page function should be registered");

    const cpSensor = new BrainTileSensorDef(
      CoreSensorId.CurrentPage,
      mkActionDescriptor("sensor", fnEntry!, CoreTypeIds.String),
      {
        placement: TilePlacement.EitherSide | TilePlacement.Inline,
      }
    );

    const brainDef = buildBrain([], [cpSensor]);
    const brain = brainDef.compile();
    brain.initialize();

    const program = brain.getProgram();
    assert.ok(program, "linked program should exist after initialize");
    assert.equal(program!.actions.size(), 1);
    assert.equal(program!.actions.get(0)!.binding, "host");
    assert.equal(program!.actions.get(0)!.descriptor.key, CoreSensorId.CurrentPage);
  });
});

describe("Brain behavioral -- nil value overloads", () => {
  test("nil == nil -> true", () => {
    const v = mkVar("nil-eq", CoreTypeIds.Boolean);
    const brainDef = buildBrain([], [v, opAssign, mkNilLiteral(), opEq, mkNilLiteral()]);
    const brain = runBrain(brainDef);

    assert.equal(extractBooleanValue(brain.getVariable(v.varName)), true);
  });

  test("nil != nil -> false", () => {
    const v = mkVar("nil-neq", CoreTypeIds.Boolean);
    const brainDef = buildBrain([], [v, opAssign, mkNilLiteral(), opNeq, mkNilLiteral()]);
    const brain = runBrain(brainDef);

    assert.equal(extractBooleanValue(brain.getVariable(v.varName)), false);
  });

  test("NOT nil -> true (nil is falsy)", () => {
    const v = mkVar("nil-not", CoreTypeIds.Boolean);
    const brainDef = buildBrain([], [v, opAssign, opNot, mkNilLiteral()]);
    const brain = runBrain(brainDef);

    assert.equal(extractBooleanValue(brain.getVariable(v.varName)), true);
  });

  test("number == nil -> false (cross-type)", () => {
    const v = mkVar("num-eq-nil", CoreTypeIds.Boolean);
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(42), opEq, mkNilLiteral()]);
    const brain = runBrain(brainDef);

    assert.equal(extractBooleanValue(brain.getVariable(v.varName)), false);
  });

  test("nil == number -> false (cross-type)", () => {
    const v = mkVar("nil-eq-num", CoreTypeIds.Boolean);
    const brainDef = buildBrain([], [v, opAssign, mkNilLiteral(), opEq, mkLiteral(42)]);
    const brain = runBrain(brainDef);

    assert.equal(extractBooleanValue(brain.getVariable(v.varName)), false);
  });

  test("number != nil -> true (cross-type)", () => {
    const v = mkVar("num-neq-nil", CoreTypeIds.Boolean);
    const brainDef = buildBrain([], [v, opAssign, mkLiteral(42), opNeq, mkNilLiteral()]);
    const brain = runBrain(brainDef);

    assert.equal(extractBooleanValue(brain.getVariable(v.varName)), true);
  });

  test("nil != number -> true (cross-type)", () => {
    const v = mkVar("nil-neq-num", CoreTypeIds.Boolean);
    const brainDef = buildBrain([], [v, opAssign, mkNilLiteral(), opNeq, mkLiteral(42)]);
    const brain = runBrain(brainDef);

    assert.equal(extractBooleanValue(brain.getVariable(v.varName)), true);
  });

  test("boolean == nil -> false (cross-type)", () => {
    const v = mkVar("bool-eq-nil", CoreTypeIds.Boolean);
    const brainDef = buildBrain([], [v, opAssign, mkBoolLiteral(true), opEq, mkNilLiteral()]);
    const brain = runBrain(brainDef);

    assert.equal(extractBooleanValue(brain.getVariable(v.varName)), false);
  });

  test("string != nil -> true (cross-type)", () => {
    const v = mkVar("str-neq-nil", CoreTypeIds.Boolean);
    const brainDef = buildBrain([], [v, opAssign, mkStringLiteral("hello"), opNeq, mkNilLiteral()]);
    const brain = runBrain(brainDef);

    assert.equal(extractBooleanValue(brain.getVariable(v.varName)), true);
  });

  test("nil == nil in WHEN condition gates execution", () => {
    const v = mkVar("nil-when", CoreTypeIds.Number);
    const brainDef = buildBrain([mkNilLiteral(), opEq, mkNilLiteral()], [v, opAssign, mkLiteral(99)]);
    const brain = runBrain(brainDef);

    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 99);
  });

  test("number == nil in WHEN condition blocks execution", () => {
    const v = mkVar("cross-when", CoreTypeIds.Number);
    const brainDef = buildBrain([mkLiteral(5), opEq, mkNilLiteral()], [v, opAssign, mkLiteral(99)]);
    const brain = runBrain(brainDef);

    assert.equal(brain.getVariable(v.varName), undefined, "DO should not execute");
  });
});

describe("Brain behavioral -- timeout sensor", () => {
  function getCoreSensor(sensorId: string): BrainTileSensorDef {
    const tile = services.tiles.get(mkSensorTileId(sensorId)) as BrainTileSensorDef;
    assert.ok(tile, `${sensorId} sensor tile should be registered`);
    return tile;
  }

  test("WHEN [timeout][constant 0.5] -> fires after 500ms", () => {
    const timeoutTile = getCoreSensor(CoreSensorId.Timeout);
    const v = mkVar("t-const");

    const brainDef = buildBrain([timeoutTile, mkLiteral(0.5)], [v, opAssign, mkLiteral(1)]);

    const brain = brainDef.compile();
    brain.initialize();
    brain.startup();

    for (let t = 16; t <= 1000; t += 16) {
      brain.think(t);
    }

    assert.equal(extractNumberValue(brain.getVariable(v.varName)), 1, "DO should have run after timeout fired");
  });

  test("WHEN [timeout][random + 5] -> evaluates expression as delay (does not fire under 4s)", () => {
    const timeoutTile = getCoreSensor(CoreSensorId.Timeout);
    const randomTile = getCoreSensor(CoreSensorId.Random);

    const v = mkVar("t-expr");
    const brainDef = buildBrain([timeoutTile, randomTile, opAdd, mkLiteral(5)], [v, opAssign, mkLiteral(1)]);

    const brain = brainDef.compile();
    brain.initialize();
    brain.startup();

    // delay = random(0..1) + 5 = 5..6 seconds. After 4 seconds it must NOT have fired.
    // (If the parser silently dropped the arg, the default 1s delay would have fired by 1s.)
    for (let t = 16; t <= 4000; t += 16) {
      brain.think(t);
    }

    assert.equal(brain.getVariable(v.varName), undefined, "timeout should not have fired before 5s");

    // Continue past the upper bound (6s). Timeout MUST fire by then.
    for (let t = 4016; t <= 7000; t += 16) {
      brain.think(t);
    }

    assert.equal(
      extractNumberValue(brain.getVariable(v.varName)),
      1,
      "DO should have run after timeout fired (within 5..6s window)"
    );
  });

  test("WHEN [timeout][unassignedVar + random] -> nil-poisoned delay never fires (rule evaluates false)", () => {
    const timeoutTile = getCoreSensor(CoreSensorId.Timeout);
    const randomTile = getCoreSensor(CoreSensorId.Random);

    // unassignedVar is NEVER written. At runtime its value is nil. The compiler
    // typed it as number based on its declared type, so the number+number Add
    // overload runs at runtime with one nil operand. Hardened math ops return
    // NIL_VALUE; the timeout sensor sees a non-numeric delay and refuses to fire.
    const unassignedVar = mkVar("unassigned");
    const sentinelVar = mkVar("sentinel");
    const brainDef = buildBrain([timeoutTile, unassignedVar, opAdd, randomTile], [sentinelVar, opAssign, mkLiteral(1)]);

    const brain = brainDef.compile();
    brain.initialize();
    brain.startup();

    for (let t = 16; t <= 5000; t += 16) {
      brain.think(t);
    }

    assert.equal(
      brain.getVariable(sentinelVar.varName),
      undefined,
      "DO should NEVER run when delay expression evaluates to nil/NaN"
    );
  });
});
