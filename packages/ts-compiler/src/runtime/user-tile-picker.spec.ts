/**
 * Editor-time acceptance for user-tile modifier and shared-parameter tiles: the
 * brain-editor picker offers them, copy/paste-shared ids resolve to one tile
 * that validates under every declaring sensor, and conflicting or dangling
 * shared ids are diagnosed. Each case drives REAL compiled tiles through the
 * language-service suggester and the tile parser, at N>=2 where sharing matters.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { type CompiledActionBundle, List } from "@mindcraft-lang/core";
import { type BrainServices, type IBrainTileDef, type ITileCatalog, RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import type { Expr, SensorExpr } from "@mindcraft-lang/core/brain/compiler";
import {
  type InsertionContext,
  parseTilesForSuggestions,
  suggestTiles,
  type TileSuggestionResult,
} from "@mindcraft-lang/core/brain/language-service";
import { TileCatalog } from "@mindcraft-lang/core/brain/tiles";
import { mkModifierTileId, mkParameterTileId } from "@mindcraft-lang/core/runtime";
import { buildAmbientDeclarations } from "../compiler/ambient.js";
import { CompileDiagCode } from "../compiler/diag-codes.js";
import type { ProjectCompileResult } from "../compiler/project.js";
import { UserTileProject } from "../compiler/project.js";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { buildCompiledActionBundle } from "./action-bundle.js";

let services: BrainServices;

function compileProject(files: Record<string, string>): ProjectCompileResult {
  const ambientSource = buildAmbientDeclarations(services.runtime.types);
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
    services,
  });
  project.setFiles(new Map(Object.entries(files)));
  return project.compileAll();
}

function buildBundle(result: ProjectCompileResult): CompiledActionBundle {
  const bundle = buildCompiledActionBundle(result, { services });
  assert.ok(bundle, "expected a compiled action bundle");
  return bundle;
}

/** The suggester's catalog chain, mirroring the environment's `[services.edit.tiles, bundleCatalog]` order. */
function catalogsFor(bundle: CompiledActionBundle): List<ITileCatalog> {
  const bundleCatalog = new TileCatalog();
  for (const tile of bundle.tiles) bundleCatalog.registerTileDef(tile);
  return List.from<ITileCatalog>([services.edit.tiles, bundleCatalog]);
}

/** Finds a compiled sensor tile in the bundle by its display label. */
function sensorTile(bundle: CompiledActionBundle, label: string): IBrainTileDef {
  const tile = bundle.tiles.find((candidate) => candidate.kind === "sensor" && candidate.metadata?.label === label);
  assert.ok(tile, `sensor tile "${label}" not found in bundle`);
  return tile;
}

/** Counts how many bundle tiles carry `tileId` (dedup checks). */
function bundleTileCount(bundle: CompiledActionBundle, tileId: string): number {
  return bundle.tiles.filter((tile) => tile.tileId === tileId).length;
}

/** Tile ids the picker offers when `placed` is the current tile sequence on the WHEN side. */
function suggestedTileIds(bundle: CompiledActionBundle, placed: readonly IBrainTileDef[]): Set<string> {
  const expr: Expr = parseTilesForSuggestions(List.from(placed));
  const ctx: InsertionContext = { ruleSide: RuleSide.When, expr };
  const result: TileSuggestionResult = suggestTiles(ctx, catalogsFor(bundle), services);
  const ids = new Set<string>();
  for (let i = 0; i < result.exact.size(); i++) ids.add(result.exact.get(i).tileDef.tileId);
  for (let i = 0; i < result.withConversion.size(); i++) ids.add(result.withConversion.get(i).tileDef.tileId);
  return ids;
}

/** The modifier tile ids the parser bound into `sensor`'s slots when `modifier` is placed after it. */
function boundModifierIds(sensor: IBrainTileDef, modifier: IBrainTileDef): string[] {
  const expr: Expr = parseTilesForSuggestions(List.from([sensor, modifier]));
  if (expr.kind !== "sensor") return [];
  const mods = (expr as SensorExpr).modifiers;
  const ids: string[] = [];
  for (let i = 0; i < mods.size(); i++) {
    const slot = mods.get(i).expr;
    if (slot.kind === "modifier") ids.push(slot.tileDef.tileId);
  }
  return ids;
}

