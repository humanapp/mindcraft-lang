import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ReadonlyList } from "@mindcraft-lang/core";
import {
  coreModule,
  createMindcraftEnvironment,
  type MindcraftEnvironment,
  type MindcraftModule,
} from "@mindcraft-lang/core";
import { type BrainServices, LinkDiagCode, RuleSide, TilePlacement } from "@mindcraft-lang/core/brain";
import type { BrainBuildDiagnostic, BrainBuildResult } from "@mindcraft-lang/core/brain/compiler";
import { CompilationDiagCode } from "@mindcraft-lang/core/brain/compiler";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import {
  CoreTypeIds,
  type IRngServices,
  linkedBrainProgramToJson,
  mkCallDef,
  TRUE_VALUE,
} from "@mindcraft-lang/core/runtime";

function makeSeededRng(seed: number): IRngServices {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    },
  };
}

function getEnvironmentServices(environment: MindcraftEnvironment): BrainServices {
  return (environment as unknown as { brainServices: BrainServices }).brainServices;
}

function getTrackedBrainCount(environment: MindcraftEnvironment): number {
  return (environment as unknown as { trackedBrains: { size(): number } }).trackedBrains.size();
}

function createHostSensorModule(moduleId: string, key: string): { module: MindcraftModule; tile: BrainTileSensorDef } {
  const sensorCallDef = mkCallDef({ type: "bag", items: [] });
  const descriptor = {
    key,
    kind: "sensor" as const,
    callDef: sensorCallDef,
    isAsync: false,
    outputType: CoreTypeIds.Boolean,
  };
  const tile = new BrainTileSensorDef(key, descriptor, {
    placement: TilePlacement.EitherSide | TilePlacement.Inline,
  });

  return {
    tile,
    module: {
      id: moduleId,
      install(api): void {
        api.registerHostSensor({
          descriptor,
          actionId: 3501,
          function: {
            id: 4501,
            name: key,
            isAsync: false,
            fn: { exec: () => TRUE_VALUE },
            callDef: sensorCallDef,
          },
          actionFn: { exec: () => TRUE_VALUE },
          tile,
        });
      },
    },
  };
}

function createSensorBrainDef(services: BrainServices, name: string, sensorTile: BrainTileSensorDef): BrainDef {
  const brainDef = BrainDef.emptyBrainDef(services, name);
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(sensorTile);
  return brainDef;
}

describe("MindcraftEnvironment.linkBrain", () => {
  test("returns the linked program createBrain produces for an empty brain", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const def = BrainDef.emptyBrainDef(getEnvironmentServices(environment), "Empty");

    const result = environment.linkBrain(def);
    const brain = environment.createBrain(def);

    assert.equal(result.diagnostics.size(), 0);
    assert.deepEqual(result.program!.program, brain.getProgram());
    assert.deepEqual(result.program!.pages, brain.getPages());
  });

  test("returns the linked program createBrain produces for a sensor brain", () => {
    const sensor = createHostSensorModule("host-sensor", "host.sensor");
    const environment = createMindcraftEnvironment({ modules: [coreModule(), sensor.module] });
    const def = createSensorBrainDef(getEnvironmentServices(environment), "Sensor", sensor.tile);

    const result = environment.linkBrain(def);
    const brain = environment.createBrain(def);

    assert.equal(result.diagnostics.size(), 0);
    assert.deepEqual(result.program!.program, brain.getProgram());
    assert.deepEqual(result.program!.pages, brain.getPages());
  });

  test("does not construct or track a runtime brain", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const def = BrainDef.emptyBrainDef(getEnvironmentServices(environment), "Untracked");

    const before = getTrackedBrainCount(environment);
    const result = environment.linkBrain(def);

    assert.equal(getTrackedBrainCount(environment), before);
    assert.ok(result.program);
  });

  test("returns a diagnostic instead of throwing when an action cannot be resolved", () => {
    const sensor = createHostSensorModule("host-sensor", "host.sensor");
    const withSensor = createMindcraftEnvironment({ modules: [coreModule(), sensor.module] });
    const withoutSensor = createMindcraftEnvironment({ modules: [coreModule()] });
    const def = createSensorBrainDef(getEnvironmentServices(withSensor), "Sensor", sensor.tile);

    const result = withoutSensor.linkBrain(def);

    assert.equal(result.program, undefined);
    assert.equal(result.diagnostics.size(), 1);
    assert.equal(result.diagnostics.get(0)!.code, LinkDiagCode.MissingActionBinding);
    assert.ok(result.diagnostics.get(0)!.message.includes("host.sensor"));
  });

  test("createBrain of a def missing an action returns a tracked, invalidated brain", () => {
    const sensor = createHostSensorModule("host-sensor", "host.sensor");
    const withSensor = createMindcraftEnvironment({ modules: [coreModule(), sensor.module] });
    const withoutSensor = createMindcraftEnvironment({ modules: [coreModule()] });
    const def = createSensorBrainDef(getEnvironmentServices(withSensor), "Sensor", sensor.tile);

    const brain = withoutSensor.createBrain(def);
    assert.equal(brain.status, "invalidated");
    assert.equal(brain.getProgram(), undefined);
    // A born-invalidated brain is safe to operate as a no-op until it rebuilds.
    brain.events();
    brain.startup();
    brain.think(0);
  });
});

/** Diagnostics in `result` whose code is {@link CompilationDiagCode.UncompilableExpressionDropped}. */
function droppedExpressionDiags(result: { diagnostics: ReadonlyList<BrainBuildDiagnostic> }): BrainBuildDiagnostic[] {
  const out: BrainBuildDiagnostic[] = [];
  for (let i = 0; i < result.diagnostics.size(); i++) {
    const diag = result.diagnostics.get(i)!;
    if (diag.code === CompilationDiagCode.UncompilableExpressionDropped) {
      out.push(diag);
    }
  }
  return out;
}

