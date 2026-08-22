import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { coreModule, createHostSensor, createWendooEnvironment, List, type WendooModule } from "@wendoo-lang/core";
import { type BrainServices, mkOperatorTileId, TilePlacement } from "@wendoo-lang/core/brain";
import { __test__appendTile } from "@wendoo-lang/core/brain/__test__";
import { BrainDef } from "@wendoo-lang/core/brain/model";
import { BrainTileAccessorDef, BrainTileLiteralDef, BrainTileSensorDef } from "@wendoo-lang/core/brain/tiles";
import {
  CoreOpId,
  CoreTypeIds,
  mkCallDef,
  mkNativeStructValue,
  mkNumberValue,
  mkTypeId,
  NativeType,
  type NumberValue,
  TRUE_VALUE,
  type TypeId,
} from "@wendoo-lang/core/runtime";

/** Host-owned state a native "actor" struct reads from and writes to by reference. */
interface ActorState {
  health: number;
}

/**
 * Register a native reference "Actor" struct (a `fieldSetter`-backed live
 * reference), an always-true WHEN sensor, and two sensors returning the same
 * live actor: one with `writableResult`, one read-only.
 */
function createActorModule(host: ActorState): {
  module: WendooModule;
  captured: {
    actorTypeId?: TypeId;
    writableTile?: BrainTileSensorDef;
    readOnlyTile?: BrainTileSensorDef;
    alwaysTile?: BrainTileSensorDef;
    healthAccessor?: BrainTileAccessorDef;
  };
} {
  const captured: {
    actorTypeId?: TypeId;
    writableTile?: BrainTileSensorDef;
    readOnlyTile?: BrainTileSensorDef;
    alwaysTile?: BrainTileSensorDef;
    healthAccessor?: BrainTileAccessorDef;
  } = {};

  const module: WendooModule = {
    id: "actor-module",
    install(api): void {
      const numTypeId = mkTypeId(NativeType.Number, "number");
      const actorTypeId = api.brainServices.runtime.types.addStructType("Actor", {
        atomId: 40100,
        fields: List.from([{ name: "health", typeId: numTypeId, fieldIndex: 0 }]),
        fieldGetter: (source, fieldId) =>
          fieldId === 0 ? mkNumberValue((source.native as ActorState).health) : undefined,
        fieldSetter: (source, fieldId, val) => {
          if (fieldId === 0) {
            (source.native as ActorState).health = (val as NumberValue).v;
            return true;
          }
          return false;
        },
      });
      captured.actorTypeId = actorTypeId;

      const healthAccessor = new BrainTileAccessorDef(actorTypeId, "health", CoreTypeIds.Number, {
        metadata: { label: "health" },
      });
      api.brainServices.edit.tiles.registerTileDef(healthAccessor);
      captured.healthAccessor = healthAccessor;

      const actorCallDef = mkCallDef({ type: "bag", items: [] });
      const registerActor = (key: string, writableResult: boolean, fnId: number, actionId: number) => {
        const descriptor = {
          key,
          kind: "sensor" as const,
          callDef: actorCallDef,
          isAsync: false,
          outputType: actorTypeId,
        };
        const tile = new BrainTileSensorDef(key, descriptor, {
          placement: TilePlacement.EitherSide | TilePlacement.Inline,
          writableResult,
          metadata: { label: key },
        });
        api.registerHostSensor({
          descriptor,
          actionId,
          function: {
            id: fnId,
            name: key,
            isAsync: false,
            fn: { exec: () => mkNativeStructValue(actorTypeId, host) },
            callDef: actorCallDef,
          },
          actionFn: { exec: () => mkNativeStructValue(actorTypeId, host) },
          tile,
        });
        return tile;
      };
      captured.writableTile = registerActor("game.actor", true, 40201, 40301);
      captured.readOnlyTile = registerActor("readonly.actor", false, 40202, 40302);

      const alwaysCallDef = mkCallDef({ type: "bag", items: [] });
      const alwaysDescriptor = {
        key: "always",
        kind: "sensor" as const,
        callDef: alwaysCallDef,
        isAsync: false,
        outputType: CoreTypeIds.Boolean,
      };
      const alwaysTile = new BrainTileSensorDef("always", alwaysDescriptor, {
        placement: TilePlacement.EitherSide | TilePlacement.Inline,
      });
      api.registerHostSensor({
        descriptor: alwaysDescriptor,
        actionId: 40303,
        function: {
          id: 40203,
          name: "always",
          isAsync: false,
          fn: { exec: () => TRUE_VALUE },
          callDef: alwaysCallDef,
        },
        actionFn: { exec: () => TRUE_VALUE },
        tile: alwaysTile,
      });
      captured.alwaysTile = alwaysTile;
    },
  };

  return { module, captured };
}

function getEnvironmentServices(environment: { brainServices?: BrainServices }): BrainServices {
  return (environment as unknown as { brainServices: BrainServices }).brainServices;
}

