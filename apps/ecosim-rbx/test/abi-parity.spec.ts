// Installs the Roblox ambient globals the mirrored brain sources read at module
// scope. It must load before any import that reaches src/server/brain.
import "./luau-globals";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CoreFuncId,
  CoreOpId,
  coreModule,
  createMindcraftEnvironment,
  type IBrainDef,
  type IBrainRuleDef,
  type MindcraftEnvironment,
} from "@mindcraft-lang/core/app";
import { createEcosimModule as createWebEcosimModule } from "@/brain/index";
import { EcosimFuncId, EcosimHostActions, EcosimTypeAtomId } from "../src/server/brain/abi-ids";
import { createEcosimModule as createRbxEcosimModule } from "../src/server/brain/index";
import { assertSnapshotMapsEqual, assertSnapshotsEqual, RBX_SIDE, WEB_SIDE } from "./abi-compare";
import {
  type JsonValue,
  plainify,
  snapshotAction,
  snapshotConversions,
  snapshotFunctions,
  snapshotOperators,
  snapshotTileCatalogs,
  snapshotTypes,
} from "./abi-snapshot";

const RBX_APP_ROOT = path.resolve(__dirname, "..");
const ECOSIM_APP_ROOT = path.resolve(__dirname, "../../ecosim");

/** Project namespace the ecosim webapp loads a project's brain assets under. */
const WEB_PROJECT_NAMESPACE = "ecosim";

/** Project namespace `Engine.loadBrains` passes on the Roblox side. */
const RBX_PROJECT_NAMESPACE = "ecosim-rbx";

const ARCHETYPES = ["carnivore", "herbivore", "plant"] as const;

/** Source files that are copied verbatim from ecosim into the mirror. */
const BYTE_IDENTICAL_FILES: readonly { readonly web: string; readonly rbx: string }[] = [
  { web: "src/brain/abi-ids.ts", rbx: "src/server/brain/abi-ids.ts" },
  { web: "src/brain/tileids.ts", rbx: "src/server/brain/tileids.ts" },
  ...ARCHETYPES.map((archetype) => ({
    web: `public/assets/brain/defs/default-${archetype}.brain`,
    rbx: `src/shared/brains/default-${archetype}.json`,
  })),
];

/**
 * Names the first byte at which two file contents differ, as a 1-based line and
 * column plus the differing byte values, or reports a length mismatch when one
 * file is a prefix of the other.
 *
 * @returns The location description, or `undefined` when the contents match.
 */
function describeByteDivergence(web: Buffer, rbx: Buffer): string | undefined {
  const shared = Math.min(web.length, rbx.length);
  for (let offset = 0; offset < shared; offset++) {
    if (web[offset] === rbx[offset]) continue;
    const prefix = web.subarray(0, offset).toString("utf8");
    const line = prefix.split("\n").length;
    const column = offset - prefix.lastIndexOf("\n");
    return `line ${line} column ${column} (byte ${offset}): ${WEB_SIDE}=0x${web[offset].toString(16)} ${RBX_SIDE}=0x${rbx[offset].toString(16)}`;
  }
  if (web.length !== rbx.length) {
    return `byte ${shared}: ${WEB_SIDE} is ${web.length} bytes, ${RBX_SIDE} is ${rbx.length} bytes`;
  }
  return undefined;
}

function buildEnvironments(): { web: MindcraftEnvironment; rbx: MindcraftEnvironment } {
  return {
    web: createMindcraftEnvironment({ modules: [coreModule(), createWebEcosimModule()] }),
    rbx: createMindcraftEnvironment({ modules: [coreModule(), createRbxEcosimModule()] }),
  };
}

const { web: webEnv, rbx: rbxEnv } = buildEnvironments();

function enumValues(members: Record<string, string | number>): number[] {
  return Object.values(members)
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b);
}

function countRules(rules: readonly IBrainRuleDef[]): number {
  return rules.reduce((total, rule) => total + 1 + countRules(rule.children().toArray()), 0);
}

