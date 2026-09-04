/**
 * Per-tile provenance and per-root structure of a multi-root action
 * bundle. Pins tile ownership (surface tiles by their project namespace,
 * struct-derived tiles by the declaring library, shared-id tiles by every
 * declaring root) and the shape of `roots` and its dependency closures.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BrainServices, IBrainTileDef } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { mkModifierTileId } from "@wendoo/core/runtime";
import type { ProjectDependency } from "../compiler/extension-mounts.js";
import type { ProjectCompileResult } from "../compiler/project.js";
import { MultiRootSession, type ProjectRoot } from "../compiler/project-set.js";
import type { CompileDiagnostic } from "../compiler/types.js";
import { buildMultiRootActionBundle } from "./action-bundle.js";

const SHARED_NS = "acme/shared";
const EXT_A_NS = "acme/robot-a";
const EXT_B_NS = "acme/robot-b";
const HOST_NS = "host-store-id-0001";

const sharedSource = (label: string) => `import { Sensor, StructType, NumberType, type Context } from "wendoo";

export const Pos = StructType({
  name: "Pos",
  fields: { x: NumberType, y: NumberType },
  accessors: true,
});

export default Sensor({
  name: "shared probe",
  id: "sharedProbe00001",
  label: ${JSON.stringify(label)},
  returnType: Pos,
  onExecute(ctx: Context) {
    return Pos({ x: 1, y: 2 });
  },
});
`;

const EXT_A_SENSOR = `import { Sensor, NumberType, StructType, modifier, param, optional, type Context } from "wendoo";

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
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;

const EXT_B_SENSOR = `import { Sensor, StructType, NumberType, modifier, optional, type Context } from "wendoo";

export const BVec = StructType({
  name: "BVec",
  fields: { x: NumberType },
  variables: true,
});

export default Sensor({
  name: "robot-b probe",
  id: "robotBProbe00001",
  args: [optional(modifier("modifier.robo.turbo"))],
  onExecute(ctx: Context): number {
    return 2;
  },
});
`;

const HOST_SOURCE = `import { Sensor, type Context } from "wendoo";
import { Pos } from "@lib/acme/shared";

export default Sensor({
  name: "host place",
  id: "hostPlace0000001",
  returnType: Pos,
  onExecute(ctx: Context) {
    return Pos({ x: 3, y: 4 });
  },
});
`;

const modifierSensor = (
  id: string,
  label: string
) => `import { Sensor, modifier, optional, type Context } from "wendoo";

export default Sensor({
  name: "sensor ${id}",
  id: "${id}",
  args: [optional(modifier("modifier.robo.boost", { label: ${JSON.stringify(label)} }))],
  onExecute(ctx: Context): number {
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

/** The four-root set: `acme/shared` alone, robot-a and robot-b on it, and a host on all three. */
function fourRootSet(sharedLabel: string): ProjectRoot[] {
  return [
    {
      namespace: HOST_NS,
      files: files({ "main.ts": HOST_SOURCE }),
      dependencies: [dep(EXT_A_NS), dep(EXT_B_NS), dep(SHARED_NS)],
    },
    { namespace: EXT_A_NS, files: files({ "index.ts": EXT_A_SENSOR }), dependencies: [dep(SHARED_NS)] },
    { namespace: EXT_B_NS, files: files({ "index.ts": EXT_B_SENSOR }), dependencies: [dep(SHARED_NS)] },
    { namespace: SHARED_NS, files: files({ "index.ts": sharedSource(sharedLabel) }) },
  ];
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

interface BuiltBundle {
  services: BrainServices;
  results: ReadonlyMap<string, ProjectCompileResult>;
  bundle: NonNullable<ReturnType<typeof buildMultiRootActionBundle>>;
}

/** Compile `roots` in a fresh session and build the combined bundle, asserting every root compiled clean. */
function buildBundle(roots: readonly ProjectRoot[]): BuiltBundle {
  const services = __test__createBrainServices();
  const session = new MultiRootSession({ services });
  session.setRoots(roots);
  const compiled = session.compile();
  for (const [namespace, result] of compiled.roots) {
    assert.deepEqual(allDiagnostics(result), [], `expected a clean compile for ${namespace}`);
  }
  const bundle = buildMultiRootActionBundle([...compiled.roots.values()], { services });
  assert.ok(bundle, "the combined bundle builds across roots");
  return { services, results: compiled.roots, bundle };
}

function tileById(bundle: BuiltBundle["bundle"], tileId: string): IBrainTileDef {
  const tile = bundle.tiles.find((candidate) => candidate.tileId === tileId);
  assert.ok(tile, `expected a bundle tile with id ${tileId}`);
  return tile;
}

function owners(bundle: BuiltBundle["bundle"], tileId: string): readonly string[] {
  const provenance = tileById(bundle, tileId).provenance;
  assert.ok(provenance, `expected provenance on ${tileId}`);
  return provenance.owners;
}

function rootByNamespace(bundle: BuiltBundle["bundle"], namespace: string) {
  const root = bundle.roots.find((candidate) => candidate.namespace === namespace);
  assert.ok(root, `expected a compiled root for ${namespace}`);
  return root;
}

describe("bundle tile provenance", () => {
  test("each root owns the action tiles built from its own surfaces", () => {
    const { bundle } = buildBundle(fourRootSet("shared probe"));

    assert.deepEqual(owners(bundle, `tile.sensor->${SHARED_NS}:user.sensor.sharedProbe00001`), [SHARED_NS]);
    assert.deepEqual(owners(bundle, `tile.sensor->${EXT_A_NS}:user.sensor.robotARange00001`), [EXT_A_NS]);
    assert.deepEqual(owners(bundle, `tile.sensor->${EXT_B_NS}:user.sensor.robotBProbe00001`), [EXT_B_NS]);
    assert.deepEqual(owners(bundle, `tile.sensor->${HOST_NS}:user.sensor.hostPlace0000001`), [HOST_NS]);
  });

  test("roots carry one sorted entry per compilation root with its transitive closure", () => {
    const { bundle } = buildBundle(fourRootSet("shared probe"));

    assert.deepEqual(
      bundle.roots.map((root) => root.namespace),
      [EXT_A_NS, EXT_B_NS, SHARED_NS, HOST_NS].sort()
    );
    assert.deepEqual(rootByNamespace(bundle, SHARED_NS).closure, []);
    assert.deepEqual(rootByNamespace(bundle, EXT_A_NS).closure, [SHARED_NS]);
    assert.deepEqual(rootByNamespace(bundle, EXT_B_NS).closure, [SHARED_NS]);
    assert.deepEqual(rootByNamespace(bundle, HOST_NS).closure, [EXT_A_NS, EXT_B_NS, SHARED_NS].sort());
  });

  test("struct-derived tiles belong to the library declaring the struct, not to every collector", () => {
    const { services, results, bundle } = buildBundle(fourRootSet("shared probe"));

    const posIdentity = `${SHARED_NS}:/index.ts::Pos`;
    const hostProgram = results.get(HOST_NS)?.results.get("main.ts")?.program;
    assert.ok(hostProgram, "the host's sensor compiled");
    assert.ok(
      (hostProgram.structTypes ?? []).some((structType) => structType.identity === posIdentity),
      "the host program collects the imported struct, so ownership is not decided by who collects it"
    );

    const posTypeId = services.runtime.types.resolveByName(posIdentity);
    assert.ok(posTypeId, "the shared library's struct registers under its own namespace");
    const accessors = bundle.tiles.filter(
      (tile) => tile.kind === "accessor" && (tile as { structTypeId?: string }).structTypeId === posTypeId
    );
    assert.equal(accessors.length, 2, "one accessor tile per declared field");
    for (const accessor of accessors) {
      assert.deepEqual(accessor.provenance?.owners, [SHARED_NS], accessor.tileId);
    }

    const bvecTypeId = services.runtime.types.resolveByName(`${EXT_B_NS}:/index.ts::BVec`);
    assert.ok(bvecTypeId);
    const factories = bundle.tiles.filter(
      (tile) => tile.kind === "factory" && (tile as { factoryId?: string }).factoryId === bvecTypeId
    );
    assert.equal(factories.length, 1, "one variable-factory tile for the variables:true struct");
    assert.deepEqual(factories[0].provenance?.owners, [EXT_B_NS]);
  });

  test("a shared modifier declared by two roots is one tile owned by both", () => {
    const { bundle } = buildBundle([
      { namespace: EXT_A_NS, files: files({ "index.ts": modifierSensor("modSensorA00001", "boost") }) },
      { namespace: EXT_B_NS, files: files({ "index.ts": modifierSensor("modSensorB00001", "boost") }) },
    ]);

    const boostId = mkModifierTileId("modifier.robo.boost");
    assert.equal(bundle.tiles.filter((tile) => tile.tileId === boostId).length, 1);
    assert.deepEqual(owners(bundle, boostId), [EXT_A_NS, EXT_B_NS]);
  });

  test("every bundle tile is stamped, and a first-party tile is not", () => {
    const { services, bundle } = buildBundle(fourRootSet("shared probe"));

    assert.ok(bundle.tiles.length > 0, "the four-root set registers tiles");
    for (const tile of bundle.tiles) {
      assert.ok(tile.provenance, `expected provenance on ${tile.tileId}`);
      assert.ok(tile.provenance.owners.length > 0, `expected a non-empty owner set on ${tile.tileId}`);
    }

    const firstParty = services.edit.tiles.getAll().toArray();
    assert.ok(firstParty.length > 0, "the test services register first-party tiles");
    for (const tile of firstParty) {
      assert.equal(tile.provenance, undefined, `a first-party tile must stay unstamped: ${tile.tileId}`);
    }
  });
});
