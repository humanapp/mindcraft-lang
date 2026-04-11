import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type CompiledActionArtifact,
  type CompiledActionBundle,
  coreModule,
  createMindcraftEnvironment,
  Dict,
  List,
  type MindcraftEnvironment,
  type MindcraftModule,
} from "@mindcraft-lang/core";
import {
  type BrainServices,
  BYTECODE_VERSION,
  CoreSensorId,
  CoreTypeIds,
  type ExecutionContext,
  type ITileCatalog,
  type MapValue,
  mkCallDef,
  mkNumberValue,
  mkTypeId,
  mkVariableTileId,
  NativeType,
  Op,
  type StructTypeDef,
  TilePlacement,
  TRUE_VALUE,
} from "@mindcraft-lang/core/brain";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileParameterDef, BrainTileSensorDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";

const noopCodec = {
  encode(): void {},
  decode(): undefined {
    return undefined;
  },
  stringify(): string {
    return "noop";
  },
};

type MindcraftEnvironmentInternals = {
  brainServices: BrainServices;
  bundleCatalog: ITileCatalog;
  trackedBrains: List<unknown>;
  invalidatedBrains: List<unknown>;
  buildCatalogChain(definition: BrainDef, overlays: List<ITileCatalog>): List<ITileCatalog>;
};

function getEnvironmentServices(environment: MindcraftEnvironment): BrainServices {
  return (environment as unknown as { brainServices: BrainServices }).brainServices;
}

function getEnvironmentInternals(environment: MindcraftEnvironment): MindcraftEnvironmentInternals {
  return environment as unknown as MindcraftEnvironmentInternals;
}

function getRawCatalog(catalog: unknown): ITileCatalog {
  return (catalog as { rawCatalog(): ITileCatalog }).rawCatalog();
}

function resolveTileFromChain(catalogs: List<ITileCatalog>, tileId: string): BrainTileSensorDef | undefined {
  for (let i = 0; i < catalogs.size(); i++) {
    const tile = catalogs.get(i)!.get(tileId);
    if (tile) {
      return tile as BrainTileSensorDef;
    }
  }
  return undefined;
}

function createAlphaModule(capture: {
  sensorTile?: BrainTileSensorDef;
  parameterTile?: BrainTileParameterDef;
  typeId?: string;
}): MindcraftModule {
  return {
    id: "alpha-module",
    install(api): void {
      const alphaTypeId = mkTypeId(NativeType.Struct, "AlphaThing");
      const alphaDef: StructTypeDef = {
        coreType: NativeType.Struct,
        typeId: alphaTypeId,
        codec: noopCodec,
        name: "AlphaThing",
        fields: List.empty(),
      };
      capture.typeId = api.defineType(alphaDef);

      const helperCallDef = mkCallDef({ type: "bag", items: [] });
      api.registerFunction({
        name: "alpha.helper",
        isAsync: false,
        fn: {
          exec: (_ctx: ExecutionContext, _args: MapValue) => mkNumberValue(7),
        },
        callDef: helperCallDef,
      });

      api.registerOperator({
        spec: {
          id: "alpha_eq",
          parse: { fixity: "infix", precedence: 4, assoc: "none" },
        },
        overloads: [
          {
            argTypes: [CoreTypeIds.Number, CoreTypeIds.Number],
            resultType: CoreTypeIds.Boolean,
            fn: {
              exec: () => TRUE_VALUE,
            },
          },
        ],
      });

      capture.parameterTile = new BrainTileParameterDef("alpha-extra", CoreTypeIds.Number, { hidden: true });
      api.registerTile(capture.parameterTile);

      const sensorCallDef = mkCallDef({ type: "bag", items: [] });
      const descriptor = {
        key: "alpha.sensor",
        kind: "sensor" as const,
        callDef: sensorCallDef,
        isAsync: false,
        outputType: CoreTypeIds.Boolean,
      };
      capture.sensorTile = new BrainTileSensorDef("alpha.sensor", descriptor, {
        placement: TilePlacement.EitherSide | TilePlacement.Inline,
      });
      api.registerHostSensor({
        descriptor,
        function: {
          name: "alpha.sensor",
          isAsync: false,
          fn: {
            exec: () => TRUE_VALUE,
          },
          callDef: sensorCallDef,
        },
        tile: capture.sensorTile,
      });
    },
  };
}