function brainShape(def: IBrainDef): JsonValue {
  return {
    pages: def.pages().toArray().length,
    rulesPerPage: def
      .pages()
      .toArray()
      .map((page) => countRules(page.children().toArray())),
    tileIdsPerPage: def
      .pages()
      .toArray()
      .map((page) => collectTileIds(page.children().toArray())),
  };
}

function collectTileIds(rules: readonly IBrainRuleDef[]): string[] {
  const ids: string[] = [];
  for (const rule of rules) {
    for (const tile of rule.when().tiles().toArray()) ids.push(tile.tileId);
    for (const tile of rule.do().tiles().toArray()) ids.push(tile.tileId);
    ids.push(...collectTileIds(rule.children().toArray()));
  }
  return ids;
}

/**
 * A persisted-brain fixture carrying the legacy `struct:<vector2>` and
 * `struct:<actorRef>` spellings in every position `migrateEcosimBrainJson`
 * rewrites, plus ids it must leave alone. A fresh object is returned on each
 * call because the migration mutates in place.
 */
function legacyBrainJson(): unknown {
  return {
    version: 1,
    name: "Legacy Brain",
    catalog: [
      {
        version: 2,
        kind: "literal",
        tileId: "tile.literal->struct:<vector2>->(1.00, 2.00)",
        valueType: "struct:<vector2>",
      },
      { version: 2, kind: "variable", tileId: "tile.var->struct:<actorRef>->prey", varType: "struct:<actorRef>" },
      { version: 2, kind: "literal", tileId: "tile.literal->number:<number>->0.5", valueType: "number:<number>" },
      { version: 2, kind: "page", pageId: "abc123" },
    ],
    pages: [
      {
        version: 2,
        pageId: "abc123",
        rules: [
          {
            version: 1,
            when: ["tile.sensor->sensor.see", "tile.accessor->struct:<actorRef>->position", "tile.literal"],
            do: ["tile.actuator->actuator.move", "tile.var.factory->struct:<vector2>", 7],
            children: [
              {
                version: 1,
                when: [],
                do: ["tile.var->struct:<vector2>->heading", "tile.accessor->struct:<Vector2>->x"],
              },
            ],
          },
        ],
      },
    ],
  };
}

function loadBrain(env: MindcraftEnvironment, archetype: string, namespace: string): IBrainDef {
  const assetPath = path.join(RBX_APP_ROOT, "src/shared/brains", `default-${archetype}.json`);
  const plain: unknown = JSON.parse(readFileSync(assetPath, "utf8"));
  return env.deserializeBrainJsonFromPlain(plain, namespace);
}

describe("ecosim-rbx mirrors ecosim's brain source files byte for byte", () => {
  for (const pair of BYTE_IDENTICAL_FILES) {
    it(`${pair.rbx} matches ${pair.web}`, () => {
      const webBytes = readFileSync(path.join(ECOSIM_APP_ROOT, pair.web));
      const rbxBytes = readFileSync(path.join(RBX_APP_ROOT, pair.rbx));
      const divergence = describeByteDivergence(webBytes, rbxBytes);
      assert.equal(divergence, undefined, `${pair.rbx} diverges from ${pair.web} at ${divergence}`);
    });
  }
});

