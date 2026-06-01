import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  coreModule,
  createMindcraftEnvironment,
  type MindcraftEnvironment,
  type MindcraftModule,
} from "@mindcraft-lang/core";
import { type BrainServices, isBrainBuildError, LinkDiagCode, TilePlacement } from "@mindcraft-lang/core/brain";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import { CoreTypeIds, mkCallDef, TRUE_VALUE } from "@mindcraft-lang/core/runtime";

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
          function: {
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

  test("createBrain throws a BrainBuildError carrying the diagnostics", () => {
    const sensor = createHostSensorModule("host-sensor", "host.sensor");
    const withSensor = createMindcraftEnvironment({ modules: [coreModule(), sensor.module] });
    const withoutSensor = createMindcraftEnvironment({ modules: [coreModule()] });
    const def = createSensorBrainDef(getEnvironmentServices(withSensor), "Sensor", sensor.tile);

    let thrown: unknown;
    try {
      withoutSensor.createBrain(def);
    } catch (err) {
      thrown = err;
    }
    if (!isBrainBuildError(thrown)) {
      assert.fail("expected a BrainBuildError");
    }
    assert.equal(thrown.diagnostics.size(), 1);
    assert.equal(thrown.diagnostics.get(0)!.code, LinkDiagCode.MissingActionBinding);
  });
});
