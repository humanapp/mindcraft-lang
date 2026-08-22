/**
 * Multi-root compilation session: a resolved set of project roots (a host
 * project plus extension-shaped roots sharing a dependency) compiles into one
 * shared registry session, each root under its own namespace. Pins the
 * per-namespace registry lifecycle (isolated recompiles, fresh-vs-warm
 * identity, teardown parity, register-if-absent, compile-history
 * independence), the cross-root shared-modifier/parameter/conversion
 * reconcile, and namespace-scoped user output keys.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BrainServices } from "@wendoo-lang/core/brain";
import { __test__createBrainServices } from "@wendoo-lang/core/brain/__test__";
import {
  CoreTypeIds,
  mkModifierTileId,
  mkOutputTileId,
  mkOutputVarKey,
  NativeType,
  type StructTypeDef,
} from "@wendoo-lang/core/runtime";
import { buildMultiRootActionBundle } from "../runtime/action-bundle.js";
import { buildAmbientDeclarations } from "./ambient.js";
import { CompileDiagCode } from "./diag-codes.js";
import type { ProjectDependency } from "./extension-mounts.js";
import { type ProjectCompileResult, UserTileProject } from "./project.js";
import { MultiRootSession, type ProjectRoot } from "./project-set.js";
import { scopedOutputName } from "./symbol-keys.js";
import type { CompileDiagnostic } from "./types.js";

const SHARED_NS = "acme/shared";
const EXT_A_NS = "acme/robot-a";
const EXT_B_NS = "acme/robot-b";
const HOST_NS = "host-store-id-0001";

const SHARED_SOURCE = `import { Sensor, StructType, NumberType, type Context } from "wendoo";

export const Pos = StructType({
  name: "Pos",
  fields: { x: NumberType, y: NumberType },
  accessors: true,
});

export default Sensor({
  name: "shared probe",
  id: "sharedProbe00001",
  returnType: Pos,
  onExecute(ctx: Context) {
    return Pos({ x: 1, y: 2 });
  },
});
`;

const EXT_A_SENSOR = `import { Sensor, StructType, NumberType, setOutput, modifier, param, optional, type Context } from "wendoo";

export const AVec = StructType({
  name: "AVec",
  fields: { x: NumberType },
});

export default Sensor({
  name: "robot-a range",
  id: "robotARange00001",
  args: [
    optional(modifier("modifier.robo.turbo", { label: "turbo" })),
    optional(param("parameter.robo.count", { type: "number" })),
  ],
  outputs: [{ name: "distance", type: "number" }],
  onExecute(ctx: Context): number {
    setOutput(ctx, "distance", 5);
    return 1;
  },
});
`;

const EXT_A_CONVERSION = `import { BufferType, Conversion, NumberType } from "wendoo";

export default Conversion({
  id: "convAnumbuf00001",
  from: NumberType,
  to: BufferType,
  cost: 2,
  convert(value: number): Buffer {
    return Buffer.from([7, value]);
  },
});
`;

const EXT_B_SENSOR = `import { Sensor, StructType, NumberType, modifier, optional, type Context } from "wendoo";

export const BVec = StructType({
  name: "BVec",
  fields: { x: NumberType },
  variables: true,
});

export enum BMode {
  On = 1,
  Off = 0,
}

export default Sensor({
  name: "robot-b probe",
  id: "robotBProbe00001",
  args: [optional(modifier("modifier.robo.turbo"))],
  onExecute(ctx: Context): number {
    return 2;
  },
});
`;

const HOST_SOURCE = `import { Sensor, setOutput, type Context } from "wendoo";

export default Sensor({
  name: "host range",
  id: "hostRange0000001",
  outputs: [{ name: "distance", type: "number" }],
  onExecute(ctx: Context): number {
    setOutput(ctx, "distance", 9);
    return 1;
  },
});
`;

function files(entries: Record<string, string>): ReadonlyMap<string, string> {
  return new Map(Object.entries(entries));
}

function dep(coordinate: string): ProjectDependency {
  return { coordinate };
}

function threeRootSet(): ProjectRoot[] {
  return [
    {
      namespace: HOST_NS,
      files: files({ "main.ts": HOST_SOURCE }),
      dependencies: [dep(EXT_A_NS), dep(EXT_B_NS)],
    },
    {
      namespace: EXT_A_NS,
      files: files({ "range.ts": EXT_A_SENSOR, "conv.ts": EXT_A_CONVERSION }),
      dependencies: [dep(SHARED_NS)],
    },
    { namespace: EXT_B_NS, files: files({ "probe.ts": EXT_B_SENSOR }), dependencies: [dep(SHARED_NS)] },
    { namespace: SHARED_NS, files: files({ "main.ts": SHARED_SOURCE }) },
  ];
}

function newSession(): { services: BrainServices; session: MultiRootSession } {
  const services = __test__createBrainServices();
  const session = new MultiRootSession({ services });
  return { services, session };
}

function allDiagnostics(result: ProjectCompileResult): CompileDiagnostic[] {
  const all: CompileDiagnostic[] = [];
  for (const [, entry] of result.results) {
    all.push(...entry.diagnostics);
  }
  for (const [, diags] of result.tsErrors) {
    all.push(...diags);
  }
  return all;
}

function assertClean(result: ProjectCompileResult, label: string): void {
  assert.deepEqual(allDiagnostics(result), [], `expected a clean compile for ${label}`);
}

describe("multi-root compilation session", () => {
  test("roots compile in dependency order, isolated per namespace, sharing one dependency", () => {
    const { services, session } = newSession();
    session.setRoots(threeRootSet());

    assert.deepEqual(session.namespaces(), [SHARED_NS, EXT_A_NS, EXT_B_NS, HOST_NS]);

    const { roots } = session.compile();
    for (const [namespace, result] of roots) {
      assertClean(result, namespace);
    }

    const types = services.runtime.types;
    const posTypeId = types.resolveByName(`${SHARED_NS}:/main.ts::Pos`);
    assert.ok(posTypeId, "the shared dependency's struct registers under its namespace");
    assert.equal(types.resolveByName(`${EXT_A_NS}:/main.ts::Pos`), undefined);
    assert.ok(types.resolveByName(`${EXT_A_NS}:/range.ts::AVec`));
    assert.ok(types.resolveByName(`${EXT_B_NS}:/probe.ts::BVec`));
    assert.ok(types.resolveByName(`${EXT_B_NS}:/probe.ts::BMode`));

    // Register-if-absent at the session level: a second full compile reuses
    // the shared dependency's registration.
    const again = session.compile();
    for (const [namespace, result] of again.roots) {
      assertClean(result, namespace);
    }
    assert.equal(types.resolveByName(`${SHARED_NS}:/main.ts::Pos`), posTypeId);

    const bundle = buildMultiRootActionBundle([...session.results().values()], { services });
    assert.ok(bundle, "the combined bundle builds across roots");
    assert.ok(bundle.actions.get(`${EXT_A_NS}:user.sensor.robotARange00001`));
    assert.ok(bundle.actions.get(`${EXT_A_NS}:user.conversion.convAnumbuf00001`));
    assert.ok(bundle.actions.get(`${EXT_B_NS}:user.sensor.robotBProbe00001`));
    assert.ok(bundle.actions.get(`${HOST_NS}:user.sensor.hostRange0000001`));
    assert.ok(bundle.actions.get(`${SHARED_NS}:user.sensor.sharedProbe00001`));

    // The shared modifier declared by robot-a unifies: one tile, and
    // robot-b's bare reference to it produces no diagnostic.
    const turboTiles = bundle.tiles.filter((tile) => tile.tileId === mkModifierTileId("modifier.robo.turbo"));
    assert.equal(turboTiles.length, 1, "one shared modifier tile across roots");
  });

  test("same-named user outputs from different projects never cross-satisfy", () => {
    const { services, session } = newSession();
    session.setRoots(threeRootSet());
    session.compile();

    const bundle = buildMultiRootActionBundle([...session.results().values()], { services });
    assert.ok(bundle);

    const hostKey = mkOutputVarKey(CoreTypeIds.Number, scopedOutputName(HOST_NS, "distance"));
    const extAKey = mkOutputVarKey(CoreTypeIds.Number, scopedOutputName(EXT_A_NS, "distance"));
    assert.notEqual(hostKey, extAKey);

    const hostTileId = mkOutputTileId(CoreTypeIds.Number, scopedOutputName(HOST_NS, "distance"));
    const extATileId = mkOutputTileId(CoreTypeIds.Number, scopedOutputName(EXT_A_NS, "distance"));
    assert.ok(
      bundle.tiles.some((tile) => tile.tileId === hostTileId),
      "the host's output tile is distinct"
    );
    assert.ok(
      bundle.tiles.some((tile) => tile.tileId === extATileId),
      "the extension's output tile is distinct"
    );

    const hostSensor = bundle.tiles.find(
      (tile) => tile.tileId === `tile.sensor->${HOST_NS}:user.sensor.hostRange0000001`
    );
    const extASensor = bundle.tiles.find(
      (tile) => tile.tileId === `tile.sensor->${EXT_A_NS}:user.sensor.robotARange00001`
    );
    assert.ok(hostSensor && extASensor);
    assert.ok(hostSensor.providedOutputs().indexOf(hostKey) >= 0);
    assert.equal(hostSensor.providedOutputs().indexOf(extAKey), -1, "the host sensor never provides a foreign key");
    assert.ok(extASensor.providedOutputs().indexOf(extAKey) >= 0);
    assert.equal(extASensor.providedOutputs().indexOf(hostKey), -1);
  });

  test("recompiling one root invalidates and re-registers only its namespace", () => {
    const { services, session } = newSession();
    session.setRoots(threeRootSet());
    session.compile();

    const types = services.runtime.types;
    const posTypeId = types.resolveByName(`${SHARED_NS}:/main.ts::Pos`)!;
    const aVecTypeId = types.resolveByName(`${EXT_A_NS}:/range.ts::AVec`)!;
    const bVecTypeId = types.resolveByName(`${EXT_B_NS}:/probe.ts::BVec`)!;
    const posDefBefore = types.get(posTypeId);
    const aVecDefBefore = types.get(aVecTypeId);
    const bVecDefBefore = types.get(bVecTypeId);

    const recompiled = session.compileRoot(EXT_A_NS);
    assertClean(recompiled, EXT_A_NS);

    assert.equal(types.get(posTypeId), posDefBefore, "the shared dependency's registration is untouched");
    assert.equal(types.get(bVecTypeId), bVecDefBefore, "the sibling root's registration is untouched");
    assert.ok(types.get(aVecTypeId), "the recompiled root re-registers its own types");
    assert.notEqual(types.get(aVecTypeId), aVecDefBefore, "the recompiled root's registration is fresh");
  });

  test("a root compiles identically against a fresh registry and a warm multi-root session", () => {
    const warmServices = __test__createBrainServices();
    const session = new MultiRootSession({
      services: warmServices,
      ambientFiles: [{ path: "ambient.d.ts", content: buildAmbientDeclarations(warmServices.runtime.types) }],
    });
    session.setRoots(threeRootSet());
    const warm = session.compile().roots.get(EXT_A_NS)!;

    const freshServices = __test__createBrainServices();
    const freshProject = new UserTileProject({
      projectNamespace: EXT_A_NS,
      ambientFiles: [{ path: "ambient.d.ts", content: buildAmbientDeclarations(freshServices.runtime.types) }],
      services: freshServices,
    });
    freshProject.setFiles(files({ "range.ts": EXT_A_SENSOR, "conv.ts": EXT_A_CONVERSION }));
    const fresh = freshProject.compileAll();

    assertClean(warm, "warm robot-a");
    assertClean(fresh, "fresh robot-a");

    const warmSensor = warm.results.get("range.ts")?.program;
    const freshSensor = fresh.results.get("range.ts")?.program;
    assert.ok(warmSensor && freshSensor);
    assert.equal(warmSensor.key, freshSensor.key);
    assert.deepEqual(warmSensor.args, freshSensor.args);
    assert.deepEqual(warmSensor.outputs, freshSensor.outputs);
    assert.deepEqual(
      warmSensor.structTypes?.map((info) => [info.identity, info.typeId]),
      freshSensor.structTypes?.map((info) => [info.identity, info.typeId])
    );

    const warmConversion = warm.results.get("conv.ts")?.program;
    const freshConversion = fresh.results.get("conv.ts")?.program;
    assert.ok(warmConversion && freshConversion);
    assert.equal(warmConversion.key, freshConversion.key);
    assert.deepEqual(warmConversion.conversion, freshConversion.conversion);
  });

  test("removing a root from the set clears its registrations completely", () => {
    const { services, session } = newSession();
    session.setRoots(threeRootSet());
    session.compile();

    const types = services.runtime.types;
    const bVecTypeId = types.resolveByName(`${EXT_B_NS}:/probe.ts::BVec`)!;
    const bModeTypeId = types.resolveByName(`${EXT_B_NS}:/probe.ts::BMode`)!;
    assert.ok(services.shared.conversions.get(bModeTypeId, CoreTypeIds.String));

    session.setRoots(threeRootSet().filter((root) => root.namespace !== EXT_B_NS && root.namespace !== HOST_NS));

    assert.equal(types.resolveByName(`${EXT_B_NS}:/probe.ts::BVec`), undefined);
    assert.equal(types.get(bVecTypeId), undefined);
    assert.equal(types.resolveByName(`${EXT_B_NS}:/probe.ts::BMode`), undefined);
    assert.equal(
      services.shared.conversions.get(bModeTypeId, CoreTypeIds.String),
      undefined,
      "the removed root's enum artifacts are gone"
    );
    assert.ok(types.resolveByName(`${SHARED_NS}:/main.ts::Pos`), "remaining roots keep their registrations");

    const bundle = buildMultiRootActionBundle([...session.results().values()], { services });
    assert.ok(bundle);
    assert.equal(bundle.actions.get(`${EXT_B_NS}:user.sensor.robotBProbe00001`), undefined);
    assert.ok(!bundle.tiles.some((tile) => tile.tileId === `tile.var.factory->${bVecTypeId}`));
    assert.ok(bundle.actions.get(`${EXT_A_NS}:user.sensor.robotARange00001`));
  });

  test("no leftover registration from a previous resolution satisfies a later compile", () => {
    const { services, session } = newSession();
    session.setRoots(threeRootSet());
    session.compile();

    const types = services.runtime.types;
    const bVecTypeId = types.resolveByName(`${EXT_B_NS}:/probe.ts::BVec`)!;
    const withoutB = threeRootSet().filter((root) => root.namespace !== EXT_B_NS);
    for (const root of withoutB) {
      if (root.namespace === HOST_NS) root.dependencies = [dep(EXT_A_NS)];
    }
    session.setRoots(withoutB);
    session.compile();
    assert.equal(types.get(bVecTypeId), undefined);

    // Re-adding the root with changed content compiles the new shape; the
    // previous resolution's registration is gone, not reused.
    const changedB = `import { Sensor, StructType, NumberType, type Context } from "wendoo";

export const BVec = StructType({
  name: "BVec",
  fields: { z: NumberType },
});

export default Sensor({
  name: "robot-b probe",
  id: "robotBProbe00001",
  onExecute(ctx: Context): number {
    return 3;
  },
});
`;
    session.setRoots([
      ...withoutB,
      { namespace: EXT_B_NS, files: files({ "probe.ts": changedB }), dependencies: [dep(SHARED_NS)] },
    ]);
    const { roots } = session.compile();
    assertClean(roots.get(EXT_B_NS)!, EXT_B_NS);

    const revivedId = types.resolveByName(`${EXT_B_NS}:/probe.ts::BVec`);
    assert.ok(revivedId);
    const def = types.get(revivedId);
    assert.ok(def && def.coreType === NativeType.Struct, "BVec re-registers with the new shape");
    const fields = (def as StructTypeDef).fieldIndexByName;
    assert.equal(fields.get("z"), 0, "the re-added root's changed field set is live");
    assert.equal(fields.get("x"), undefined, "the previous resolution's field set is gone");
  });

  test("two roots may reuse the same stable id: keys stay distinct per namespace", () => {
    const { session } = newSession();
    const sensor = (name: string) => `import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "${name}",
  id: "sameStableId0001",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    session.setRoots([
      { namespace: EXT_A_NS, files: files({ "main.ts": sensor("a") }) },
      { namespace: EXT_B_NS, files: files({ "main.ts": sensor("b") }) },
    ]);
    const { roots } = session.compile();
    assertClean(roots.get(EXT_A_NS)!, EXT_A_NS);
    assertClean(roots.get(EXT_B_NS)!, EXT_B_NS);
    assert.notEqual(
      roots.get(EXT_A_NS)!.results.get("main.ts")!.program!.key,
      roots.get(EXT_B_NS)!.results.get("main.ts")!.program!.key
    );
  });
});

describe("multi-root shared-tile reconcile", () => {
  const modifierSensor = (
    id: string,
    label?: string
  ) => `import { Sensor, modifier, optional, type Context } from "wendoo";

export default Sensor({
  name: "sensor ${id}",
  id: "${id}",
  args: [optional(modifier("modifier.robo.boost"${label === undefined ? "" : `, { label: ${JSON.stringify(label)} }`}))],
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;

  test("matching shared-modifier labels across roots unify without diagnostics", () => {
    const { services, session } = newSession();
    session.setRoots([
      { namespace: EXT_A_NS, files: files({ "main.ts": modifierSensor("modSensorA00001", "boost") }) },
      { namespace: EXT_B_NS, files: files({ "main.ts": modifierSensor("modSensorB00001", "boost") }) },
    ]);
    const { roots } = session.compile();
    assertClean(roots.get(EXT_A_NS)!, EXT_A_NS);
    assertClean(roots.get(EXT_B_NS)!, EXT_B_NS);

    const bundle = buildMultiRootActionBundle([...session.results().values()], { services });
    assert.ok(bundle);
    assert.equal(bundle.tiles.filter((tile) => tile.tileId === mkModifierTileId("modifier.robo.boost")).length, 1);
  });

  test("mismatched shared-modifier labels across roots diagnose in the later root, naming both", () => {
    const { session } = newSession();
    session.setRoots([
      { namespace: EXT_A_NS, files: files({ "main.ts": modifierSensor("modSensorA00001", "boost") }) },
      { namespace: EXT_B_NS, files: files({ "main.ts": modifierSensor("modSensorB00001", "turbo") }) },
    ]);
    const { roots } = session.compile();
    assertClean(roots.get(EXT_A_NS)!, EXT_A_NS);

    const diags = allDiagnostics(roots.get(EXT_B_NS)!);
    assert.equal(diags.length, 1, JSON.stringify(diags));
    assert.equal(diags[0].code, CompileDiagCode.SharedModifierLabelConflict);
    assert.match(diags[0].message, /"turbo"/);
    assert.match(diags[0].message, /"boost"/);
  });

  test("a bare shared-modifier reference resolves against another root's declaration", () => {
    const { session } = newSession();
    session.setRoots([
      { namespace: EXT_A_NS, files: files({ "main.ts": modifierSensor("modSensorA00001", "boost") }) },
      {
        namespace: EXT_B_NS,
        files: files({ "main.ts": modifierSensor("modSensorB00001") }),
        dependencies: [dep(EXT_A_NS)],
      },
    ]);
    const { roots } = session.compile();
    assertClean(roots.get(EXT_A_NS)!, EXT_A_NS);
    assertClean(roots.get(EXT_B_NS)!, EXT_B_NS);
  });

  test("conflicting shared-parameter types across roots diagnose in the later root", () => {
    const paramSensor = (id: string, type: string) => `import { Sensor, param, optional, type Context } from "wendoo";

export default Sensor({
  name: "sensor ${id}",
  id: "${id}",
  args: [optional(param("parameter.robo.size", { type: "${type}" }))],
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    const { session } = newSession();
    session.setRoots([
      { namespace: EXT_A_NS, files: files({ "main.ts": paramSensor("paramSensorA0001", "number") }) },
      { namespace: EXT_B_NS, files: files({ "main.ts": paramSensor("paramSensorB0001", "string") }) },
    ]);
    const { roots } = session.compile();
    assertClean(roots.get(EXT_A_NS)!, EXT_A_NS);

    const diags = allDiagnostics(roots.get(EXT_B_NS)!);
    assert.equal(diags.length, 1, JSON.stringify(diags));
    assert.equal(diags[0].code, CompileDiagCode.SharedParameterTypeConflict);
  });

  test("a conversion pair claimed by an earlier root diagnoses a later root's duplicate", () => {
    const conversion = (id: string) => `import { BufferType, Conversion, NumberType } from "wendoo";

export default Conversion({
  id: "${id}",
  from: NumberType,
  to: BufferType,
  cost: 2,
  convert(value: number): Buffer {
    return Buffer.from([value]);
  },
});
`;
    const { session } = newSession();
    session.setRoots([
      { namespace: EXT_A_NS, files: files({ "conv.ts": conversion("convDupA00000001") }) },
      { namespace: EXT_B_NS, files: files({ "conv.ts": conversion("convDupB00000001") }) },
    ]);
    const { roots } = session.compile();
    assertClean(roots.get(EXT_A_NS)!, EXT_A_NS);

    const diags = allDiagnostics(roots.get(EXT_B_NS)!);
    assert.equal(diags.length, 1, JSON.stringify(diags));
    assert.equal(diags[0].code, CompileDiagCode.DuplicateConversionPair);
  });
});
