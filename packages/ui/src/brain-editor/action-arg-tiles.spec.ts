import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { IBrainTileDef } from "@wendoo/core/brain";
import { mkVariableFactoryTileId } from "@wendoo/core/brain";
import {
  BrainTileActuatorDef,
  BrainTileModifierDef,
  BrainTileParameterDef,
  BrainTileSensorDef,
} from "@wendoo/core/brain/tiles";
import type { BrainActionCallSpec } from "@wendoo/core/runtime";
import { bag, CoreTypeIds, choice, mkCallDef, mod, optional, param, repeated, seq } from "@wendoo/core/runtime";
import { type ActionArgEntry, getActionArgEntries, resolveTypeDisplayName } from "./action-arg-tiles";

function actuator(callSpec: BrainActionCallSpec): BrainTileActuatorDef {
  return new BrainTileActuatorDef("spec.act", {
    key: "spec.act",
    kind: "actuator",
    callDef: mkCallDef(callSpec),
    isAsync: false,
  });
}

function sensor(callSpec: BrainActionCallSpec): BrainTileSensorDef {
  return new BrainTileSensorDef("spec.sense", {
    key: "spec.sense",
    kind: "sensor",
    callDef: mkCallDef(callSpec),
    isAsync: false,
    outputType: CoreTypeIds.Number,
  });
}

/** Catalog lookup over parameter defs for every `param(id)` and modifier defs for every `mod(id)` id given. */
function catalogOf(paramIds: string[], modifierIds: string[], extraDefs: IBrainTileDef[] = []) {
  const defs = new Map<string, IBrainTileDef>();
  for (const id of paramIds) {
    defs.set(param(id).tileId, new BrainTileParameterDef(id, CoreTypeIds.String));
  }
  for (const id of modifierIds) {
    defs.set(mod(id).tileId, new BrainTileModifierDef(id));
  }
  for (const def of extraDefs) {
    defs.set(def.tileId, def);
  }
  return (tileId: string) => defs.get(tileId);
}

/** Structural projection of an entry: `tile:<tileId>` or `type:<typeId>`. */
function keyOf(entry: ActionArgEntry): string {
  return entry.kind === "tile" ? `tile:${entry.tileDef.tileId}` : `type:${entry.typeId}`;
}

const kStructTypeId = "struct:<specns:/lib.ts::Position>";