/** A sensor whose sole arg is a mutually-exclusive found/lost choice over the shared `modifier.cutebot-line` ids. */
function sharedModifierSensor(name: string): string {
  return `import { type Context, choice, modifier, optional, Sensor } from "mindcraft";

export default Sensor({
  name: ${JSON.stringify(name)},
  args: [
    optional(
      choice(
        modifier("modifier.cutebot-line.found", { label: "found" }),
        modifier("modifier.cutebot-line.lost", { label: "lost" })
      )
    ),
  ],
  onExecute(ctx: Context, args: { found: boolean; lost: boolean }): boolean {
    return args.found || args.lost;
  },
});
`;
}

describe("user-tile picker: shared modifiers", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("two sensors sharing a modifier id register one tile that both offer and both accept", () => {
    const result = compileProject({
      "left.ts": sharedModifierSensor("line left"),
      "right.ts": sharedModifierSensor("line right"),
    });
    for (const [path, entry] of result.results) {
      assert.deepEqual(entry.diagnostics, [], `${path}: ${JSON.stringify(entry.diagnostics)}`);
    }
    const bundle = buildBundle(result);

    const foundId = mkModifierTileId("modifier.cutebot-line.found");
    const lostId = mkModifierTileId("modifier.cutebot-line.lost");

    // One shared tile per id, not one per declaring sensor.
    assert.equal(bundleTileCount(bundle, foundId), 1, "the shared found modifier is registered exactly once");
    assert.equal(bundleTileCount(bundle, lostId), 1, "the shared lost modifier is registered exactly once");

    const left = sensorTile(bundle, "line left");
    const right = sensorTile(bundle, "line right");

    // Both sensors' pickers offer both shared modifiers.
    const leftSuggested = suggestedTileIds(bundle, [left]);
    const rightSuggested = suggestedTileIds(bundle, [right]);
    for (const id of [foundId, lostId]) {
      assert.ok(leftSuggested.has(id), `left picker offers ${id}`);
      assert.ok(rightSuggested.has(id), `right picker offers ${id}`);
    }

    // The one shared modifier tile validates when placed under either sensor.
    const foundTile = bundle.tiles.find((tile) => tile.tileId === foundId);
    assert.ok(foundTile);
    assert.deepEqual(boundModifierIds(left, foundTile), [foundId], "found binds under the left sensor");
    assert.deepEqual(boundModifierIds(right, foundTile), [foundId], "found binds under the right sensor");
  });

  test("a bare reference to an unregistered shared modifier is diagnosed", () => {
    const result = compileProject({
      "dangling.ts": `import { type Context, modifier, optional, Sensor } from "mindcraft";

export default Sensor({
  name: "dangling",
  args: [optional(modifier("modifier.nowhere.zzz"))],
  onExecute(ctx: Context, args: { zzz: boolean }): boolean {
    return args.zzz;
  },
});
`,
    });
    const entry = result.results.get("dangling.ts");
    assert.ok(entry);
    assert.ok(
      entry.diagnostics.some((d) => d.code === CompileDiagCode.UnregisteredModifierReference),
      `expected UnregisteredModifierReference, got ${JSON.stringify(entry.diagnostics)}`
    );
  });
});

