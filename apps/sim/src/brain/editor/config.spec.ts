import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { IBrainActionTileDef } from "@mindcraft-lang/core/brain";
import { BrainTileActuatorDef } from "@mindcraft-lang/core/brain/tiles";
import { bag, mkCallDef } from "@mindcraft-lang/core/runtime";
import type { SimEnvironmentStore } from "../../services/sim-environment-store";
import { buildBrainEditorConfig } from "./config";

/** An action (actuator) tile keyed by `key`; carries an `action` descriptor. */
function actionTile(key: string): IBrainActionTileDef {
  return new BrainTileActuatorDef(key, { key, kind: "actuator", callDef: mkCallDef(bag()), isAsync: false });
}

/** A store stand-in exposing only what `buildBrainEditorConfig` reads. */
function fakeStore(getTileCompileDiagnostics: (key: string) => unknown | undefined): SimEnvironmentStore {
  return {
    env: { brainServices: {}, tileCatalogs: () => [] },
    resolveVfsAssetUrl: (url: string) => url,
    activeProjectManifest: undefined,
    host: { installedLibraries: [], getTileCompileDiagnostics },
  } as unknown as SimEnvironmentStore;
}

describe("buildBrainEditorConfig isBrokenTile", () => {
  test("delegates to the host's compile-diagnostics accessor for the tile's action key", () => {
    const store = fakeStore((key) => (key === "a.broken" ? { path: "a.ts", diagnostics: [{ code: 1 }] } : undefined));
    const isBrokenTile = (tile: IBrainActionTileDef) =>
      store.host.getTileCompileDiagnostics(tile.action.key) !== undefined;

    const config = buildBrainEditorConfig({ store, isBrokenTile });

    assert.equal(config.isBrokenTile?.(actionTile("a.broken")), true);
    assert.equal(config.isBrokenTile?.(actionTile("a.clean")), false);
  });

  test("is left undefined when no predicate is supplied", () => {
    const store = fakeStore(() => undefined);

    const config = buildBrainEditorConfig({ store });

    assert.equal(config.isBrokenTile, undefined);
  });
});
