import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { IBrainTileDef } from "@wendoo/core/brain";
import {
  BrainTileActuatorDef,
  BrainTileModifierDef,
  BrainTileOutputDef,
  BrainTileParameterDef,
  BrainTileSensorDef,
} from "@wendoo/core/brain/tiles";
import { CoreTypeIds, mkCallDef } from "@wendoo/core/runtime";
import {
  groupTilesByLibrary,
  isProjectAuthoredActionTile,
  type TileSourceLibrary,
  tileSourceNamespace,
} from "./tile-library-groups";

const emptyCallDef = () => mkCallDef({ type: "bag", items: [] });

function actuator(key: string, namespace?: string): BrainTileActuatorDef {
  return new BrainTileActuatorDef(
    key,
    { key, kind: "actuator", callDef: emptyCallDef(), isAsync: false },
    namespace !== undefined ? { userIdentity: { namespace, actionId: key } } : {}
  );
}

function sensor(key: string, namespace?: string): BrainTileSensorDef {
  return new BrainTileSensorDef(
    key,
    { key, kind: "sensor", callDef: emptyCallDef(), isAsync: false, outputType: CoreTypeIds.Number },
    namespace !== undefined ? { userIdentity: { namespace, actionId: key } } : {}
  );
}

const LIB_A: TileSourceLibrary = { coordinate: "owner/lib-a", name: "Alpha" };
const LIB_B: TileSourceLibrary = { coordinate: "owner/lib-b", name: "Beta" };
const LIB_C: TileSourceLibrary = { coordinate: "owner/lib-c", name: "Gamma" };

describe("tileSourceNamespace", () => {
  test("reads the identity namespace of user actuator, sensor, output, parameter, and modifier tiles", () => {
    assert.equal(tileSourceNamespace(actuator("a", "owner/lib-a")), "owner/lib-a");
    assert.equal(tileSourceNamespace(sensor("s", "owner/lib-b")), "owner/lib-b");
    assert.equal(
      tileSourceNamespace(new BrainTileOutputDef(CoreTypeIds.Number, "reading", { namespace: "owner/lib-a" })),
      "owner/lib-a"
    );
    assert.equal(
      tileSourceNamespace(
        new BrainTileParameterDef("p", CoreTypeIds.Number, {
          userArg: { namespace: "owner/lib-b", actionId: "act", argName: "p" },
        })
      ),
      "owner/lib-b"
    );
    assert.equal(
      tileSourceNamespace(
        new BrainTileModifierDef("m", { userArg: { namespace: "owner/lib-c", actionId: "act", argName: "m" } })
      ),
      "owner/lib-c"
    );
  });

  test("returns undefined for platform tiles and identity-less kinds", () => {
    assert.equal(tileSourceNamespace(actuator("platform")), undefined);
    assert.equal(tileSourceNamespace(sensor("platform")), undefined);
    assert.equal(tileSourceNamespace(new BrainTileOutputDef(CoreTypeIds.Number, "reading")), undefined);
    assert.equal(tileSourceNamespace(new BrainTileParameterDef("p", CoreTypeIds.Number)), undefined);
    assert.equal(tileSourceNamespace(new BrainTileModifierDef("m")), undefined);
  });
});

describe("isProjectAuthoredActionTile", () => {
  test("matches sensors and actuators whose identity namespace equals the project namespace", () => {
    assert.equal(isProjectAuthoredActionTile(actuator("a", "project-store-id"), "project-store-id"), true);
    assert.equal(isProjectAuthoredActionTile(sensor("s", "project-store-id"), "project-store-id"), true);
  });

  test("rejects library tiles, platform tiles, and an undefined project namespace", () => {
    assert.equal(isProjectAuthoredActionTile(actuator("a", LIB_A.coordinate), "project-store-id"), false);
    assert.equal(isProjectAuthoredActionTile(sensor("s", LIB_B.coordinate), "project-store-id"), false);
    assert.equal(isProjectAuthoredActionTile(actuator("platform"), "project-store-id"), false);
    assert.equal(isProjectAuthoredActionTile(actuator("platform"), undefined), false);
    assert.equal(isProjectAuthoredActionTile(actuator("a", "project-store-id"), undefined), false);
  });

  test("rejects non-action tile kinds even when their namespace matches", () => {
    assert.equal(
      isProjectAuthoredActionTile(
        new BrainTileOutputDef(CoreTypeIds.Number, "reading", { namespace: "project-store-id" }),
        "project-store-id"
      ),
      false
    );
    assert.equal(
      isProjectAuthoredActionTile(
        new BrainTileParameterDef("p", CoreTypeIds.Number, {
          userArg: { namespace: "project-store-id", actionId: "act", argName: "p" },
        }),
        "project-store-id"
      ),
      false
    );
    assert.equal(
      isProjectAuthoredActionTile(
        new BrainTileModifierDef("m", { userArg: { namespace: "project-store-id", actionId: "act", argName: "m" } }),
        "project-store-id"
      ),
      false
    );
  });
});

