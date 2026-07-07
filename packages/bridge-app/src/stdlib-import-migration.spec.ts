import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StdlibImportRedirect } from "./stdlib-import-migration.js";
import { migrateStdlibImports } from "./stdlib-import-migration.js";

const REDIRECTS: readonly StdlibImportRedirect[] = [
  {
    fromPrefix: "stdlib",
    toSlug: "wodal-stdlib",
    backfillSlug: "wodal-stdlib",
    backfillReference: "embedded:wodal-stdlib",
  },
];

const BACKFILL = { "wodal-stdlib": "embedded:wodal-stdlib" };

describe("migrateStdlibImports", () => {
  test("rewrites a legacy stdlib subpath import to the extension entry surface", () => {
    const files = new Map([["draw.ts", 'import { heart } from "stdlib/image";\n']]);
    const result = migrateStdlibImports(files, undefined, REDIRECTS);
    assert.equal(result.changedFiles.get("draw.ts"), 'import { heart } from "@ext/wodal-stdlib";\n');
    assert.deepEqual(result.manifestBackfill, BACKFILL);
    assert.equal(result.changed, true);
  });

  test("rewrites the bare legacy prefix to the extension entry", () => {
    const files = new Map([["draw.ts", "import x from 'stdlib';\n"]]);
    const result = migrateStdlibImports(files, undefined, REDIRECTS);
    assert.equal(result.changedFiles.get("draw.ts"), "import x from '@ext/wodal-stdlib';\n");
  });

  test("leaves unrelated imports and non-ts files untouched", () => {
    const files = new Map([
      ["draw.ts", 'import { Actuator } from "mindcraft";\nimport { x } from "./local";\n'],
      ["notes.md", 'import { heart } from "stdlib/image";'],
    ]);
    const result = migrateStdlibImports(files, BACKFILL, REDIRECTS);
    assert.equal(result.changedFiles.size, 0);
    assert.equal(result.changed, false);
  });

  test("is idempotent: a project already on @ext produces no file change", () => {
    const files = new Map([["draw.ts", 'import { heart } from "@ext/wodal-stdlib";\n']]);
    const result = migrateStdlibImports(files, BACKFILL, REDIRECTS);
    assert.equal(result.changedFiles.size, 0);
    assert.deepEqual(result.manifestBackfill, {});
    assert.equal(result.changed, false);
  });

  test("backfills the manifest for a project that never imported the stdlib", () => {
    const files = new Map([["draw.ts", 'import { Actuator } from "mindcraft";\n']]);
    const result = migrateStdlibImports(files, undefined, REDIRECTS);
    assert.equal(result.changedFiles.size, 0);
    assert.deepEqual(result.manifestBackfill, BACKFILL);
    assert.equal(result.changed, true);
  });

  test("does not re-add a backfill slug the manifest already carries", () => {
    const files = new Map([["draw.ts", 'import { heart } from "stdlib/image";\n']]);
    const result = migrateStdlibImports(files, BACKFILL, REDIRECTS);
    assert.equal(result.changedFiles.size, 1);
    assert.deepEqual(result.manifestBackfill, {});
  });

  test("no redirects means no changes", () => {
    const files = new Map([["draw.ts", 'import { heart } from "stdlib/image";\n']]);
    const result = migrateStdlibImports(files, undefined, []);
    assert.equal(result.changed, false);
    assert.deepEqual(result.manifestBackfill, {});
  });
});
