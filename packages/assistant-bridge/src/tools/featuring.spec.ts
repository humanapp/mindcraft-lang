import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CompiledRoot } from "@wendoo/core";
import type { TileProvenance } from "@wendoo/core/brain";
import type { CatalogFeaturing } from "./featuring.js";
import { admitsLongFormDocs } from "./featuring.js";

const host = "acme/robot-project";
const chassis = "acme/lib-chassis";
const gamepad = "acme/lib-gamepad";
const position = "acme/lib-position";

/** A root over `namespace`, depending on `closure`. */
function root(namespace: string, closure: readonly string[] = []): CompiledRoot {
  return { namespace, closure: [...closure].sort() };
}

/** The bundle both chassis and gamepad libraries build into, each depending on the position library. */
const roots: readonly CompiledRoot[] = [
  root(host, [chassis, gamepad, position]),
  root(chassis, [position]),
  root(gamepad, [position]),
  root(position),
];

/** Tiles owned by `owners`, as a compiled bundle records provenance. */
function owned(...owners: readonly string[]): TileProvenance {
  return { owners: [...owners].sort() };
}

/** A session over `featured` with `host` as its own project. */
function featuring(...featured: readonly string[]): CatalogFeaturing {
  return { featured: new Set(featured), hostNamespace: host };
}

describe("which tiles may show the model their long-form documentation", () => {
  test("admits a tile the environment's modules registered, which carries no provenance", () => {
    assert.equal(admitsLongFormDocs(undefined, roots, featuring()), true);
  });

  test("admits the host project's own tiles", () => {
    assert.equal(admitsLongFormDocs(owned(host), roots, featuring()), true);
  });

  test("admits a featured library's tiles", () => {
    assert.equal(admitsLongFormDocs(owned(chassis), roots, featuring(chassis)), true);
  });

  test("admits a dependency of a featured library, which the catalog does not list", () => {
    assert.equal(admitsLongFormDocs(owned(position), roots, featuring(chassis)), true);
  });

  test("admits a dependency two featured libraries share", () => {
    const both = featuring(chassis, gamepad);

    assert.equal(admitsLongFormDocs(owned(position), roots, both), true);
    assert.equal(admitsLongFormDocs(owned(chassis), roots, both), true);
    assert.equal(admitsLongFormDocs(owned(gamepad), roots, both), true);
  });

  test("withholds a shared-id tile when one of its owners is not admitted", () => {
    assert.equal(admitsLongFormDocs(owned(chassis, gamepad), roots, featuring(chassis)), false);
    assert.equal(admitsLongFormDocs(owned(chassis, gamepad), roots, featuring(chassis, gamepad)), true);
  });

  test("withholds an unfeatured library's tiles, and the tiles of one that only depends on a featured library", () => {
    assert.equal(admitsLongFormDocs(owned(gamepad), roots, featuring(chassis)), false);
    assert.equal(admitsLongFormDocs(owned(chassis), roots, featuring(position)), false);
  });

  test("featuring nothing leaves the host's own tiles admitted and every library's withheld", () => {
    const none = featuring();

    assert.equal(admitsLongFormDocs(owned(host), roots, none), true);
    assert.equal(admitsLongFormDocs(owned(chassis), roots, none), false);
    assert.equal(admitsLongFormDocs(owned(position), roots, none), false);
  });

  test("withholds every bundle tile for a session holding no host project and featuring nothing", () => {
    const bare: CatalogFeaturing = { featured: new Set<string>() };

    assert.equal(admitsLongFormDocs(undefined, roots, bare), true);
    assert.equal(admitsLongFormDocs(owned(host), roots, bare), false);
  });

  test("reads the closure from the roots, so a featured namespace the bundle does not carry admits only itself", () => {
    assert.equal(admitsLongFormDocs(owned(position), [], featuring(chassis)), false);
    assert.equal(admitsLongFormDocs(owned(chassis), [], featuring(chassis)), true);
  });

  test("withholds every bundle tile for a workspace carrying no featuring at all", () => {
    assert.equal(admitsLongFormDocs(undefined, roots, undefined), true);
    assert.equal(admitsLongFormDocs(owned(host), roots, undefined), false);
    assert.equal(admitsLongFormDocs(owned(chassis), roots, undefined), false);
  });

  test("answers each session from its own featuring, however the calls interleave", () => {
    const featuresChassis = featuring(chassis);
    const featuresNone = featuring();

    assert.equal(admitsLongFormDocs(owned(chassis), roots, featuresChassis), true);
    assert.equal(admitsLongFormDocs(owned(chassis), roots, featuresNone), false);
    assert.equal(admitsLongFormDocs(owned(position), roots, featuresChassis), true);
    assert.equal(admitsLongFormDocs(owned(position), roots, featuresNone), false);
    assert.equal(admitsLongFormDocs(owned(chassis), roots, featuresChassis), true);
  });

  test("leaves the featuring it is given untouched", () => {
    const shared = featuring(chassis);

    admitsLongFormDocs(owned(position), roots, shared);
    admitsLongFormDocs(owned(gamepad), roots, shared);

    assert.deepEqual([...shared.featured], [chassis]);
  });
});