describe("createHostSensor `writableResult` forwarding", () => {
  test("writableResult: true forwards to the sensor tile def", () => {
    const def = createHostSensor({
      key: "wr.on",
      actionId: 41001,
      fnId: 41101,
      isAsync: false,
      fn: { exec: () => TRUE_VALUE },
      callDef: mkCallDef({ type: "bag", items: [] }),
      outputType: CoreTypeIds.Boolean,
      writableResult: true,
    });
    assert.equal((def.tile as BrainTileSensorDef).writableResult, true);
  });

  test("a sensor without writableResult defaults to a read-only result", () => {
    const def = createHostSensor({
      key: "wr.off",
      actionId: 41002,
      fnId: 41102,
      isAsync: false,
      fn: { exec: () => TRUE_VALUE },
      callDef: mkCallDef({ type: "bag", items: [] }),
      outputType: CoreTypeIds.Boolean,
    });
    assert.equal((def.tile as BrainTileSensorDef).writableResult, false);
  });
});

describe("createHostSensor `inline` forwarding", () => {
  test("inline: true gives the sensor tile inline placement", () => {
    const def = createHostSensor({
      key: "inl.on",
      actionId: 41003,
      fnId: 41103,
      isAsync: false,
      fn: { exec: () => mkNumberValue(0) },
      callDef: mkCallDef({ type: "bag", items: [] }),
      outputType: CoreTypeIds.Number,
      inline: true,
    });
    const placement = (def.tile as BrainTileSensorDef).placement;
    assert.ok(placement !== undefined);
    assert.equal((placement & TilePlacement.Inline) !== 0, true, "an inline sensor must carry the Inline bit");
    assert.equal((placement & TilePlacement.EitherSide) === TilePlacement.EitherSide, true);
  });

  test("a sensor without inline keeps the default WHEN-side-only placement", () => {
    const def = createHostSensor({
      key: "inl.off",
      actionId: 41004,
      fnId: 41104,
      isAsync: false,
      fn: { exec: () => mkNumberValue(0) },
      callDef: mkCallDef({ type: "bag", items: [] }),
      outputType: CoreTypeIds.Number,
    });
    const placement = (def.tile as BrainTileSensorDef).placement;
    assert.equal(placement !== undefined && (placement & TilePlacement.Inline) !== 0, false);
  });

  test("inline: true with a non-empty callDef throws", () => {
    assert.throws(
      () =>
        createHostSensor({
          key: "inl.args",
          actionId: 41005,
          fnId: 41105,
          isAsync: false,
          fn: { exec: () => mkNumberValue(0) },
          callDef: mkCallDef({ type: "bag", items: [{ type: "arg", tileId: "x" }] }),
          outputType: CoreTypeIds.Number,
          inline: true,
        }),
      /takes no arguments/
    );
  });
});

describe("writableResult sensor field write (headless, native reference struct)", () => {
  function setup(host: ActorState) {
    const { module, captured } = createActorModule(host);
    const environment = createWendooEnvironment({ modules: [coreModule(), module] });
    const services = getEnvironmentServices(environment);
    return { environment, services, captured };
  }

  // DO: [sensor] [health] [=] [42]
  function appendActorAssignRule(
    brainDef: BrainDef,
    services: BrainServices,
    captured: { alwaysTile?: BrainTileSensorDef; healthAccessor?: BrainTileAccessorDef },
    actorTile: BrainTileSensorDef
  ): void {
    const rule = brainDef.pages().get(0)!.children().get(0)!;
    __test__appendTile(rule.when(), captured.alwaysTile!);
    __test__appendTile(rule.do(), actorTile);
    __test__appendTile(rule.do(), captured.healthAccessor!);
    __test__appendTile(rule.do(), services.edit.tiles.get(mkOperatorTileId(CoreOpId.Assign))!);
    __test__appendTile(rule.do(), new BrainTileLiteralDef(CoreTypeIds.Number, 42, {}, services));
  }

  test("green: a writableResult sensor result is mutated by a field write end to end", () => {
    const host: ActorState = { health: 100 };
    const { environment, services, captured } = setup(host);
    const brainDef = BrainDef.emptyBrainDef(services, "Actor Brain");
    appendActorAssignRule(brainDef, services, captured, captured.writableTile!);

    const brain = environment.createBrain(brainDef);
    assert.equal(brain.status, "active", "the brain must build");
    brain.startup();
    brain.think(1);

    assert.equal(host.health, 42, "the field write must mutate the live actor state");
  });

  test("red: the same field write on a read-only sensor result is rejected and mutates nothing", () => {
    const host: ActorState = { health: 100 };
    const { environment, services, captured } = setup(host);
    const brainDef = BrainDef.emptyBrainDef(services, "ReadOnly Actor Brain");
    appendActorAssignRule(brainDef, services, captured, captured.readOnlyTile!);

    // The assignment is rejected during rule compilation (an ErrorExpr), so the
    // brain drops that action and the live actor state is never written.
    const brain = environment.createBrain(brainDef);
    brain.startup();
    brain.think(1);

    assert.equal(host.health, 100, "a read-only sensor result must not be mutated by the rejected field write");
  });
});