describe("ecosim and ecosim-rbx register the same ABI", () => {
  it("shares one @mindcraft-lang/core instance across both registrations", () => {
    assert.equal(
      webEnv.brainServices.constructor,
      rbxEnv.brainServices.constructor,
      "the two environments were built from different core module instances, so their type ids are not comparable"
    );
  });

  it("declares the same module id", () => {
    const webId = createWebEcosimModule().id;
    const rbxId = createRbxEcosimModule().id;
    assert.equal(rbxId, webId, `module id: ${WEB_SIDE}=${webId} ${RBX_SIDE}=${rbxId}`);
  });

  it("registers the same tile catalogs", () => {
    const webCatalogs = snapshotTileCatalogs(webEnv);
    const rbxCatalogs = snapshotTileCatalogs(rbxEnv);
    assert.equal(rbxCatalogs.length, webCatalogs.length, "tile catalog count differs");
    for (let i = 0; i < webCatalogs.length; i++) {
      assertSnapshotMapsEqual(webCatalogs[i], rbxCatalogs[i], `tileCatalogs[${i}]`);
    }
  });

  it("registers the same host actions", () => {
    const registryLabel = "actionRegistry";
    assert.equal(
      rbxEnv.brainServices.runtime.actions.size(),
      webEnv.brainServices.runtime.actions.size(),
      `${registryLabel}.size differs`
    );

    for (const [name, ids] of Object.entries(EcosimHostActions)) {
      const web = snapshotAction(webEnv, ids.key);
      const rbx = snapshotAction(rbxEnv, ids.key);
      assert.notEqual(web, null, `${registryLabel}: ${WEB_SIDE} registers no action under key ${ids.key} (${name})`);
      assert.notEqual(rbx, null, `${registryLabel}: ${RBX_SIDE} registers no action under key ${ids.key} (${name})`);
      assertSnapshotsEqual(web, rbx, `action[${ids.key}]`);

      for (const env of [webEnv, rbxEnv]) {
        const byId = env.brainServices.runtime.actions.getById(ids.actionId);
        assert.equal(
          byId?.descriptor.key,
          ids.key,
          `actionId ${ids.actionId} resolves to ${byId?.descriptor.key ?? "<nothing>"}, expected ${ids.key}`
        );
      }
    }
  });

  it("registers the same types", () => {
    assertSnapshotMapsEqual(snapshotTypes(webEnv), snapshotTypes(rbxEnv), "typeRegistry");

    for (const [name, atomId] of Object.entries(EcosimTypeAtomId).filter(([, value]) => typeof value === "number")) {
      const webTypeId = webEnv.brainServices.runtime.types.resolveByAtomId(atomId as number);
      const rbxTypeId = rbxEnv.brainServices.runtime.types.resolveByAtomId(atomId as number);
      assert.equal(
        rbxTypeId,
        webTypeId,
        `typeAtomId ${String(atomId)} (${name}): ${WEB_SIDE}=${webTypeId ?? "<unregistered>"} ` +
          `${RBX_SIDE}=${rbxTypeId ?? "<unregistered>"}`
      );
    }
  });

  it("registers the same host functions", () => {
    assert.equal(
      rbxEnv.brainServices.runtime.functions.size(),
      webEnv.brainServices.runtime.functions.size(),
      "functionRegistry.size differs"
    );
    const funcIds = [...enumValues(CoreFuncId), ...enumValues(EcosimFuncId)];
    assertSnapshotMapsEqual(snapshotFunctions(webEnv, funcIds), snapshotFunctions(rbxEnv, funcIds), "functionRegistry");
  });

  it("registers the same conversions", () => {
    assertSnapshotMapsEqual(snapshotConversions(webEnv), snapshotConversions(rbxEnv), "conversionRegistry");
  });

  it("registers the same operators", () => {
    const opIds = Object.values(CoreOpId);
    assertSnapshotMapsEqual(snapshotOperators(webEnv, opIds), snapshotOperators(rbxEnv, opIds), "operatorTable");
  });
});

describe("both hosts migrate persisted brain JSON identically", () => {
  it("rewrites the same legacy identifiers", () => {
    const web = legacyBrainJson();
    const rbx = legacyBrainJson();
    createWebEcosimModule().migrateBrainJson?.(web);
    createRbxEcosimModule().migrateBrainJson?.(rbx);
    assertSnapshotsEqual(plainify(web), plainify(rbx), "migrateBrainJson");
  });
});

describe("the shipped brain assets load in both hosts", () => {
  for (const archetype of ARCHETYPES) {
    it(`default-${archetype} deserializes identically`, () => {
      const web = brainShape(loadBrain(webEnv, archetype, WEB_PROJECT_NAMESPACE));
      const rbx = brainShape(loadBrain(rbxEnv, archetype, RBX_PROJECT_NAMESPACE));
      assertSnapshotsEqual(web, rbx, `brain[default-${archetype}]`);
    });
  }
});
