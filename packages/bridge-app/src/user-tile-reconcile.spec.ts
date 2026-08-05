/**
 * Reconcile-on-recompile at the apply seam: applying a project's recompile
 * drops the tiles whose source no longer declares them, keeps every tile the
 * surviving sources still declare, and leaves a brain holding a placed instance
 * of a dropped tile editable. Each case drives a warm {@link UserTileProject} --
 * the shape a live app session holds -- through the real suggestion oracle.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  coreModule,
  createMindcraftEnvironment,
  type MindcraftEnvironment,
  mkActuatorTileId,
} from "@mindcraft-lang/core/app";
import { type IBrainTileDef, type ITileCatalog, RuleSide } from "@mindcraft-lang/core/brain";
import { CompilationDiagCode } from "@mindcraft-lang/core/brain/compiler";
import {
  type InsertionContext,
  parseTilesForSuggestions,
  suggestTiles,
} from "@mindcraft-lang/core/brain/language-service";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { mkModifierTileId, mkParameterTileId } from "@mindcraft-lang/core/runtime";
import { buildCompiledActionBundle, UserTileProject, type WorkspaceCompileResult } from "@mindcraft-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@mindcraft-lang/ts-compiler/testing";
import { applyCompiledUserTiles } from "./user-tile-registration.js";

const MINE_ID = "acmine0000000001";
const KEEP_ID = "ackeep0000000001";
const MINE_KEY = `${TEST_PROJECT_NAMESPACE}:user.actuator.${MINE_ID}`;
const KEEP_KEY = `${TEST_PROJECT_NAMESPACE}:user.actuator.${KEEP_ID}`;

const MINE_TILE_ID = mkActuatorTileId(MINE_KEY);
const KEEP_TILE_ID = mkActuatorTileId(KEEP_KEY);
const SHARED_MODIFIER_TILE_ID = mkModifierTileId("modifier.shared.boost");
const SHARED_PARAM_TILE_ID = mkParameterTileId("parameter.count");
const MINE_PRIVATE_PARAM_TILE_ID = mkParameterTileId(`${TEST_PROJECT_NAMESPACE}:user.${MINE_ID}.speed`);

const MY_ACTUATOR = `import { Actuator, modifier, optional, param, type Context } from "mindcraft";

export default Actuator({
  id: "${MINE_ID}",
  name: "my actuator",
  args: [
    optional(modifier("modifier.shared.boost", { label: "boost" })),
    param("speed", { type: "number" }),
    param("parameter.count", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { boost: boolean; speed: number; "parameter.count": number }): void {
  },
});
`;

const KEEP_ACTUATOR = `import { Actuator, modifier, optional, type Context } from "mindcraft";

export default Actuator({
  id: "${KEEP_ID}",
  name: "keep actuator",
  args: [optional(modifier("modifier.shared.boost", { label: "boost" }))],
  onExecute(ctx: Context, args: { boost: boolean }): void {
  },
});
`;

/** A warm compiler project plus the environment its compiles are applied to, mirroring one live app session. */
function createSession(): { env: MindcraftEnvironment; project: UserTileProject } {
  const env = createMindcraftEnvironment({ modules: [coreModule()] });
  const project = new UserTileProject({ projectNamespace: TEST_PROJECT_NAMESPACE, services: env.brainServices });
  return { env, project };
}

function applyCompile(env: MindcraftEnvironment, project: UserTileProject): void {
  const projectResult = project.compileAll();
  const bundle = buildCompiledActionBundle(projectResult, { services: env.brainServices });
  const result: WorkspaceCompileResult = { files: new Map(), projectResult, rootResults: [projectResult], bundle };
  applyCompiledUserTiles(env, result);
}

/** Tile ids the oracle offers on the DO side after `placed`, over the environment's live catalog chain. */
function offeredTileIds(env: MindcraftEnvironment, placed: readonly IBrainTileDef[] = []): Set<string> {
  const context: InsertionContext = { ruleSide: RuleSide.Do, expr: parseTilesForSuggestions(List.from(placed)) };
  const catalogs = List.from<ITileCatalog>([...env.tileCatalogs()]);
  const result = suggestTiles(context, catalogs, env.brainServices);
  const ids = new Set<string>();
  for (let i = 0; i < result.exact.size(); i++) ids.add(result.exact.get(i).tileDef.tileId);
  for (let i = 0; i < result.withConversion.size(); i++) ids.add(result.withConversion.get(i).tileDef.tileId);
  return ids;
}

function tileDef(env: MindcraftEnvironment, tileId: string): IBrainTileDef | undefined {
  for (const catalog of env.tileCatalogs()) {
    const found = catalog.get(tileId);
    if (found) return found;
  }
  return undefined;
}