function createHostSensorModule(
  moduleId: string,
  key: string,
  sensorId: string = key
): { module: MindcraftModule; tile: BrainTileSensorDef } {
  const sensorCallDef = mkCallDef({ type: "bag", items: [] });
  const descriptor = {
    key,
    kind: "sensor" as const,
    callDef: sensorCallDef,
    isAsync: false,
    outputType: CoreTypeIds.Boolean,
  };
  const tile = new BrainTileSensorDef(sensorId, descriptor, {
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
            fn: {
              exec: () => TRUE_VALUE,
            },
            callDef: sensorCallDef,
          },
          tile,
        });
      },
    },
  };
}

function createBundleSensor(
  key: string,
  sensorId: string = key,
  visualLabel?: string
): { artifact: CompiledActionArtifact; tile: BrainTileSensorDef } {
  const descriptor = {
    key,
    kind: "sensor" as const,
    callDef: mkCallDef({ type: "bag", items: [] }),
    isAsync: false,
    outputType: CoreTypeIds.Boolean,
  };

  return {
    artifact: {
      version: BYTECODE_VERSION,
      functions: List.from([
        {
          code: List.from([{ op: Op.RET }]),
          numParams: 0,
          name: "entry",
        },
      ]),
      constants: List.empty(),
      variableNames: List.empty(),
      entryPoint: 0,
      key: descriptor.key,
      kind: descriptor.kind,
      callDef: descriptor.callDef,
      outputType: descriptor.outputType,
      isAsync: descriptor.isAsync,
      numStateSlots: 0,
      entryFuncId: 0,
      revisionId: `${key}.rev1`,
    },
    tile: new BrainTileSensorDef(sensorId, descriptor, {
      placement: TilePlacement.EitherSide | TilePlacement.Inline,
      metadata: visualLabel ? { label: visualLabel } : undefined,
    }),
  };
}

function withRevision(artifact: CompiledActionArtifact, revisionId: string): CompiledActionArtifact {
  return {
    ...artifact,
    revisionId,
  };
}

function createActionBundle(
  revision: string,
  entries: readonly { artifact: CompiledActionArtifact; tile: BrainTileSensorDef }[]
): CompiledActionBundle {
  const actions = new Dict<string, CompiledActionArtifact>();
  const tiles = List.empty<BrainTileSensorDef>();

  const entryList = List.from(entries);
  for (let i = 0; i < entryList.size(); i++) {
    const entry = entryList.get(i)!;
    actions.set(entry.artifact.key, entry.artifact);
    tiles.push(entry.tile);
  }

  return {
    revision,
    actions,
    tiles: tiles.toArray(),
  };
}

function createSensorBrainDef(services: BrainServices, name: string, sensorTile: BrainTileSensorDef): BrainDef {
  const brainDef = BrainDef.emptyBrainDef(services, name);
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(sensorTile);
  return brainDef;
}

