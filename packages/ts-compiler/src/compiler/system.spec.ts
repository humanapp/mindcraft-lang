import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { type BrainServices, mkVariableTileId } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
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
  const project = new UserTileProject({ ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }], services });
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
  const project = new UserTileProject({ ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }], services });
  project.setFiles(new Map([["tile.ts", source]]));
  const result = project.compileAll();
  assert.equal(result.tsErrors.size, 0, `unexpected TS errors: ${JSON.stringify([...result.tsErrors])}`);
  const entry = result.results.get("tile.ts");
  assert.ok(entry, "expected a result for tile.ts");
  const codes = entry!.diagnostics.map((d) => d.code);
  assert.ok(codes.includes(code), `expected diagnostic ${code}, got ${JSON.stringify(entry!.diagnostics)}`);
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
  name: "read count",
  onExecute(ctx: Context): number { return Counter.count; },
});
`,
      },
      ["counter.ts"]
    );

    const v = mkVar("count-out");
    // Each tick: the rule reads count into the var, THEN the System think increments.
    const { brainDef, rule } = newBrain();
    rule.do().appendTile(v as never);
    rule.do().appendTile(opAssign as never);
    rule.do().appendTile(readCount as never);
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
  name: "acc add and read",
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
    rule.do().appendTile(v as never);
    rule.do().appendTile(opAssign as never);
    rule.do().appendTile(accAndRead as never);
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
  name: "helpers read",
  onExecute(ctx: Context): number { return Acc.count; },
});
`,
      },
      ["helpers.ts"]
    );

    const v = mkVar("helpers-out");
    const { brainDef, rule } = newBrain();
    rule.do().appendTile(v as never);
    rule.do().appendTile(opAssign as never);
    rule.do().appendTile(readCount as never);
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
  name: "counter read a",
  onExecute(ctx: Context): number { return Counter.count; },
});
`,
        "tiles/read-b.ts": `
import { Sensor, type Context } from "mindcraft";
import { Counter } from "../lib/movement";

export default Sensor({
  name: "counter read b",
  onExecute(ctx: Context): number { return Counter.count; },
});
`,
      },
      ["tiles/read-a.ts", "tiles/read-b.ts"]
    );

    const outA = mkVar("xmod-a");
    const outB = mkVar("xmod-b");
    const { brainDef, rule } = newBrain();
    rule.do().appendTile(outA as never);
    rule.do().appendTile(opAssign as never);
    rule.do().appendTile(readA as never);
    const child = rule.appendNewRule();
    child.do().appendTile(outB as never);
    child.do().appendTile(opAssign as never);
    child.do().appendTile(readB as never);

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
  name: "read ticker",
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
    rule0.do().appendTile(v0 as never);
    rule0.do().appendTile(opAssign as never);
    rule0.do().appendTile(readCount as never);

    const p1 = brainDef.appendNewPage();
    assert.ok(p1.success);
    const rule1 = p1.value!.page.children().get(0)!;
    rule1.do().appendTile(v1 as never);
    rule1.do().appendTile(opAssign as never);
    rule1.do().appendTile(readCount as never);

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
  name: "read named",
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
    rule.do().appendTile(counterVar as never);
    rule.do().appendTile(opAssign as never);
    rule.do().appendTile(mkLiteral(7) as never);
    const child = rule.appendNewRule();
    child.do().appendTile(sysOut as never);
    child.do().appendTile(opAssign as never);
    child.do().appendTile(readCount as never);

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
  name: "reach read",
  onExecute(ctx: Context): number { return R.count; },
});
`,
        "plain.ts": `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "plain",
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
      rule.do().appendTile(v as never);
      rule.do().appendTile(opAssign as never);
      rule.do().appendTile(readCount as never);
      const brain = runBrain(brainDef, 1);
      const systems = brain.getProgram()?.systems;
      assert.ok(systems && systems.size() === 1, "the reaching brain registers the System");
    }

    // Brain that reaches no System code.
    {
      const v = mkVar("plain-out");
      const { brainDef, rule } = newBrain();
      rule.do().appendTile(v as never);
      rule.do().appendTile(opAssign as never);
      rule.do().appendTile(plain as never);
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
});
