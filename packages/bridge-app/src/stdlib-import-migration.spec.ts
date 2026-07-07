import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StdlibImportRedirect } from "./stdlib-import-migration.js";
import { migrateStdlibBrainOrigins, migrateStdlibImports } from "./stdlib-import-migration.js";

const COORDINATE = "mindcraft-lang/wodal-lib";
const REFERENCE = "embedded:wodal-lib";
const INTERIM_ORIGIN = "embedded:wodal-stdlib";
/** A saved-brain state from the transport-prefixed naming that predates the bare coordinate. */
const PRIOR_GH_ORIGIN = "gh:mindcraft-lang/wodal-lib";
const FINAL_ORIGIN = "mindcraft-lang/wodal-lib";

const REDIRECTS: readonly StdlibImportRedirect[] = [
  {
    fromSpecifiers: ["stdlib", "@ext/wodal-stdlib"],
    toCoordinate: COORDINATE,
    toReference: REFERENCE,
    interimManifestKeys: ["wodal-stdlib"],
    interimOrigins: [INTERIM_ORIGIN, PRIOR_GH_ORIGIN],
    toOrigin: FINAL_ORIGIN,
  },
];

const BACKFILL = { [COORDINATE]: REFERENCE };
const FINAL_MANIFEST = { [COORDINATE]: REFERENCE };

describe("migrateStdlibImports -- user-code and manifest", () => {
  test("rewrites a legacy stdlib subpath import to the coordinate entry surface", () => {
    const files = new Map([["draw.ts", 'import { heart } from "stdlib/image";\n']]);
    const result = migrateStdlibImports(files, undefined, REDIRECTS);
    assert.equal(result.changedFiles.get("draw.ts"), `import { heart } from "@ext/${COORDINATE}";\n`);
    assert.deepEqual(result.manifestBackfill, BACKFILL);
    assert.deepEqual(result.manifestRemovals, []);
    assert.equal(result.changed, true);
  });

  test("rewrites the interim entry import to the coordinate entry surface", () => {
    const files = new Map([["draw.ts", 'import { heart } from "@ext/wodal-stdlib";\n']]);
    const result = migrateStdlibImports(files, { "wodal-stdlib": INTERIM_ORIGIN }, REDIRECTS);
    assert.equal(result.changedFiles.get("draw.ts"), `import { heart } from "@ext/${COORDINATE}";\n`);
    assert.deepEqual(result.manifestBackfill, BACKFILL);
    assert.deepEqual(result.manifestRemovals, ["wodal-stdlib"]);
    assert.equal(result.changed, true);
  });

  test("rewrites the bare legacy prefix to the coordinate entry", () => {
    const files = new Map([["draw.ts", "import x from 'stdlib';\n"]]);
    const result = migrateStdlibImports(files, undefined, REDIRECTS);
    assert.equal(result.changedFiles.get("draw.ts"), `import x from '@ext/${COORDINATE}';\n`);
  });

  test("leaves unrelated imports and non-ts files untouched", () => {
    const files = new Map([
      ["draw.ts", 'import { Actuator } from "mindcraft";\nimport { x } from "./local";\n'],
      ["notes.md", 'import { heart } from "stdlib/image";'],
    ]);
    const result = migrateStdlibImports(files, FINAL_MANIFEST, REDIRECTS);
    assert.equal(result.changedFiles.size, 0);
    assert.equal(result.changed, false);
  });

  test("is idempotent: a project already on the final coordinate produces no change", () => {
    const files = new Map([["draw.ts", `import { heart } from "@ext/${COORDINATE}";\n`]]);
    const result = migrateStdlibImports(files, FINAL_MANIFEST, REDIRECTS);
    assert.equal(result.changedFiles.size, 0);
    assert.deepEqual(result.manifestBackfill, {});
    assert.deepEqual(result.manifestRemovals, []);
    assert.equal(result.changed, false);
  });

  test("backfills the manifest for a project that never imported the stdlib", () => {
    const files = new Map([["draw.ts", 'import { Actuator } from "mindcraft";\n']]);
    const result = migrateStdlibImports(files, undefined, REDIRECTS);
    assert.equal(result.changedFiles.size, 0);
    assert.deepEqual(result.manifestBackfill, BACKFILL);
    assert.deepEqual(result.manifestRemovals, []);
    assert.equal(result.changed, true);
  });

  test("does not re-add the coordinate the manifest already carries", () => {
    const files = new Map([["draw.ts", 'import { heart } from "stdlib/image";\n']]);
    const result = migrateStdlibImports(files, FINAL_MANIFEST, REDIRECTS);
    assert.equal(result.changedFiles.size, 1);
    assert.deepEqual(result.manifestBackfill, {});
  });

  test("no redirects means no changes", () => {
    const files = new Map([["draw.ts", 'import { heart } from "stdlib/image";\n']]);
    const result = migrateStdlibImports(files, undefined, []);
    assert.equal(result.changed, false);
    assert.deepEqual(result.manifestBackfill, {});
    assert.deepEqual(result.manifestRemovals, []);
  });
});

