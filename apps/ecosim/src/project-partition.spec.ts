import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

/** Directory of this app's package.json. */
const packageDir = fileURLToPath(new URL("..", import.meta.url));

/** Path to the platform's compiler-project partition guard. */
const guard = fileURLToPath(new URL("../../../scripts/tsconfig-partition.js", import.meta.url));

describe("this app's compiler projects", () => {
  test("claim every source file exactly as tsconfig.projects.json declares", () => {
    const run = spawnSync(process.execPath, [guard, packageDir], { encoding: "utf8" });

    assert.equal(run.status, 0, run.stderr);
  });
});