describe("mindcraft environment", () => {
  test("isolates module-owned registries between environments", () => {
    const capture: {
      sensorTile?: BrainTileSensorDef;
      parameterTile?: BrainTileParameterDef;
      typeId?: string;
    } = {};

    const envA = createMindcraftEnvironment({ modules: [coreModule(), createAlphaModule(capture)] });
    const envB = createMindcraftEnvironment({ modules: [coreModule()] });

    const servicesA = getEnvironmentServices(envA);
    const servicesB = getEnvironmentServices(envB);

    assert.equal(servicesA.types.resolveByName("AlphaThing"), capture.typeId);
    assert.equal(servicesB.types.resolveByName("AlphaThing"), undefined);

    assert.ok(servicesA.functions.get("alpha.helper"));
    assert.equal(servicesB.functions.get("alpha.helper"), undefined);

    const alphaTile = servicesA.tiles.get(capture.parameterTile!.tileId);
    assert.ok(alphaTile);
    assert.equal(alphaTile.tileId, capture.parameterTile!.tileId);
    assert.equal(servicesB.tiles.get(capture.parameterTile!.tileId), undefined);

    const alphaAction = servicesA.actions.getByKey("alpha.sensor");
    assert.ok(alphaAction);
    assert.equal(servicesB.actions.getByKey("alpha.sensor"), undefined);

    assert.ok(servicesA.operatorTable.get("alpha_eq"));
    assert.equal(servicesB.operatorTable.get("alpha_eq"), undefined);

    const brainDef = BrainDef.emptyBrainDef(servicesA, "Alpha Brain");
    const rule = brainDef.pages().get(0)!.children().get(0)!;
    rule.when().appendTile(capture.sensorTile!);

    const serialized = brainDef.toJson();
    const restored = envA.deserializeBrainJson(serialized);
    assert.equal(restored.pages().get(0)!.children().get(0)!.when().tiles().get(0)!.tileId, capture.sensorTile!.tileId);
    assert.throws(() => envB.deserializeBrainJson(serialized), /alpha.sensor/);

    const alphaBrain = envA.createBrain(brainDef);
    assert.equal(alphaBrain.status, "active");
    assert.throws(() => envB.createBrain(brainDef), /alpha.sensor/);
  });

  test("creates independent runnable brains from one definition", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const sharedDefinition = BrainDef.emptyBrainDef(getEnvironmentServices(environment), "Reusable Brain");
    sharedDefinition.appendNewPage();

    const firstPageId = sharedDefinition.pages().get(0)!.pageId();
    const secondPageId = sharedDefinition.pages().get(1)!.pageId();

    const firstBrain = environment.createBrain(sharedDefinition, { context: { id: "first" } });
    const secondBrain = environment.createBrain(sharedDefinition, { context: { id: "second" } });

    firstBrain.startup();
    secondBrain.startup();

    firstBrain.requestPageChange(1);
    firstBrain.think(1);

    assert.equal(firstBrain.getCurrentPageId(), secondPageId);
    assert.equal(secondBrain.getCurrentPageId(), firstPageId);

    firstBrain.setVariable("counter", mkNumberValue(42));
    assert.equal((firstBrain.getVariable("counter") as { v: number }).v, 42);
    assert.equal(secondBrain.getVariable("counter"), undefined);
    assert.notEqual(firstBrain.getProgram(), secondBrain.getProgram());
  });

  test("deserializes persisted brains through the environment", () => {
    const capture: {
      sensorTile?: BrainTileSensorDef;
      parameterTile?: BrainTileParameterDef;
      typeId?: string;
    } = {};
    const environment = createMindcraftEnvironment({ modules: [coreModule(), createAlphaModule(capture)] });

    const brainDef = BrainDef.emptyBrainDef(getEnvironmentServices(environment), "Persisted Brain");
    const rule = brainDef.pages().get(0)!.children().get(0)!;
    const variableTile = new BrainTileVariableDef(
      mkVariableTileId("counter-id"),
      "counter",
      CoreTypeIds.Number,
      "counter-id"
    );

    brainDef.catalog().registerTileDef(variableTile);
    rule.when().appendTile(capture.sensorTile!);
    rule.do().appendTile(variableTile);

    const restoredFromJson = environment.deserializeBrainJson(brainDef.toJson());
    const restoredJsonRule = restoredFromJson.pages().get(0)!.children().get(0)!;
    assert.equal(restoredJsonRule.when().tiles().get(0)!.tileId, capture.sensorTile!.tileId);
    assert.equal(restoredJsonRule.do().tiles().get(0)!.tileId, variableTile.tileId);
  });

  test("deserializes persisted brains against hydrated and bundled tile metadata", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const bundled = createBundleSensor("bundle.persisted");
    const brainDef = createSensorBrainDef(getEnvironmentServices(environment), "Hydrated Brain", bundled.tile);

    assert.throws(() => environment.deserializeBrainJson(brainDef.toJson()), /bundle\.persisted/);

    environment.hydrateTileMetadata({
      revision: "hydrated.bundle.persisted",
      tiles: [bundled.tile],
    });

    const restoredFromJson = environment.deserializeBrainJson(brainDef.toJson());
    assert.equal(
      restoredFromJson.pages().get(0)!.children().get(0)!.when().tiles().get(0)!.tileId,
      bundled.tile.tileId
    );

    assert.throws(() => environment.createBrain(restoredFromJson), /bundle\.persisted/);

    environment.replaceActionBundle(createActionBundle("bundle.persisted.rev1", [bundled]));

    const brain = environment.createBrain(restoredFromJson);
    assert.equal(brain.status, "active");
  });

  test("builds catalog chains with shared-first precedence", () => {
    const sharedSensor = createHostSensorModule("shared-order-module", "shared.order", "shared-order");
    const environment = createMindcraftEnvironment({ modules: [coreModule(), sharedSensor.module] });
    const internals = getEnvironmentInternals(environment);
    const overlay = environment.createCatalog();
    const overlayRaw = getRawCatalog(overlay);

    const overlayShared = createBundleSensor("overlay.shared", "shared-order").tile;
    const overlayLayered = createBundleSensor("overlay.layered", "layered-order").tile;
    overlay.registerTile(overlayShared);
    overlay.registerTile(overlayLayered);

    const localShared = createBundleSensor("local.shared", "shared-order").tile;
    const localLayered = createBundleSensor("local.layered", "layered-order").tile;
    const brainDef = BrainDef.emptyBrainDef(getEnvironmentServices(environment), "Catalog Order Brain");
    brainDef.catalog().registerTileDef(localShared);
    brainDef.catalog().registerTileDef(localLayered);

    const initialChain = internals.buildCatalogChain(brainDef, List.from([overlayRaw]));
    assert.equal(initialChain.size(), 3);
    assert.equal(initialChain.get(0), internals.brainServices.tiles);
    assert.equal(initialChain.get(1), overlayRaw);
    assert.equal(initialChain.get(2), brainDef.catalog());
    assert.equal(resolveTileFromChain(initialChain, sharedSensor.tile.tileId), sharedSensor.tile);
    assert.equal(resolveTileFromChain(initialChain, overlayLayered.tileId), overlayLayered);

    const hydratedShared = createBundleSensor("hydrated.shared", "shared-order").tile;
    const hydratedLayered = createBundleSensor("hydrated.layered", "layered-order").tile;
    environment.hydrateTileMetadata({
      revision: "hydrated.rev1",
      tiles: [hydratedShared, hydratedLayered],
    });

    const hydratedChain = internals.buildCatalogChain(brainDef, List.from([overlayRaw]));
    assert.equal(hydratedChain.size(), 4);
    assert.equal(hydratedChain.get(0), internals.brainServices.tiles);
    assert.equal(hydratedChain.get(1), internals.bundleCatalog);
    assert.equal(hydratedChain.get(2), overlayRaw);
    assert.equal(hydratedChain.get(3), brainDef.catalog());
    assert.equal(resolveTileFromChain(hydratedChain, sharedSensor.tile.tileId), sharedSensor.tile);
    assert.equal(resolveTileFromChain(hydratedChain, overlayLayered.tileId), hydratedLayered);

    const bundleShared = createBundleSensor("bundle.shared", "shared-order");
    const bundleLayered = createBundleSensor("bundle.layered", "layered-order");
    environment.replaceActionBundle(createActionBundle("bundle.rev1", [bundleShared, bundleLayered]));

    const bundleChain = internals.buildCatalogChain(brainDef, List.from([overlayRaw]));
    assert.equal(bundleChain.size(), 4);
    assert.equal(bundleChain.get(0), internals.brainServices.tiles);
    assert.equal(bundleChain.get(1), internals.bundleCatalog);
    assert.equal(bundleChain.get(2), overlayRaw);
    assert.equal(bundleChain.get(3), brainDef.catalog());
    assert.equal(resolveTileFromChain(bundleChain, sharedSensor.tile.tileId), sharedSensor.tile);
    assert.equal(resolveTileFromChain(bundleChain, overlayLayered.tileId), bundleLayered.tile);
  });

  test("stores hydrated and bundled tiles without mutating tile metadata", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const internals = getEnvironmentInternals(environment);

    const hydrated = createBundleSensor("hydrated.visual");
    environment.hydrateTileMetadata({
      revision: "hydrated.visual.rev1",
      tiles: [hydrated.tile],
    });

    assert.equal(internals.bundleCatalog.get(hydrated.tile.tileId)?.metadata, undefined);

    const bundled = createBundleSensor("bundle.visual");
    environment.replaceActionBundle(createActionBundle("bundle.visual.rev1", [bundled]));

    assert.equal(internals.bundleCatalog.get(bundled.tile.tileId)?.metadata, undefined);
  });

  test("selectively invalidates brains whose linked bundle action revisions change", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const alpha = createBundleSensor("bundle.alpha");
    const beta = createBundleSensor("bundle.beta");

    environment.replaceActionBundle(createActionBundle("bundle.rev1", [alpha, beta]));

    const alphaBrain = environment.createBrain(
      createSensorBrainDef(getEnvironmentServices(environment), "Alpha Brain", alpha.tile)
    );
    const betaBrain = environment.createBrain(
      createSensorBrainDef(getEnvironmentServices(environment), "Beta Brain", beta.tile)
    );
    const localBrain = environment.createBrain(
      BrainDef.emptyBrainDef(getEnvironmentServices(environment), "Local Brain")
    );

    const events: {
      changedActionKeys: readonly string[];
      invalidatedBrains: readonly unknown[];
    }[] = [];
    const unsubscribe = environment.onBrainsInvalidated((event) => {
      events.push(event);
    });

    const revisionOnlyUpdate = environment.replaceActionBundle(createActionBundle("bundle.rev2", [alpha, beta]));

    assert.deepEqual(revisionOnlyUpdate.changedActionKeys, []);
    assert.equal(revisionOnlyUpdate.invalidatedBrains.length, 0);
    assert.equal(alphaBrain.status, "active");
    assert.equal(betaBrain.status, "active");
    assert.equal(localBrain.status, "active");

    const selectiveUpdate = environment.replaceActionBundle(
      createActionBundle("bundle.rev3", [
        { artifact: withRevision(alpha.artifact, "bundle.alpha.rev2"), tile: alpha.tile },
        beta,
      ])
    );

    unsubscribe();

    assert.deepEqual(selectiveUpdate.changedActionKeys, ["bundle.alpha"]);
    assert.equal(selectiveUpdate.invalidatedBrains.length, 1);
    assert.equal(selectiveUpdate.invalidatedBrains[0], alphaBrain);
    assert.equal(alphaBrain.status, "invalidated");
    assert.equal(betaBrain.status, "active");
    assert.equal(localBrain.status, "active");

    assert.equal(events.length, 1);
    assert.deepEqual(events[0]!.changedActionKeys, ["bundle.alpha"]);
    assert.equal(events[0]!.invalidatedBrains.length, 1);
    assert.equal(events[0]!.invalidatedBrains[0], alphaBrain);

    environment.rebuildInvalidatedBrains();

    assert.equal(alphaBrain.status, "active");
    assert.equal(betaBrain.status, "active");
    assert.equal(localBrain.status, "active");
  });

  test("rebuildInvalidatedBrains without args rebuilds all brains invalidated across overlapping replacements", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const alpha = createBundleSensor("bundle.alpha");
    const beta = createBundleSensor("bundle.beta");

    environment.replaceActionBundle(createActionBundle("bundle.rev1", [alpha, beta]));

    const alphaBrain = environment.createBrain(
      createSensorBrainDef(getEnvironmentServices(environment), "Alpha Brain", alpha.tile)
    );
    const betaBrain = environment.createBrain(
      createSensorBrainDef(getEnvironmentServices(environment), "Beta Brain", beta.tile)
    );

    const firstUpdate = environment.replaceActionBundle(
      createActionBundle("bundle.rev2", [
        { artifact: withRevision(alpha.artifact, "bundle.alpha.rev2"), tile: alpha.tile },
        beta,
      ])
    );

    assert.equal(firstUpdate.invalidatedBrains.length, 1);
    assert.equal(firstUpdate.invalidatedBrains[0], alphaBrain);
    assert.equal(alphaBrain.status, "invalidated");
    assert.equal(betaBrain.status, "active");

    const secondUpdate = environment.replaceActionBundle(
      createActionBundle("bundle.rev3", [
        { artifact: withRevision(alpha.artifact, "bundle.alpha.rev2"), tile: alpha.tile },
        { artifact: withRevision(beta.artifact, "bundle.beta.rev2"), tile: beta.tile },
      ])
    );

    assert.equal(secondUpdate.invalidatedBrains.length, 1);
    assert.equal(secondUpdate.invalidatedBrains[0], betaBrain);
    assert.equal(alphaBrain.status, "invalidated");
    assert.equal(betaBrain.status, "invalidated");

    environment.rebuildInvalidatedBrains();

    assert.equal(alphaBrain.status, "active");
    assert.equal(betaBrain.status, "active");
  });

  test("disposing a brain removes it from tracking and excludes it from later invalidation and rebuild", () => {
    const environment = createMindcraftEnvironment({ modules: [coreModule()] });
    const internals = getEnvironmentInternals(environment);
    const alpha = createBundleSensor("bundle.alpha");
    const beta = createBundleSensor("bundle.beta");

    environment.replaceActionBundle(createActionBundle("bundle.rev1", [alpha, beta]));

    const alphaBrain = environment.createBrain(
      createSensorBrainDef(getEnvironmentServices(environment), "Alpha Brain", alpha.tile)
    );
    const betaBrain = environment.createBrain(
      createSensorBrainDef(getEnvironmentServices(environment), "Beta Brain", beta.tile)
    );

    assert.equal(internals.trackedBrains.size(), 2);
    assert.equal(internals.invalidatedBrains.size(), 0);

    const invalidation = environment.replaceActionBundle(
      createActionBundle("bundle.rev2", [
        { artifact: withRevision(alpha.artifact, "bundle.alpha.rev2"), tile: alpha.tile },
        beta,
      ])
    );

    assert.equal(invalidation.invalidatedBrains.length, 1);
    assert.equal(invalidation.invalidatedBrains[0], alphaBrain);
    assert.equal(internals.trackedBrains.size(), 2);
    assert.equal(internals.invalidatedBrains.size(), 1);

    alphaBrain.dispose();

    assert.equal(alphaBrain.status, "disposed");
    assert.equal(betaBrain.status, "active");
    assert.equal(internals.trackedBrains.size(), 1);
    assert.equal(internals.invalidatedBrains.size(), 0);

    const disposedOnlyUpdate = environment.replaceActionBundle(
      createActionBundle("bundle.rev3", [
        { artifact: withRevision(alpha.artifact, "bundle.alpha.rev3"), tile: alpha.tile },
        beta,
      ])
    );

    assert.deepEqual(disposedOnlyUpdate.changedActionKeys, ["bundle.alpha"]);
    assert.equal(disposedOnlyUpdate.invalidatedBrains.length, 0);

    environment.rebuildInvalidatedBrains();

    assert.equal(alphaBrain.status, "disposed");
    assert.equal(betaBrain.status, "active");
    assert.equal(internals.trackedBrains.size(), 1);
    assert.equal(internals.invalidatedBrains.size(), 0);
  });

  test("keeps tile presentation isolated between environments", () => {
    const envA = createMindcraftEnvironment({ modules: [coreModule()] });
    const envB = createMindcraftEnvironment({ modules: [coreModule()] });
    const bundleA = createBundleSensor("bundle.visual", "bundle.visual", "Alpha Label");
    const bundleB = createBundleSensor("bundle.visual", "bundle.visual", "Beta Label");

    envA.replaceActionBundle(createActionBundle("bundle.visual.revA", [bundleA]));
    envB.replaceActionBundle(createActionBundle("bundle.visual.revB", [bundleB]));

    const json = createSensorBrainDef(getEnvironmentServices(envA), "Visual Brain", bundleA.tile).toJson();
    const restoredA = envA.deserializeBrainJson(json);
    const restoredB = envB.deserializeBrainJson(json);
    const restoredTileA = restoredA.pages().get(0)!.children().get(0)!.when().tiles().get(0)!;
    const restoredTileB = restoredB.pages().get(0)!.children().get(0)!.when().tiles().get(0)!;

    assert.equal(restoredTileA.tileId, restoredTileB.tileId);
    assert.equal(restoredTileA.metadata?.label, "Alpha Label");
    assert.equal(restoredTileB.metadata?.label, "Beta Label");
    assert.notEqual(restoredTileA.metadata?.label, restoredTileB.metadata?.label);
  });
});