describe("applyCompiledUserTiles reconciles a recompile", () => {
  test("a deleted tile leaves the offering while its siblings and shared arg tiles stay", () => {
    const { env, project } = createSession();
    project.setFiles(
      new Map([
        ["keep.ts", KEEP_ACTUATOR],
        ["mine.ts", MY_ACTUATOR],
      ])
    );
    applyCompile(env, project);

    const mineTile = tileDef(env, MINE_TILE_ID);
    assert.ok(mineTile, "the added actuator is registered");
    assert.ok(offeredTileIds(env).has(MINE_TILE_ID), "the added actuator is offered");

    const underMine = offeredTileIds(env, [mineTile]);
    assert.ok(underMine.has(MINE_PRIVATE_PARAM_TILE_ID), "its private parameter is offered under it");
    assert.ok(underMine.has(SHARED_PARAM_TILE_ID), "its shared parameter is offered under it");
    assert.ok(underMine.has(SHARED_MODIFIER_TILE_ID), "the shared modifier is offered under it");

    project.deletePath("mine.ts");
    applyCompile(env, project);

    assert.equal(offeredTileIds(env).has(MINE_TILE_ID), false, "the deleted actuator is no longer offered");
    assert.equal(tileDef(env, MINE_TILE_ID), undefined, "the deleted actuator's tile is unregistered");
    assert.equal(
      tileDef(env, MINE_PRIVATE_PARAM_TILE_ID),
      undefined,
      "the deleted actuator's private parameter tile is unregistered with it"
    );
    assert.equal(
      tileDef(env, SHARED_PARAM_TILE_ID),
      undefined,
      "a shared parameter tile no surviving tile declares is unregistered"
    );

    const keepTile = tileDef(env, KEEP_TILE_ID);
    assert.ok(keepTile, "the surviving actuator keeps its tile");
    assert.ok(offeredTileIds(env).has(KEEP_TILE_ID), "the surviving actuator is still offered");
    assert.ok(
      offeredTileIds(env, [keepTile]).has(SHARED_MODIFIER_TILE_ID),
      "a shared modifier a surviving tile still declares stays offered"
    );
  });

  test("removing then re-adding a tile restores the offering a fresh session produces", () => {
    const { env, project } = createSession();
    project.setFiles(
      new Map([
        ["keep.ts", KEEP_ACTUATOR],
        ["mine.ts", MY_ACTUATOR],
      ])
    );
    applyCompile(env, project);
    const fresh = offeredTileIds(env);

    project.deletePath("mine.ts");
    applyCompile(env, project);
    project.updateFile("mine.ts", MY_ACTUATOR);
    applyCompile(env, project);

    assert.deepEqual(
      [...offeredTileIds(env)].sort(),
      [...fresh].sort(),
      "a warm registry that dropped and re-added the tile offers what the first compile offered"
    );
  });

  test("a brain holding a placed instance of a deleted tile stays editable and rebuildable", () => {
    const { env, project } = createSession();
    project.setFiles(new Map([["mine.ts", MY_ACTUATOR]]));
    applyCompile(env, project);

    const mineTile = tileDef(env, MINE_TILE_ID);
    assert.ok(mineTile);
    const brainDef = BrainDef.emptyBrainDef(env.brainServices, "Survivor");
    brainDef.pages().get(0)!.children().get(0)!.do().appendTile(mineTile);
    const json = brainDef.toJson();
    const brain = env.createBrain(env.deserializeBrainJson(json));
    assert.equal(brain.status, "active");

    project.deletePath("mine.ts");
    applyCompile(env, project);

    // The live brain enters the invalidated set, and the rebuild retry leaves it
    // there without throwing.
    assert.equal(brain.status, "invalidated");
    env.rebuildInvalidatedBrains();
    assert.equal(brain.status, "invalidated");

    // Reopening the document resolves the orphaned placement to a `missing`
    // tile that keeps its id, so the editor renders and edits it.
    const reopened = env.deserializeBrainJson(json);
    const placed = reopened.pages().get(0)!.children().get(0)!.do().tiles().get(0)!;
    assert.equal(placed.kind, "missing");
    assert.equal(placed.tileId, MINE_TILE_ID);

    // Linking the reopened document completes over the orphaned placement and
    // reports the rule body it could not compile.
    const linked = env.linkBrain(reopened);
    assert.ok(linked.program, "linking a brain over an orphaned placement still produces a program");
    const dropped = linked.diagnostics
      .toArray()
      .filter((diagnostic) => diagnostic.code === CompilationDiagCode.UncompilableExpressionDropped);
    assert.equal(dropped.length, 1, "the uncompilable rule body is reported once");
    assert.equal(dropped[0]!.severity, "warning", "the report does not block the degraded program");
    assert.ok(dropped[0]!.message.includes(MINE_TILE_ID), "the report names the orphaned tile id");

    // Restoring the source revives the placement.
    project.updateFile("mine.ts", MY_ACTUATOR);
    applyCompile(env, project);
    env.rebuildInvalidatedBrains();
    assert.equal(brain.status, "active");
    assert.equal(
      env.deserializeBrainJson(json).pages().get(0)!.children().get(0)!.do().tiles().get(0)!.kind,
      "actuator"
    );
  });
});