describe("getActionArgEntries", () => {
  test("resolves parameter and modifier tiles in call-spec declaration order", () => {
    const tileDef = actuator(
      bag(optional(param("text")), optional(mod("immediately")), optional(mod("in-background")))
    );
    const getTileDef = catalogOf(["text"], ["immediately", "in-background"]);
    assert.deepEqual(getActionArgEntries(tileDef, getTileDef).map(keyOf), [
      `tile:${param("text").tileId}`,
      `tile:${mod("immediately").tileId}`,
      `tile:${mod("in-background").tileId}`,
    ]);
  });

  test("walks choice options, seq items, repeated items, and anonymous slots", () => {
    const tileDef = sensor(
      seq(
        choice(mod("first"), mod("second")),
        repeated(param("extra"), { max: 3 }),
        param("value", { anonymous: true })
      )
    );
    const getTileDef = catalogOf(["extra", "value"], ["first", "second"]);
    assert.deepEqual(getActionArgEntries(tileDef, getTileDef).map(keyOf), [
      `tile:${mod("first").tileId}`,
      `tile:${mod("second").tileId}`,
      `tile:${param("extra").tileId}`,
      `tile:${param("value").tileId}`,
    ]);
  });

  test("omits slots resolving no tile def and hidden tiles outside anonymous slots", () => {
    const hiddenParam = new BrainTileParameterDef("secret", CoreTypeIds.String, { hidden: true });
    const tileDef = actuator(bag(optional(param("unregistered")), optional(param("secret")), optional(mod("loud"))));
    const getTileDef = catalogOf([], ["loud"], [hiddenParam]);
    assert.deepEqual(getActionArgEntries(tileDef, getTileDef).map(keyOf), [`tile:${mod("loud").tileId}`]);
  });

  test("an anonymous slot with a hidden generic parameter yields a type entry", () => {
    const anonNumber = new BrainTileParameterDef("anon.number", CoreTypeIds.Number, { hidden: true });
    const tileDef = actuator(bag(optional(param("anon.number", { anonymous: true }))));
    const entries = getActionArgEntries(tileDef, catalogOf([], [], [anonNumber]));
    assert.deepEqual(entries, [{ kind: "type", typeId: CoreTypeIds.Number, anonymous: true }]);
  });

  test("an anonymous slot with an anon-typed user parameter yields a type entry", () => {
    const anonStruct = new BrainTileParameterDef("anon.specns:/lib.ts::Position", kStructTypeId, {
      anonType: { namespace: "specns", localName: "/lib.ts::Position" },
    });
    const tileDef = actuator(bag(optional(param("anon.specns:/lib.ts::Position", { anonymous: true }))));
    const entries = getActionArgEntries(tileDef, catalogOf([], [], [anonStruct]));
    assert.deepEqual(entries, [{ kind: "type", typeId: kStructTypeId, anonymous: true }]);
  });

  test("a choice of anonymous generic parameters yields type entries in declaration order", () => {
    const anonDefs = [
      new BrainTileParameterDef("anon.number", CoreTypeIds.Number, { hidden: true }),
      new BrainTileParameterDef("anon.string", CoreTypeIds.String, { hidden: true }),
      new BrainTileParameterDef("anon.boolean", CoreTypeIds.Boolean, { hidden: true }),
      new BrainTileParameterDef("anon.buffer", CoreTypeIds.Buffer, { hidden: true }),
    ];
    const tileDef = actuator(
      bag(
        optional(
          choice(
            param("anon.number", { anonymous: true }),
            param("anon.string", { anonymous: true }),
            param("anon.boolean", { anonymous: true }),
            param("anon.buffer", { anonymous: true })
          )
        )
      )
    );
    const entries = getActionArgEntries(tileDef, catalogOf([], [], anonDefs));
    assert.deepEqual(
      entries.map(keyOf),
      [CoreTypeIds.Number, CoreTypeIds.String, CoreTypeIds.Boolean, CoreTypeIds.Buffer].map((t) => `type:${t}`)
    );
  });

  test("a named visible parameter tile in an anonymous slot keeps its tile entry", () => {
    const tileDef = actuator(bag(optional(param("text", { anonymous: true }))));
    const getTileDef = catalogOf(["text"], []);
    assert.deepEqual(getActionArgEntries(tileDef, getTileDef).map(keyOf), [`tile:${param("text").tileId}`]);
  });

  test("carries slot anonymity: anonymous named-tile slots true, placed params and modifiers false", () => {
    const tileDef = actuator(
      bag(optional(param("text", { anonymous: true })), optional(param("duration")), optional(mod("immediately")))
    );
    const getTileDef = catalogOf(["text", "duration"], ["immediately"]);
    const entries = getActionArgEntries(tileDef, getTileDef);
    assert.deepEqual(
      entries.map((entry) => [keyOf(entry), entry.anonymous]),
      [
        [`tile:${param("text").tileId}`, true],
        [`tile:${param("duration").tileId}`, false],
        [`tile:${mod("immediately").tileId}`, false],
      ]
    );
  });

  test("a tile id referenced by more than one slot appears once, at its first slot position", () => {
    const tileDef = actuator(seq(mod("twice"), param("between"), mod("twice")));
    const getTileDef = catalogOf(["between"], ["twice"]);
    assert.deepEqual(getActionArgEntries(tileDef, getTileDef).map(keyOf), [
      `tile:${mod("twice").tileId}`,
      `tile:${param("between").tileId}`,
    ]);
  });

  test("an action without arg slots yields an empty list", () => {
    assert.deepEqual(getActionArgEntries(actuator(bag()), catalogOf([], [])), []);
  });

  test("non-action tile defs and undefined yield an empty list", () => {
    assert.deepEqual(getActionArgEntries(new BrainTileModifierDef("spec.mod"), catalogOf([], [])), []);
    assert.deepEqual(getActionArgEntries(undefined, catalogOf([], [])), []);
  });
});

describe("resolveTypeDisplayName", () => {
  test("prefers the app's friendly name map", () => {
    const name = resolveTypeDisplayName(CoreTypeIds.String, {
      dataTypeNames: new Map([[CoreTypeIds.String, "text"]]),
      getTypeName: () => "string",
    });
    assert.equal(name, "text");
  });

  test("resolves a user struct through its variable factory tile label", () => {
    const factoryTileId = mkVariableFactoryTileId(kStructTypeId);
    const factoryDef = {
      kind: "factory",
      tileId: factoryTileId,
      metadata: { label: "position" },
    } as unknown as IBrainTileDef;
    const name = resolveTypeDisplayName(kStructTypeId, {
      getTileDef: (tileId) => (tileId === factoryTileId ? factoryDef : undefined),
      getTypeName: () => "specns:/lib.ts::Position",
    });
    assert.equal(name, "position");
  });

  test("strips the module qualifier from a registered type name when no other source resolves", () => {
    const name = resolveTypeDisplayName(kStructTypeId, {
      getTypeName: () => "specns:/lib.ts::Position",
    });
    assert.equal(name, "Position");
  });

  test("uses the registered type name verbatim for unqualified names", () => {
    const name = resolveTypeDisplayName(CoreTypeIds.Buffer, { getTypeName: () => "buffer" });
    assert.equal(name, "buffer");
  });
});
