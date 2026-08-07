import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { type BrainServices, mkVariableTileId } from "@mindcraft-lang/core/brain";
import { __test__appendTile, __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import {
  type BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileOperatorDef,
  type BrainTileSensorDef,
  BrainTileVariableDef,
} from "@mindcraft-lang/core/brain/tiles";
import { CoreTypeIds, extractNumberValue, type IBrain, type Value } from "@mindcraft-lang/core/runtime";
import { registerUserTile } from "../runtime/registration-bridge.js";
import { buildUserTileMetadata } from "../runtime/user-tile-metadata.js";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { expectDiagnostic } from "../testsupport/diag-coverage.js";
import { buildAmbientDeclarations } from "./ambient.js";
import { LoweringDiagCode } from "./diag-codes.js";
import { UserTileProject } from "./project.js";

let services: BrainServices;
let opAssign: BrainTileOperatorDef;

before(() => {
  services = __test__createBrainServices();
  opAssign = new BrainTileOperatorDef("assign", {}, services);
});

type ActionTile = BrainTileActuatorDef | BrainTileSensorDef;

/**
 * Compile a multi-file user-tile project, register every default-export tile,
 * and return the appendable tile def for each requested entry path.
 */
function compileTiles(files: Record<string, string>, entryPaths: string[]): ActionTile[] {
  const ambientSource = buildAmbientDeclarations(services.runtime.types);
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
    services,
  });
  project.setFiles(new Map(Object.entries(files)));
  const result = project.compileAll();
  assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);

  const tiles: ActionTile[] = [];
  for (const path of entryPaths) {
    const entry = result.results.get(path);
    assert.ok(entry, `expected a result for ${path}`);
    assert.deepStrictEqual(entry!.diagnostics, [], `Diagnostics for ${path}: ${JSON.stringify(entry!.diagnostics)}`);
    assert.ok(entry!.program, `expected a compiled program for ${path}`);
    const program = entry!.program!;
    const metadata = buildUserTileMetadata(program, (name) => services.runtime.types.resolveByName(name));
    assert.ok(metadata, `expected tile metadata for ${path}`);
    registerUserTile(program, services);
    tiles.push(metadata!.actionTile);
  }
  return tiles;
}

/**
 * Compile a single-file tile expected to fail lowering, asserting it produced no
 * TypeScript error and that the entry's diagnostics include `code`.
 */
function expectLoweringDiagnostic(source: string, code: LoweringDiagCode): void {
  const ambientSource = buildAmbientDeclarations(services.runtime.types);
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
    services,
  });
  project.setFiles(new Map([["tile.ts", source]]));
  const result = project.compileAll();
  assert.equal(result.tsErrors.size, 0, `unexpected TS errors: ${JSON.stringify([...result.tsErrors])}`);
  const entry = result.results.get("tile.ts");
  assert.ok(entry, "expected a result for tile.ts");
  expectDiagnostic(entry!.diagnostics, code);
}

function mkVar(name: string): BrainTileVariableDef {
  const uniqueId = `sys-${name}`;
  return new BrainTileVariableDef(mkVariableTileId(uniqueId), name, CoreTypeIds.Number, uniqueId);
}

function mkLiteral(n: number): BrainTileLiteralDef {
  return new BrainTileLiteralDef(CoreTypeIds.Number, n, {}, services);
}

function newBrain(): { brainDef: BrainDef; rule: BrainRuleDef } {
  const brainDef = new BrainDef(services);
  const pageResult = brainDef.appendNewPage();
  assert.ok(pageResult.success);
  return { brainDef, rule: pageResult.value!.page.children().get(0)! as BrainRuleDef };
}

function runBrain(brainDef: BrainDef, ticks: number): IBrain {
  const brain = brainDef.compile();
  brain.initialize();
  brain.startup();
  for (let i = 0; i < ticks; i++) {
    brain.think((i + 1) * 16);
  }
  return brain;
}

function num(brain: IBrain, name: string): number | undefined {
  const v: Value | undefined = brain.getVariable(name);
  return v === undefined ? undefined : extractNumberValue(v);
}

