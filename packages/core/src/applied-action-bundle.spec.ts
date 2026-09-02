import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type CompiledActionArtifact,
  type CompiledActionBundle,
  coreModule,
  createWendooEnvironment,
  Dict,
  List,
  type WendooEnvironment,
} from "@wendoo/core";
import type { BrainServices, IBrainDef } from "@wendoo/core/brain";
import { mkActuatorTileId } from "@wendoo/core/brain";
import { BrainDef } from "@wendoo/core/brain/model";
import { BrainTileActuatorDef } from "@wendoo/core/brain/tiles";
import {
  type BrainActionCallDef,
  BYTECODE_VERSION,
  bag,
  CoreParameterId,
  mkCallDef,
  mkNumberValue,
  Op,
  param,
} from "@wendoo/core/runtime";

/** Action key of the compiled user actuator these tests carry between environments. */
const kNudgeKey = "user::nudge";

/** Tile id the nudge actuator is placed under. */
const kNudgeTileId = mkActuatorTileId(kNudgeKey);

/** Revision the fixture bundle reports. */
const kRevision = "nudge.bundle.rev1";

/** The nudge call signature: one anonymous number slot. */
const nudgeCallDef: BrainActionCallDef = mkCallDef(bag(param(CoreParameterId.AnonymousNumber, { anonymous: true })));

function getEnvironmentServices(environment: WendooEnvironment): BrainServices {
  return (environment as unknown as { brainServices: BrainServices }).brainServices;
}

/** A compiled actuator artifact whose body returns without acting. */
function nudgeArtifact(): CompiledActionArtifact {
  return {
    version: BYTECODE_VERSION,
    functions: List.from([
      { code: List.from([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }]), numParams: 1, name: "entry" },
    ]),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.from([mkNumberValue(0)]),
    },
    variableNames: List.empty(),
    entryPoint: 0,
    key: kNudgeKey,
    kind: "actuator",
    callDef: nudgeCallDef,
    isAsync: false,
    numStateSlots: 0,
    entryFuncId: 0,
    revisionId: `${kNudgeKey}.rev1`,
  };
}

/** The bundle a compile would hand {@link WendooEnvironment.replaceActionBundle}. */
function nudgeBundle(): CompiledActionBundle {
  const actions = new Dict<string, CompiledActionArtifact>();
  actions.set(kNudgeKey, nudgeArtifact());
  return {
    revision: kRevision,
    actions,
    tiles: [
      new BrainTileActuatorDef(kNudgeKey, { key: kNudgeKey, kind: "actuator", callDef: nudgeCallDef, isAsync: false }),
    ],
    roots: [],
  };
}

/** A one-rule brain whose DO side drives the nudge actuator of `environment`. */
function brainDrivingNudge(environment: WendooEnvironment): BrainDef {
  const brainDef = BrainDef.emptyBrainDef(getEnvironmentServices(environment), "Nudge Brain");
  const tile = environment
    .tileCatalogs()
    .find((catalog) => catalog.has(kNudgeTileId))
    ?.get(kNudgeTileId);
  assert.ok(tile, "the applied bundle registered the actuator tile");
  brainDef.pages().get(0)!.children().get(0)!.do().appendTile(tile);
  return brainDef;
}

/** Kind of the one tile standing on the first rule's DO side of `brainDef`. */
function placedTileKind(brainDef: IBrainDef): string {
  return brainDef.pages().get(0)!.children().get(0)!.do().tiles().get(0)!.kind;
}

describe("the action bundle an environment reports", () => {
  test("is absent until a bundle is applied", () => {
    const environment = createWendooEnvironment({ modules: [coreModule()] });

    assert.equal(environment.appliedActionBundle(), undefined);
  });

  test("names the revision, the actions, and the tiles of the bundle applied", () => {
    const environment = createWendooEnvironment({ modules: [coreModule()] });
    environment.replaceActionBundle(nudgeBundle());

    const reported = environment.appliedActionBundle();

    assert.ok(reported, "an environment carrying a bundle reports one");
    assert.equal(reported.revision, kRevision);
    assert.deepEqual(reported.actions.keys().toArray(), [kNudgeKey]);
    assert.deepEqual(
      reported.tiles.map((tile) => tile.tileId),
      [kNudgeTileId]
    );
  });

  test("lets a fresh environment resolve and link a document written against it", () => {
    const authoring = createWendooEnvironment({ modules: [coreModule()] });
    authoring.replaceActionBundle(nudgeBundle());
    const authored = brainDrivingNudge(authoring).toJson();

    const reported = authoring.appliedActionBundle();
    assert.ok(reported, "the authoring environment reports its bundle");
    const staged = createWendooEnvironment({ modules: [coreModule()] });
    staged.replaceActionBundle(reported);

    const restored = staged.deserializeBrainJson(authored);
    assert.equal(placedTileKind(restored), "actuator", "the carried tile resolves rather than standing in as missing");

    const build = staged.linkBrain(restored);
    assert.deepEqual(
      build.diagnostics.toArray().filter((diag) => diag.severity === "error"),
      []
    );
    assert.ok(build.program, "the document links in the environment the bundle was carried to");
  });

  test("leaves a fresh environment with no bundle standing the tile in as missing", () => {
    const authoring = createWendooEnvironment({ modules: [coreModule()] });
    authoring.replaceActionBundle(nudgeBundle());
    const authored = brainDrivingNudge(authoring).toJson();

    const bare = createWendooEnvironment({ modules: [coreModule()] });

    assert.equal(placedTileKind(bare.deserializeBrainJson(authored)), "missing");
  });
});