describe("user-tile picker: private params and modifiers", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("a named private param and a private modifier are both offered", () => {
    const result = compileProject({
      "tile.ts": `import { type Context, modifier, optional, param, Sensor } from "mindcraft";

export default Sensor({
  name: "private tile",
  args: [
    optional(modifier("boost", { label: "Boost" })),
    param("distance", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { boost: boolean; distance: number }): boolean {
    return args.boost && args.distance > 0;
  },
});
`,
    });
    const entry = result.results.get("tile.ts");
    assert.ok(entry?.program, "expected a compiled program");
    assert.deepEqual(entry.diagnostics, [], JSON.stringify(entry.diagnostics));
    const actionId = entry.program.id;

    const bundle = buildBundle(result);
    const suggested = suggestedTileIds(bundle, [sensorTile(bundle, "private tile")]);
    assert.ok(
      suggested.has(mkModifierTileId(`${TEST_PROJECT_NAMESPACE}:user.${actionId}.boost`)),
      "the private modifier is offered under the stable-id scope"
    );
    assert.ok(
      suggested.has(mkParameterTileId(`${TEST_PROJECT_NAMESPACE}:user.${actionId}.distance`)),
      "the named private param is offered under the stable-id scope"
    );
  });

  test("an anonymous param still resolves to value suggestions", () => {
    const result = compileProject({
      "anon.ts": `import { type Context, param, Sensor } from "mindcraft";

export default Sensor({
  name: "anon tile",
  args: [param("value", { type: "number", anonymous: true })],
  onExecute(ctx: Context, args: { value: number }): boolean {
    return args.value > 0;
  },
});
`,
    });
    const entry = result.results.get("anon.ts");
    assert.ok(entry?.program, "expected a compiled program");
    assert.deepEqual(entry.diagnostics, [], JSON.stringify(entry.diagnostics));

    const bundle = buildBundle(result);
    // The anonymous slot resolves its `anon.number` tile, so value expressions are offered.
    const suggested = suggestedTileIds(bundle, [sensorTile(bundle, "anon tile")]);
    assert.ok(suggested.size > 0, "value expressions are suggested for the anonymous number slot");
  });
});

describe("user-tile picker: shared parameters", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  function sharedParamSensor(name: string, type: string): string {
    return `import { type Context, param, Sensor } from "mindcraft";

export default Sensor({
  name: ${JSON.stringify(name)},
  args: [param("parameter.count", { type: ${JSON.stringify(type)} })],
  onExecute(ctx: Context, args: { "parameter.count": ${type} }): boolean {
    return true;
  },
});
`;
  }

  test("two sensors sharing a same-typed parameter id register one tile that both offer", () => {
    const result = compileProject({
      "a.ts": sharedParamSensor("count a", "number"),
      "b.ts": sharedParamSensor("count b", "number"),
    });
    for (const [path, entry] of result.results) {
      assert.deepEqual(entry.diagnostics, [], `${path}: ${JSON.stringify(entry.diagnostics)}`);
    }
    const bundle = buildBundle(result);
    const paramId = mkParameterTileId("parameter.count");
    assert.equal(bundleTileCount(bundle, paramId), 1, "the shared parameter is registered exactly once");

    for (const label of ["count a", "count b"]) {
      const suggested = suggestedTileIds(bundle, [sensorTile(bundle, label)]);
      assert.ok(suggested.has(paramId), `${label} picker offers the shared parameter`);
    }
  });

  test("a conflicting-type redeclaration of a shared parameter id is diagnosed", () => {
    const result = compileProject({
      "a.ts": sharedParamSensor("count a", "number"),
      "b.ts": sharedParamSensor("count b", "string"),
    });
    const diagnostics = [...result.results.values()].flatMap((entry) => entry.diagnostics);
    assert.ok(
      diagnostics.some((d) => d.code === CompileDiagCode.SharedParameterTypeConflict),
      `expected SharedParameterTypeConflict, got ${JSON.stringify(diagnostics)}`
    );
  });

  test("a shared parameter with an unresolved type is diagnosed rather than silently dropped", () => {
    const result = compileProject({
      "a.ts": `import { type Context, param, Sensor } from "mindcraft";

export default Sensor({
  name: "bad shared param",
  args: [param("parameter.count", { type: "bogusType" })],
  onExecute(ctx: Context, args: { "parameter.count": number }): boolean {
    return true;
  },
});
`,
    });
    const entry = result.results.get("a.ts");
    assert.ok(entry);
    assert.ok(
      entry.diagnostics.some((d) => d.code === CompileDiagCode.SharedParameterUnresolvedType),
      `expected SharedParameterUnresolvedType, got ${JSON.stringify(entry.diagnostics)}`
    );
  });
});