/** Error-severity diagnostics in `result`. */
function errorDiags(result: { diagnostics: ReadonlyList<BrainBuildDiagnostic> }): BrainBuildDiagnostic[] {
  const out: BrainBuildDiagnostic[] = [];
  for (let i = 0; i < result.diagnostics.size(); i++) {
    const diag = result.diagnostics.get(i)!;
    if (diag.severity === "error") {
      out.push(diag);
    }
  }
  return out;
}

/**
 * Reopens a brain built against `sensorTile` in an environment that does not
 * have the tile, which resolves the placement to a `missing` placeholder --
 * the state a document reaches once the tile's defining source is deleted.
 */
function reopenWithoutSensor(side: RuleSide): { result: BrainBuildResult; tileId: string } {
  const sensor = createHostSensorModule("host-sensor", "host.sensor");
  const withSensor = createMindcraftEnvironment({ modules: [coreModule(), sensor.module] });
  const withoutSensor = createMindcraftEnvironment({ modules: [coreModule()] });
  const def = BrainDef.emptyBrainDef(getEnvironmentServices(withSensor), "Sensor");
  const rule = def.pages().get(0)!.children().get(0)!;
  const tileSet = side === RuleSide.When ? rule.when() : rule.do();
  tileSet.appendTile(sensor.tile);

  const reopened = withoutSensor.deserializeBrainJson(def.toJson());
  return { result: withoutSensor.linkBrain(reopened), tileId: sensor.tile.tileId };
}

describe("linkBrain reports expressions code generation drops", () => {
  test("a missing WHEN tile still links and carries the dropped-expression diagnostic", () => {
    const { result, tileId } = reopenWithoutSensor(RuleSide.When);

    assert.ok(result.program, "the brain still links over the unresolved placement");
    assert.deepEqual(errorDiags(result), [], "the degraded build reports no error-severity diagnostic");

    const dropped = droppedExpressionDiags(result);
    assert.equal(dropped.length, 1, "the dropped WHEN expression is reported exactly once");
    assert.equal(dropped[0]!.severity, "warning");
    assert.ok(dropped[0]!.message.includes(tileId), "the diagnostic names the unresolved tile id");
    assert.ok(dropped[0]!.message.includes("0/0"), "the diagnostic names the rule path");
    assert.ok(dropped[0]!.message.includes("WHEN"), "the diagnostic names the rule side");
  });

  test("a missing DO tile still links and carries the dropped-expression diagnostic", () => {
    const { result, tileId } = reopenWithoutSensor(RuleSide.Do);

    assert.ok(result.program);
    assert.deepEqual(errorDiags(result), []);

    const dropped = droppedExpressionDiags(result);
    assert.equal(dropped.length, 1);
    assert.ok(dropped[0]!.message.includes(tileId));
    assert.ok(dropped[0]!.message.includes("DO"), "the diagnostic names the rule side");
  });

  test("an expression after the side's first expression is reported as dropped", () => {
    const sensor = createHostSensorModule("host-sensor", "host.sensor");
    const environment = createMindcraftEnvironment({ modules: [coreModule(), sensor.module] });
    const def = BrainDef.emptyBrainDef(getEnvironmentServices(environment), "TwoExprs");
    const rule = def.pages().get(0)!.children().get(0)!;
    rule.do().appendTile(sensor.tile);
    rule.do().appendTile(sensor.tile);

    const result = environment.linkBrain(def);

    assert.ok(result.program, "the rule still links with its first expression compiled");
    const dropped = droppedExpressionDiags(result);
    assert.equal(dropped.length, 1, "the discarded second expression is reported once");
    assert.ok(dropped[0]!.message.includes(sensor.tile.tileId));
  });

  test("a brain whose tiles all resolve reports no dropped expression", () => {
    const sensor = createHostSensorModule("host-sensor", "host.sensor");
    const environment = createMindcraftEnvironment({ modules: [coreModule(), sensor.module] });
    const def = createSensorBrainDef(getEnvironmentServices(environment), "Sensor", sensor.tile);

    const result = environment.linkBrain(def);

    assert.ok(result.program);
    assert.deepEqual(droppedExpressionDiags(result), []);
  });
});

describe("linked program serialization determinism", () => {
  function buildSensorProgramJson(seed: number) {
    const sensor = createHostSensorModule("host-sensor", "host.sensor");
    const environment = createMindcraftEnvironment({
      modules: [coreModule(), sensor.module],
      rng: makeSeededRng(seed),
    });
    const def = createSensorBrainDef(getEnvironmentServices(environment), "Sensor", sensor.tile);
    const result = environment.linkBrain(def);
    assert.ok(result.program);
    return linkedBrainProgramToJson(result.program);
  }

  test("two builds of the same brain with the same seed serialize identically", () => {
    assert.deepEqual(buildSensorProgramJson(1234), buildSensorProgramJson(1234));
  });

  test("a different seed yields a different page id", () => {
    const first = buildSensorProgramJson(1234);
    const other = buildSensorProgramJson(9999);
    assert.notEqual(first.pages[0]!.pageId, other.pages[0]!.pageId);
  });

  test("an unseeded environment still mints a page id", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const def = BrainDef.emptyBrainDef(getEnvironmentServices(environment), "Empty");
    const result = environment.linkBrain(def);
    assert.ok(result.program);
    assert.ok(linkedBrainProgramToJson(result.program).pages[0]!.pageId.length > 0);
  });
});