describe("System (user-code shared singleton)", () => {
  test("init runs once at startup; think runs every think", () => {
    const [readCount] = compileTiles(
      {
        "counter.ts": `
import { System, Sensor, type Context } from "mindcraft";

const Counter = System({
  name: "counter",
  state: { count: 0 },
  init(ctx: Context) { this.count = 100; },
  think(ctx: Context) { this.count = this.count + 1; },
});

export default Sensor({
  name: "read count", inline: true,
  onExecute(ctx: Context): number { return Counter.count; },
});
`,
      },
      ["counter.ts"]
    );

    const v = mkVar("count-out");
    // Each tick: the rule reads count into the var, THEN the System think increments.
    const { brainDef, rule } = newBrain();
    __test__appendTile(rule.do(), v as never);
    __test__appendTile(rule.do(), opAssign as never);
    __test__appendTile(rule.do(), readCount as never);
    const brain = runBrain(brainDef, 3);
    // think1 reads 100 (init), think2 reads 101, think3 reads 102.
    assert.equal(num(brain, v.varName), 102, "init-once + think-per-tick");
  });

  test("a method mutates persistent state that latches and accumulates across thinks", () => {
    // One tile reaches the System at two callsites in its body: a method write
    // (`add`) and a field read (`count`). The store persists across thinks, so a
    // method call latches -- the running total survives without state resetting.
    const [accAndRead] = compileTiles(
      {
        "acc.ts": `
import { System, Sensor, type Context } from "mindcraft";

const Acc = System({
  name: "accumulator",
  state: { count: 0 },
  add(n: number) { this.count = this.count + n; },
});

export default Sensor({
  name: "acc add and read", inline: true,
  onExecute(ctx: Context): number {
    Acc.add(3);
    return Acc.count;
  },
});
`,
      },
      ["acc.ts"]
    );

    const v = mkVar("acc-out");
    const { brainDef, rule } = newBrain();
    __test__appendTile(rule.do(), v as never);
    __test__appendTile(rule.do(), opAssign as never);
    __test__appendTile(rule.do(), accAndRead as never);
    const brain = runBrain(brainDef, 3);
    // tick1 add->3 read 3; tick2 add->6 read 6; tick3 add->9 read 9.
    assert.equal(num(brain, v.varName), 9, "method writes persist and accumulate across thinks");
  });

  test("helper methods (sibling calls) and field operators work naturally inside a System", () => {
    const [readCount] = compileTiles(
      {
        "helpers.ts": `
import { System, Sensor, type Context } from "mindcraft";

const Acc = System({
  name: "helpers",
  state: { count: 0 },
  init(ctx: Context) { this.reset(); },          // init calls a method
  think(ctx: Context) { this.step(); },          // think calls a method
  reset() { this.count = 10; },
  step() { this.count++; this.bump(); },         // postfix ++ then a sibling call
  bump() { this.count += 4; --this.count; },     // compound += then prefix --
});

export default Sensor({
  name: "helpers read", inline: true,
  onExecute(ctx: Context): number { return Acc.count; },
});
`,
      },
      ["helpers.ts"]
    );

    const v = mkVar("helpers-out");
    const { brainDef, rule } = newBrain();
    __test__appendTile(rule.do(), v as never);
    __test__appendTile(rule.do(), opAssign as never);
    __test__appendTile(rule.do(), readCount as never);
    const brain = runBrain(brainDef, 3);
    // init->reset sets 10; each think: step (++ -> +1) then bump (+=4, -- -> +3) = net +4.
    // reads: think1=10, think2=14, think3=18.
    assert.equal(num(brain, v.varName), 18, "sibling method calls and ++/--/+= all run");
  });

  test("cross-module: a System exported from one module, used by two importing tiles, shares one store", () => {
    // The System (with its per-think tick) is defined in lib/movement.ts; two
    // reader tiles in different modules import it. They always observe equal,
    // climbing readings -- proof both imported references resolve to one store
    // that the module's own `think` drives.
    const [readA, readB] = compileTiles(
      {
        "lib/movement.ts": `
import { System } from "mindcraft";

export const Counter = System({
  name: "counter",
  state: { count: 0 },
  think() { this.count = this.count + 1; },
});
`,
        "tiles/read-a.ts": `
import { Sensor, type Context } from "mindcraft";
import { Counter } from "../lib/movement";

export default Sensor({
  name: "counter read a", inline: true,
  onExecute(ctx: Context): number { return Counter.count; },
});
`,
        "tiles/read-b.ts": `
import { Sensor, type Context } from "mindcraft";
import { Counter } from "../lib/movement";

export default Sensor({
  name: "counter read b", inline: true,
  onExecute(ctx: Context): number { return Counter.count; },
});
`,
      },
      ["tiles/read-a.ts", "tiles/read-b.ts"]
    );

    const outA = mkVar("xmod-a");
    const outB = mkVar("xmod-b");
    const { brainDef, rule } = newBrain();
    __test__appendTile(rule.do(), outA as never);
    __test__appendTile(rule.do(), opAssign as never);
    __test__appendTile(rule.do(), readA as never);
    const child = rule.appendNewRule();
    __test__appendTile(child.do(), outB as never);
    __test__appendTile(child.do(), opAssign as never);
    __test__appendTile(child.do(), readB as never);

    const brain = runBrain(brainDef, 3);
    // Structural: both importing tiles resolved to ONE registration (one store).
    const systems = brain.getProgram()?.systems;
    assert.ok(systems && systems.size() === 1, "two importing tiles register exactly one shared System");
    // Behavioral: the System defined in lib/movement.ts ran its `think`.
    const a = num(brain, outA.varName);
    const b = num(brain, outB.varName);
    assert.ok(a !== undefined && a > 0, "the System's think advanced the shared count");
    assert.ok(b !== undefined && b > 0, "the second importing tile reads the same running store");
  });

  test("page-independence: a System keeps ticking and retains state across a page switch", () => {
    const [readCount] = compileTiles(
      {
        "ticker.ts": `
import { System, Sensor, type Context } from "mindcraft";

const Ticker = System({
  name: "ticker",
  state: { count: 0 },
  think(ctx: Context) { this.count = this.count + 1; },
});

export default Sensor({
  name: "read ticker", inline: true,
  onExecute(ctx: Context): number { return Ticker.count; },
});
`,
      },
      ["ticker.ts"]
    );

    const v0 = mkVar("pg0-out");
    const v1 = mkVar("pg1-out");

    const brainDef = new BrainDef(services);
    const p0 = brainDef.appendNewPage();
    assert.ok(p0.success);
    const rule0 = p0.value!.page.children().get(0)!;
    __test__appendTile(rule0.do(), v0 as never);
    __test__appendTile(rule0.do(), opAssign as never);
    __test__appendTile(rule0.do(), readCount as never);

    const p1 = brainDef.appendNewPage();
    assert.ok(p1.success);
    const rule1 = p1.value!.page.children().get(0)!;
    __test__appendTile(rule1.do(), v1 as never);
    __test__appendTile(rule1.do(), opAssign as never);
    __test__appendTile(rule1.do(), readCount as never);

    const brain = brainDef.compile();
    brain.initialize();
    brain.startup();
    brain.think(16); // page 0 reads 0, then count -> 1
    brain.think(32); // page 0 reads 1, then count -> 2
    brain.requestPageChange(1);
    brain.think(48); // page 1 reads 2, then count -> 3
    brain.think(64); // page 1 reads 3, then count -> 4

    // The System never reset across the switch: page 1's reads continued from
    // where page 0 left off, proving page-independent ticking + retained state.
    assert.equal(num(brain, v0.varName), 1, "page 0 last read");
    assert.equal(num(brain, v1.varName), 3, "page 1 reads keep climbing across the switch");
  });

  test("no-collision: a brain variable named like a System does not alias the System state", () => {
    const [readCount] = compileTiles(
      {
        "named.ts": `
import { System, Sensor, type Context } from "mindcraft";

const Counter = System({
  name: "counter",
  state: { count: 0 },
  init(ctx: Context) { this.count = 500; },
  think(ctx: Context) { this.count = this.count + 1; },
});

export default Sensor({
  name: "read named", inline: true,
  onExecute(ctx: Context): number { return Counter.count; },
});
`,
      },
      ["named.ts"]
    );

    // A brain variable literally named "counter" (the System's name) assigned 7.
    const counterVar = mkVar("counter");
    const sysOut = mkVar("sys-out");

    const { brainDef, rule } = newBrain();
    __test__appendTile(rule.do(), counterVar as never);
    __test__appendTile(rule.do(), opAssign as never);
    __test__appendTile(rule.do(), mkLiteral(7) as never);
    const child = rule.appendNewRule();
    __test__appendTile(child.do(), sysOut as never);
    __test__appendTile(child.do(), opAssign as never);
    __test__appendTile(child.do(), readCount as never);

    const brain = runBrain(brainDef, 2);
    // The brain var "counter" must be untouched by the System's count; the
    // System's value must reflect init (500) + think, in its own namespace.
    assert.equal(num(brain, "sys-out"), 501, "System state lives in its own store");
    assert.equal(num(brain, "counter"), 7, "the like-named brain variable keeps its own value");
  });

  test("reachability: a System is registered only in brains that reach it", () => {
    const [readCount, plain] = compileTiles(
      {
        "reach.ts": `
import { System, Sensor, type Context } from "mindcraft";

const R = System({
  name: "reachable",
  state: { count: 0 },
  think(ctx: Context) { this.count = this.count + 1; },
});

export default Sensor({
  name: "reach read", inline: true,
  onExecute(ctx: Context): number { return R.count; },
});
`,
        "plain.ts": `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "plain", inline: true,
  onExecute(ctx: Context): number { return 7; },
});
`,
      },
      ["reach.ts", "plain.ts"]
    );

    // Brain that reaches the System.
    {
      const v = mkVar("reach-out");
      const { brainDef, rule } = newBrain();
      __test__appendTile(rule.do(), v as never);
      __test__appendTile(rule.do(), opAssign as never);
      __test__appendTile(rule.do(), readCount as never);
      const brain = runBrain(brainDef, 1);
      const systems = brain.getProgram()?.systems;
      assert.ok(systems && systems.size() === 1, "the reaching brain registers the System");
    }

    // Brain that reaches no System code.
    {
      const v = mkVar("plain-out");
      const { brainDef, rule } = newBrain();
      __test__appendTile(rule.do(), v as never);
      __test__appendTile(rule.do(), opAssign as never);
      __test__appendTile(rule.do(), plain as never);
      const brain = runBrain(brainDef, 1);
      const systems = brain.getProgram()?.systems;
      assert.ok(systems === undefined || systems.size() === 0, "a non-reaching brain registers no System");
    }
  });

  test("a malformed System config reports a diagnostic rather than failing silently", () => {
    // `init` as a named-function reference (not a method/inline function).
    expectLoweringDiagnostic(
      `
import { System, Sensor, type Context } from "mindcraft";
function setup(ctx: Context): void {}
const S = System({ name: "s", state: { count: 0 }, init: setup });
export default Sensor({ name: "t1", onExecute(ctx: Context): number { return S.count; } });
`,
      LoweringDiagCode.SystemLifecycleNotFunction
    );

    // A config member that is not a method.
    expectLoweringDiagnostic(
      `
import { System, Sensor, type Context } from "mindcraft";
const S = System({ name: "s", state: { count: 0 }, speed: 5 });
export default Sensor({ name: "t2", onExecute(ctx: Context): number { return S.count; } });
`,
      LoweringDiagCode.SystemMemberNotMethod
    );

    // An empty state shape cannot be lowered to a struct.
    expectLoweringDiagnostic(
      `
import { System, Sensor, type Context } from "mindcraft";
const S = System({ name: "s", state: {}, think() {} });
export default Sensor({ name: "t3", onExecute(ctx: Context): number { return 0; } });
`,
      LoweringDiagCode.SystemStateUnresolvable
    );

    // `name` provided as a non-literal expression.
    expectLoweringDiagnostic(
      `
import { System, Sensor, type Context } from "mindcraft";
const label: string = "s";
const S = System({ name: label, state: { count: 0 } });
export default Sensor({ name: "t4", onExecute(ctx: Context): number { return S.count; } });
`,
      LoweringDiagCode.SystemNameNotStringLiteral
    );

    // An external System method read as a value (not called).
    expectLoweringDiagnostic(
      `
import { System, Sensor, type Context } from "mindcraft";
const S = System({ name: "s", state: { count: 0 }, drive() { this.count = 1; } });
export default Sensor({ name: "t5", onExecute(ctx: Context): number { const f = S.drive; f; return S.count; } });
`,
      LoweringDiagCode.SystemMethodUsedAsValue
    );

    // A sibling System method read as a value inside a method body.
    expectLoweringDiagnostic(
      `
import { System, Sensor, type Context } from "mindcraft";
const S = System({ name: "s", state: { count: 0 }, drive() { this.count = 1; }, go() { const f = this.drive; f; } });
export default Sensor({ name: "t6", onExecute(ctx: Context): number { return S.count; } });
`,
      LoweringDiagCode.SystemMethodUsedAsValue
    );
  });

  test("cross-module: an imported System body may reference its defining module's const and function", () => {
    // The System's `think` references BOTH a module-level `const` (BASE) and a
    // module-level `function` (bump) declared beside it in lib/dev.ts, and bump
    // itself references BASE (a transitive helper reference). A tile in a
    // DIFFERENT module imports the System and reads the thinked value.
    const [readValue] = compileTiles(
      {
        "lib/dev.ts": `
import { System, type Context } from "mindcraft";

const BASE = 20;
function bump(n: number): number { return n + BASE + 7; }

export const Dev = System({
  name: "dev",
  state: { value: 0 },
  think(ctx: Context) { this.value = bump(0); },
});
`,
        "tiles/read-value.ts": `
import { Sensor, type Context } from "mindcraft";
import { Dev } from "../lib/dev";

export default Sensor({
  name: "dev read value", inline: true,
  onExecute(ctx: Context): number { return Dev.value; },
});
`,
      },
      ["tiles/read-value.ts"]
    );

    const v = mkVar("dev-out");
    const { brainDef, rule } = newBrain();
    __test__appendTile(rule.do(), v as never);
    __test__appendTile(rule.do(), opAssign as never);
    __test__appendTile(rule.do(), readValue as never);
    const brain = runBrain(brainDef, 2);
    // think sets value = bump(0) = 0 + BASE(20) + 7 = 27; tick2 reads it back.
    assert.equal(
      num(brain, v.varName),
      27,
      "the const (20) and function (+7) both round-trip across the module boundary"
    );
  });

  test("cross-module: a System body may reference its defining module's exported const", () => {
    // An `export`ed module-level const referenced by a System `think` is inlined
    // at the reference site the same as a non-exported one; its per-callsite slot
    // is not bound in the System fiber.
    const [readValue] = compileTiles(
      {
        "lib/rate.ts": `
import { System, type Context } from "mindcraft";

export const RATE = 6;

export const Rated = System({
  name: "rated",
  state: { total: 0 },
  think(ctx: Context) { this.total = this.total + RATE; },
});
`,
        "tiles/read-rate.ts": `
import { Sensor, type Context } from "mindcraft";
import { Rated } from "../lib/rate";

export default Sensor({
  name: "rated read", inline: true,
  onExecute(ctx: Context): number { return Rated.total; },
});
`,
      },
      ["tiles/read-rate.ts"]
    );

    const v = mkVar("rate-out");
    const { brainDef, rule } = newBrain();
    __test__appendTile(rule.do(), v as never);
    __test__appendTile(rule.do(), opAssign as never);
    __test__appendTile(rule.do(), readValue as never);
    const brain = runBrain(brainDef, 3);
    // think adds RATE(6) each tick; reads lag one tick: 0, 6, 12.
    assert.equal(num(brain, v.varName), 12, "the exported const inlines and accumulates in the System fiber");
  });

  test("cross-module module-level refs: two importing modules, two brains, both correct", () => {
    // Real multiplicity: the same System is imported by two tiles in two
    // different modules and exercised in two independent brains. Both must
    // resolve the defining module's `const`/`function` and read equal values.
    const [readA, readB] = compileTiles(
      {
        "lib/arb.ts": `
import { System, type Context } from "mindcraft";

const STEP = 4;
function scale(n: number): number { return n * STEP; }

export const Arb = System({
  name: "arb",
  state: { total: 0 },
  think(ctx: Context) { this.total = this.total + scale(1); },
});
`,
        "tiles/a.ts": `
import { Sensor, type Context } from "mindcraft";
import { Arb } from "../lib/arb";
export default Sensor({ name: "arb read a", inline: true, onExecute(ctx: Context): number { return Arb.total; } });
`,
        "tiles/b.ts": `
import { Sensor, type Context } from "mindcraft";
import { Arb } from "../lib/arb";
export default Sensor({ name: "arb read b", inline: true, onExecute(ctx: Context): number { return Arb.total; } });
`,
      },
      ["tiles/a.ts", "tiles/b.ts"]
    );

    // Brain 1 uses reader A.
    {
      const v = mkVar("arb-a");
      const { brainDef, rule } = newBrain();
      __test__appendTile(rule.do(), v as never);
      __test__appendTile(rule.do(), opAssign as never);
      __test__appendTile(rule.do(), readA as never);
      const brain = runBrain(brainDef, 3);
      // think adds scale(1)=STEP(4) each tick; reads lag one tick: 0,4,8.
      assert.equal(num(brain, "arb-a"), 8, "brain 1 accumulates STEP each think");
      const systems = brain.getProgram()?.systems;
      assert.ok(systems && systems.size() === 1, "brain 1 registers exactly one System");
    }

    // Brain 2 uses reader B (a different importing module).
    {
      const v = mkVar("arb-b");
      const { brainDef, rule } = newBrain();
      __test__appendTile(rule.do(), v as never);
      __test__appendTile(rule.do(), opAssign as never);
      __test__appendTile(rule.do(), readB as never);
      const brain = runBrain(brainDef, 3);
      assert.equal(num(brain, "arb-b"), 8, "brain 2 (second importing module) reads the same climbing total");
      const systems = brain.getProgram()?.systems;
      assert.ok(systems && systems.size() === 1, "brain 2 registers exactly one System");
    }
  });

  test("cross-module: a System body reference to a non-carryable module binding reports a precise diagnostic", () => {
    // A module-level `let` in the defining module cannot be carried into an
    // importer (mutable per-callsite module state has no brain-global meaning in
    // a System body). The reference must produce a precise diagnostic anchored
    // to the offending identifier, not a raw "Undefined variable".
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const project = new UserTileProject({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    project.setFiles(
      new Map([
        [
          "lib/bad.ts",
          `
import { System, type Context } from "mindcraft";
let counter = 0;
export const Bad = System({
  name: "bad",
  state: { value: 0 },
  think(ctx: Context) { this.value = counter; },
});
`,
        ],
        [
          "tiles/use-bad.ts",
          `
import { Sensor, type Context } from "mindcraft";
import { Bad } from "../lib/bad";
export default Sensor({ name: "use bad", onExecute(ctx: Context): number { return Bad.value; } });
`,
        ],
      ])
    );
    const result = project.compileAll();
    assert.equal(result.tsErrors.size, 0, `unexpected TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("tiles/use-bad.ts");
    assert.ok(entry, "expected a result for tiles/use-bad.ts");
    const codes = entry!.diagnostics.map((d) => d.code);
    expectDiagnostic(entry!.diagnostics, LoweringDiagCode.SystemModuleReferenceNotCarryable);
    assert.ok(
      !codes.includes(LoweringDiagCode.UndefinedVariable),
      "must not surface a raw Undefined variable diagnostic"
    );
  });

  test("cross-module: a System body reference to a non-exported module enum reports a precise diagnostic", () => {
    // A non-exported enum in the defining module cannot be carried into an
    // importer (only `const` values and `function` declarations are). The
    // reference must produce a precise diagnostic, not a raw "Undefined variable".
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const project = new UserTileProject({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    project.setFiles(
      new Map([
        [
          "lib/mode.ts",
          `
import { System, type Context } from "mindcraft";
enum Mode { Idle = 0, Run = 1 }
export const Machine = System({
  name: "machine",
  state: { value: 0 },
  think(ctx: Context) { this.value = Mode.Run; },
});
`,
        ],
        [
          "tiles/use-mode.ts",
          `
import { Sensor, type Context } from "mindcraft";
import { Machine } from "../lib/mode";
export default Sensor({ name: "use mode", onExecute(ctx: Context): number { return Machine.value; } });
`,
        ],
      ])
    );
    const result = project.compileAll();
    assert.equal(result.tsErrors.size, 0, `unexpected TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const entry = result.results.get("tiles/use-mode.ts");
    assert.ok(entry, "expected a result for tiles/use-mode.ts");
    const codes = entry!.diagnostics.map((d) => d.code);
    expectDiagnostic(entry!.diagnostics, LoweringDiagCode.SystemModuleReferenceNotCarryable);
    assert.ok(
      !codes.includes(LoweringDiagCode.UndefinedVariable),
      "must not surface a raw Undefined variable diagnostic"
    );
  });

  test("co-located: a System referencing a module const (direct and via a local helper) runs", () => {
    // The System and its consuming tile live in ONE module. `init` reads a
    // module-level `const` directly; `think` reads it through a local helper
    // function. Both must resolve in the System fiber (no runtime fault).
    const [readValue] = compileTiles(
      {
        "colocated.ts": `
import { System, Sensor, type Context } from "mindcraft";

const RATE = 6;
function scaled(): number { return RATE * 2; }

const Sys = System({
  name: "colocated",
  state: { total: 0 },
  init(ctx: Context) { this.total = RATE; },
  think(ctx: Context) { this.total = this.total + scaled(); },
});

export default Sensor({
  name: "colocated read", inline: true,
  onExecute(ctx: Context): number { return Sys.total; },
});
`,
      },
      ["colocated.ts"]
    );

    const v = mkVar("colocated-out");
    const { brainDef, rule } = newBrain();
    __test__appendTile(rule.do(), v as never);
    __test__appendTile(rule.do(), opAssign as never);
    __test__appendTile(rule.do(), readValue as never);
    const brain = runBrain(brainDef, 3);
    // init sets total = RATE(6); each think adds scaled() = RATE*2 = 12. Reads lag
    // one tick: think1 reads 6, think2 reads 18, think3 reads 30.
    assert.equal(
      num(brain, v.varName),
      30,
      "co-located const (direct + via a local helper) inlines in the System fiber"
    );
  });

  test("a System reference to a non-primitive module const reports a precise diagnostic", () => {
    // A module-level `const` holding an object cannot be reproduced inline (each
    // reference would build a distinct instance). Referencing it from a System
    // reports a precise diagnostic, not a runtime fault and not a raw 3010.
    expectLoweringDiagnostic(
      `
import { System, Sensor, type Context } from "mindcraft";
const CFG = { addr: 16 };
const Sys = System({ name: "s", state: { v: 0 }, think(ctx: Context) { this.v = CFG.addr; } });
export default Sensor({ name: "t", onExecute(ctx: Context): number { return Sys.v; } });
`,
      LoweringDiagCode.SystemModuleReferenceNotCarryable
    );
  });

  test("two modules with a same-named private helper, both reached by one tile, do not collide", () => {
    // Each module's System references its OWN private `fmt`. Both are carried into
    // the importing tile; the identity key keeps them distinct so each System's
    // `fmt` resolves to the right helper (no Duplicate imported symbol error).
    const [readAB] = compileTiles(
      {
        "mods/a.ts": `
import { System, type Context } from "mindcraft";
function fmt(n: number): number { return n + 1; }
export const A = System({ name: "a", state: { v: 0 }, think(ctx: Context) { this.v = fmt(0); } });
`,
        "mods/b.ts": `
import { System, type Context } from "mindcraft";
function fmt(n: number): number { return n + 2; }
export const B = System({ name: "b", state: { v: 0 }, think(ctx: Context) { this.v = fmt(0); } });
`,
        "tiles/read-ab.ts": `
import { Sensor, type Context } from "mindcraft";
import { A } from "../mods/a";
import { B } from "../mods/b";
export default Sensor({ name: "read ab", inline: true, onExecute(ctx: Context): number { return A.v + B.v; } });
`,
      },
      ["tiles/read-ab.ts"]
    );

    const v = mkVar("ab-out");
    const { brainDef, rule } = newBrain();
    __test__appendTile(rule.do(), v as never);
    __test__appendTile(rule.do(), opAssign as never);
    __test__appendTile(rule.do(), readAB as never);
    const brain = runBrain(brainDef, 2);
    // A.think -> A.v = fmt_a(0) = 1; B.think -> B.v = fmt_b(0) = 2; tile reads 1 + 2 = 3.
    assert.equal(num(brain, v.varName), 3, "each System's private fmt resolves to its own module's helper");
  });

  test("an exported helper called by a System reads its module's private const", () => {
    // The System's `think` calls an exported `helper` whose body reads a
    // non-exported `const`. The private const is carried and inlined so it
    // resolves when `helper` runs in the System fiber.
    const [readValue] = compileTiles(
      {
        "lib/dev.ts": `
import { System, type Context } from "mindcraft";
const SECRET = 9;
export function helper(): number { return SECRET; }
export const Dev = System({
  name: "dev",
  state: { v: 0 },
  think(ctx: Context) { this.v = helper(); },
});
`,
        "tiles/read.ts": `
import { Sensor, type Context } from "mindcraft";
import { Dev } from "../lib/dev";
export default Sensor({ name: "dev read", inline: true, onExecute(ctx: Context): number { return Dev.v; } });
`,
      },
      ["tiles/read.ts"]
    );

    const v = mkVar("helper-const-out");
    const { brainDef, rule } = newBrain();
    __test__appendTile(rule.do(), v as never);
    __test__appendTile(rule.do(), opAssign as never);
    __test__appendTile(rule.do(), readValue as never);
    const brain = runBrain(brainDef, 2);
    // think sets v = helper() = SECRET(9); tick2 reads it back.
    assert.equal(num(brain, v.varName), 9, "the private const inside the exported helper resolves in the System fiber");
  });

  test("an exported function reading its module's private const works in ordinary tile code", () => {
    // No System involved: an imported exported `compute` reads a non-exported
    // `const`. The private const is carried so the re-lowered `compute` resolves
    // it.
    const [readValue] = compileTiles(
      {
        "lib/calc.ts": `
const SECRET = 5;
export function compute(): number { return SECRET + 1; }
`,
        "tiles/use.ts": `
import { Sensor, type Context } from "mindcraft";
import { compute } from "../lib/calc";
export default Sensor({ name: "use compute", inline: true, onExecute(ctx: Context): number { return compute(); } });
`,
      },
      ["tiles/use.ts"]
    );

    const v = mkVar("compute-out");
    const { brainDef, rule } = newBrain();
    __test__appendTile(rule.do(), v as never);
    __test__appendTile(rule.do(), opAssign as never);
    __test__appendTile(rule.do(), readValue as never);
    const brain = runBrain(brainDef, 1);
    assert.equal(
      num(brain, v.varName),
      6,
      "the private const inside the exported function resolves in ordinary tile code"
    );
  });

  test("an exported helper reading an exported const, called by a System, resolves in the System fiber", () => {
    // The System reaches the exported `const` one hop through an exported
    // `helper`; the strict System pass traverses the helper and inlines the const
    // so it resolves in the System fiber (no runtime fault).
    const [readValue] = compileTiles(
      {
        "lib/rate.ts": `
import { System, type Context } from "mindcraft";
export const RATE = 7;
export function helper(): number { return RATE; }
export const Sys = System({
  name: "s",
  state: { v: 0 },
  think(ctx: Context) { this.v = helper(); },
});
`,
        "tiles/read.ts": `
import { Sensor, type Context } from "mindcraft";
import { Sys } from "../lib/rate";
export default Sensor({ name: "read", inline: true, onExecute(ctx: Context): number { return Sys.v; } });
`,
      },
      ["tiles/read.ts"]
    );

    const v = mkVar("rate-via-helper-out");
    const { brainDef, rule } = newBrain();
    __test__appendTile(rule.do(), v as never);
    __test__appendTile(rule.do(), opAssign as never);
    __test__appendTile(rule.do(), readValue as never);
    const brain = runBrain(brainDef, 2);
    // think sets v = helper() = RATE(7); tick2 reads it back.
    assert.equal(
      num(brain, v.varName),
      7,
      "the exported const reached through an exported helper inlines in the System fiber"
    );
  });

  test("cross-module const reachability: a co-located System reads a const imported into its own module", () => {
    // The System lives in the entry tile module and reads a `const` imported from
    // another module. The const (defined in a third file) must inline in the
    // System fiber even though it is foreign to the System's module.
    const [readValue] = compileTiles(
      {
        "lib/config.ts": `export const SPEED = 42;`,
        "tile.ts": `
import { System, Sensor, type Context } from "mindcraft";
import { SPEED } from "./lib/config";
const Sys = System({ name: "s", state: { v: 0 }, think(ctx: Context) { this.v = SPEED; } });
export default Sensor({ name: "read", inline: true, onExecute(ctx: Context): number { return Sys.v; } });
`,
      },
      ["tile.ts"]
    );
    const v = mkVar("xmod-local-out");
    const { brainDef, rule } = newBrain();
    __test__appendTile(rule.do(), v as never);
    __test__appendTile(rule.do(), opAssign as never);
    __test__appendTile(rule.do(), readValue as never);
    const brain = runBrain(brainDef, 2);
    assert.equal(num(brain, v.varName), 42, "a const imported into the System's module inlines in the System fiber");
  });

  test("cross-module const reachability: an imported System reaches a const in a third module", () => {
    // The System's own module imports the const from a third module; the const
    // must inline in the System fiber across both module hops.
    const [readValue] = compileTiles(
      {
        "lib/cfg.ts": `export const SPEED = 55;`,
        "lib/mv.ts": `
import { System, type Context } from "mindcraft";
import { SPEED } from "./cfg";
export const Mv = System({ name: "mv", state: { v: 0 }, think(ctx: Context) { this.v = SPEED; } });
`,
        "tile.ts": `
import { Sensor, type Context } from "mindcraft";
import { Mv } from "./lib/mv";
export default Sensor({ name: "read", inline: true, onExecute(ctx: Context): number { return Mv.v; } });
`,
      },
      ["tile.ts"]
    );
    const v = mkVar("xmod-third-out");
    const { brainDef, rule } = newBrain();
    __test__appendTile(rule.do(), v as never);
    __test__appendTile(rule.do(), opAssign as never);
    __test__appendTile(rule.do(), readValue as never);
    const brain = runBrain(brainDef, 2);
    assert.equal(num(brain, v.varName), 55, "a third-module const inlines in the System fiber across module hops");
  });

  test("an ambient global (Math) used inside a System body resolves", () => {
    // Whole-program reference resolution must leave ambient (.d.ts) bindings to
    // their own machinery; a `Math` call in a System `think` runs, not diagnosed.
    const [readValue] = compileTiles(
      {
        "tile.ts": `
import { System, Sensor, type Context } from "mindcraft";
const Sys = System({ name: "s", state: { v: 0 }, think(ctx: Context) { this.v = Math.max(3, 7); } });
export default Sensor({ name: "read", inline: true, onExecute(ctx: Context): number { return Sys.v; } });
`,
      },
      ["tile.ts"]
    );
    const v = mkVar("ambient-out");
    const { brainDef, rule } = newBrain();
    __test__appendTile(rule.do(), v as never);
    __test__appendTile(rule.do(), opAssign as never);
    __test__appendTile(rule.do(), readValue as never);
    const brain = runBrain(brainDef, 2);
    assert.equal(num(brain, v.varName), 7, "an ambient global resolves in a System body");
  });

  test("a non-primitive const reached THROUGH a helper into a System reports a precise diagnostic", () => {
    // The strict System pass traverses the exported helper and catches the
    // non-primitive const one hop away -- a diagnostic, not a runtime fault.
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const project = new UserTileProject({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    project.setFiles(
      new Map([
        [
          "lib.ts",
          `
import { System, type Context } from "mindcraft";
const CFG = { addr: 5 };
export function h(): number { return CFG.addr; }
export const Sys = System({ name: "s", state: { v: 0 }, think(ctx: Context) { this.v = h(); } });
`,
        ],
        [
          "tile.ts",
          `
import { Sensor, type Context } from "mindcraft";
import { Sys } from "./lib";
export default Sensor({ name: "r", onExecute(ctx: Context): number { return Sys.v; } });
`,
        ],
      ])
    );
    const result = project.compileAll();
    assert.equal(result.tsErrors.size, 0, `unexpected TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const diagnostics = result.results.get("tile.ts")!.diagnostics;
    const codes = diagnostics.map((d) => d.code);
    expectDiagnostic(diagnostics, LoweringDiagCode.SystemModuleReferenceNotCarryable);
    assert.ok(!codes.includes(LoweringDiagCode.UndefinedVariable), "must not surface a raw Undefined variable");
  });

  test("a module `let` reached THROUGH a called function into a System reports a precise diagnostic", () => {
    // The `let` boundary must fire transitively: the System calls a helper whose
    // body reads a module-level `let`. Diagnosed, not a silent fault.
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const project = new UserTileProject({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
    });
    project.setFiles(
      new Map([
        [
          "lib.ts",
          `
import { System, type Context } from "mindcraft";
let counter = 0;
function step(): number { return counter; }
export const Sys = System({ name: "s", state: { v: 0 }, think(ctx: Context) { this.v = step(); } });
`,
        ],
        [
          "tile.ts",
          `
import { Sensor, type Context } from "mindcraft";
import { Sys } from "./lib";
export default Sensor({ name: "r", onExecute(ctx: Context): number { return Sys.v; } });
`,
        ],
      ])
    );
    const result = project.compileAll();
    assert.equal(result.tsErrors.size, 0, `unexpected TS errors: ${JSON.stringify([...result.tsErrors])}`);
    const diagnostics = result.results.get("tile.ts")!.diagnostics;
    const codes = diagnostics.map((d) => d.code);
    expectDiagnostic(diagnostics, LoweringDiagCode.SystemModuleReferenceNotCarryable);
    assert.ok(!codes.includes(LoweringDiagCode.UndefinedVariable), "must not surface a raw Undefined variable");
  });
});