describe("groupTilesByLibrary", () => {
  const identity = (tileDef: IBrainTileDef) => tileDef;

  test("without libraries every tile is unattributed and no clusters form", () => {
    const tiles = [actuator("a", "owner/lib-a"), sensor("s")];
    const groups = groupTilesByLibrary(tiles, identity, undefined);
    assert.deepEqual(groups.unattributed, tiles);
    assert.deepEqual(groups.clusters, []);
    const empty = groupTilesByLibrary(tiles, identity, []);
    assert.deepEqual(empty.unattributed, tiles);
    assert.deepEqual(empty.clusters, []);
  });

  test("unattributed tiles keep input order and clusters sort alphabetically by library name", () => {
    const hostTile = actuator("host");
    const projectTile = actuator("mine", "project-store-id");
    const gammaTile = actuator("g1", LIB_C.coordinate);
    const alphaTile = sensor("a1", LIB_A.coordinate);
    const betaTile = sensor("b1", LIB_B.coordinate);
    const alphaTile2 = actuator("a2", LIB_A.coordinate);

    const groups = groupTilesByLibrary([gammaTile, hostTile, alphaTile, projectTile, betaTile, alphaTile2], identity, [
      LIB_C,
      LIB_A,
      LIB_B,
    ]);

    // A namespace outside the installed-libraries set (the project's own store id) stays unattributed.
    assert.deepEqual(groups.unattributed, [hostTile, projectTile]);
    assert.deepEqual(
      groups.clusters.map((cluster) => cluster.library.coordinate),
      [LIB_A.coordinate, LIB_B.coordinate, LIB_C.coordinate]
    );
    assert.deepEqual(groups.clusters[0].items, [alphaTile, alphaTile2]);
    assert.deepEqual(groups.clusters[1].items, [betaTile]);
    assert.deepEqual(groups.clusters[2].items, [gammaTile]);
  });

  test("libraries without tiles produce no cluster", () => {
    const groups = groupTilesByLibrary([actuator("a1", LIB_A.coordinate)], identity, [LIB_A, LIB_B]);
    assert.deepEqual(
      groups.clusters.map((cluster) => cluster.library.coordinate),
      [LIB_A.coordinate]
    );
  });

  test("two libraries sharing a display name both cluster, keyed by coordinate", () => {
    const first: TileSourceLibrary = { coordinate: "owner/one", name: "Same Name" };
    const second: TileSourceLibrary = { coordinate: "owner/two", name: "Same Name" };
    const groups = groupTilesByLibrary(
      [actuator("t1", first.coordinate), actuator("t2", second.coordinate)],
      identity,
      [first, second]
    );
    assert.deepEqual(groups.clusters.map((cluster) => cluster.library.coordinate).sort(), ["owner/one", "owner/two"]);
  });

  test("an item resolving no tile def is unattributed", () => {
    const items = ["known", "unknown"];
    const defs = new Map<string, IBrainTileDef>([["known", actuator("k", LIB_A.coordinate)]]);
    const groups = groupTilesByLibrary(items, (id) => defs.get(id), [LIB_A]);
    assert.deepEqual(groups.unattributed, ["unknown"]);
    assert.deepEqual(groups.clusters[0].items, ["known"]);
  });
});