describe("migrateStdlibBrainOrigins -- saved-brain symbol references", () => {
  test("rewrites interim origins in binding, public, and id-keyed references", () => {
    const brain = {
      catalog: [
        { kind: "literal", valueType: `struct:<${INTERIM_ORIGIN}:/image.ts::Image>` },
        { kind: "variable", tileId: `tile.var.factory->struct:<${INTERIM_ORIGIN}:/image.ts::Image>` },
      ],
      pages: [
        {
          rules: [
            { do: [`tile.actuator->${INTERIM_ORIGIN}:user.actuator.draw000000001`] },
            { do: [`${INTERIM_ORIGIN}::heart`] },
          ],
        },
      ],
    };
    const report = migrateStdlibBrainOrigins(brain, REDIRECTS);
    assert.equal(report.changed, true);
    assert.equal(brain.catalog[0].valueType, `struct:<${FINAL_ORIGIN}:/image.ts::Image>`);
    assert.equal(brain.catalog[1].tileId, `tile.var.factory->struct:<${FINAL_ORIGIN}:/image.ts::Image>`);
    assert.deepEqual(brain.pages[0].rules[0].do, [`tile.actuator->${FINAL_ORIGIN}:user.actuator.draw000000001`]);
    assert.deepEqual(brain.pages[0].rules[1].do, [`${FINAL_ORIGIN}::heart`]);
  });

  test("rewrites a prior transport-prefixed origin to the bare coordinate origin", () => {
    const brain = {
      catalog: [{ kind: "literal", valueType: `struct:<${PRIOR_GH_ORIGIN}:/image.ts::Image>` }],
      pages: [
        {
          rules: [
            { do: [`tile.actuator->${PRIOR_GH_ORIGIN}:user.actuator.draw000000001`, `${PRIOR_GH_ORIGIN}::heart`] },
          ],
        },
      ],
    };
    const report = migrateStdlibBrainOrigins(brain, REDIRECTS);
    assert.equal(report.changed, true);
    assert.equal(brain.catalog[0].valueType, `struct:<${FINAL_ORIGIN}:/image.ts::Image>`);
    assert.deepEqual(brain.pages[0].rules[0].do, [
      `tile.actuator->${FINAL_ORIGIN}:user.actuator.draw000000001`,
      `${FINAL_ORIGIN}::heart`,
    ]);
  });

  test("is idempotent: a brain already on the final origin is a no-op", () => {
    const brain = { pages: [{ rules: [{ do: [`${FINAL_ORIGIN}::heart`] }] }] };
    const report = migrateStdlibBrainOrigins(brain, REDIRECTS);
    assert.equal(report.changed, false);
    assert.deepEqual(brain.pages[0].rules[0].do, [`${FINAL_ORIGIN}::heart`]);
  });

  test("leaves a brain that never referenced the interim origin untouched", () => {
    const brain = { pages: [{ rules: [{ do: ["tile.op->host.someTile"] }] }] };
    const report = migrateStdlibBrainOrigins(brain, REDIRECTS);
    assert.equal(report.changed, false);
  });

  test("does not touch a coincidental substring that is not a namespace boundary", () => {
    const brain = { pages: [{ rules: [{ do: [`mentions ${INTERIM_ORIGIN} in prose`] }] }] };
    const report = migrateStdlibBrainOrigins(brain, REDIRECTS);
    assert.equal(report.changed, false);
    assert.deepEqual(brain.pages[0].rules[0].do, [`mentions ${INTERIM_ORIGIN} in prose`]);
  });
});
