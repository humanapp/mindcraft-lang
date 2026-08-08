/**
 * Platform substitution guard.
 *
 * Mechanizes the invariant that every module with a platform-specific
 * implementation ships that implementation in every build: for each name in
 * `PLATFORM_MODULES` and `PRIMITIVES_MODULES`, the shared outputs
 * `dist/<target>/**\/<module>.<ext>` must carry runtime code, not the empty
 * module the compiler emits for the declaration-only `<module>.ts`. Requires
 * all three builds, which the suite's `pretest` produces.
 *
 * Self-tests assert each detector reports the empty module its build's compiler
 * emits for a declaration-only source.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, test } from "node:test";

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");

const { PLATFORM_MODULES, PRIMITIVES_MODULES } = require(path.join(PACKAGE_ROOT, "scripts", "build-utils.js")) as {
  PLATFORM_MODULES: string[];
  PRIMITIVES_MODULES: string[];
};

/** Statements a compiler emits to mark a module whose source defines nothing. */
const EMPTY_MODULE_MARKERS = [
  '"use strict";',
  'Object.defineProperty(exports, "__esModule", { value: true });',
  "export {};",
];

/** `text` with every whitespace run removed. */
function withoutWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

/**
 * Whether `source` defines nothing once comments, whitespace, and module
 * markers are removed.
 *
 * @param source Contents of an emitted JavaScript module.
 */
function definesNothing(source: string): boolean {
  let rest = withoutWhitespace(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""));
  for (const marker of EMPTY_MODULE_MARKERS) rest = rest.split(withoutWhitespace(marker)).join("");
  return rest.length === 0;
}

/** A Luau module that returns no value, once comments and whitespace are removed. */
const EMPTY_LUAU_MODULE = "returnnil";

/**
 * A Luau module holding one empty container table, once comments and whitespace
 * are removed. A namespace whose every member is declared elsewhere compiles to
 * this.
 */
const EMPTY_LUAU_CONTAINER = /^local(\w+)={}dolocal_container=\1endreturn{\1=\1,?}$/;

/**
 * Whether `source` defines nothing once comments and whitespace are removed.
 *
 * @param source Contents of an emitted Luau module.
 */
function definesNothingLuau(source: string): boolean {
  const rest = withoutWhitespace(source.replace(/--\[\[[\s\S]*?\]\]/g, "").replace(/--[^\n]*/g, ""));
  return rest === EMPTY_LUAU_MODULE || EMPTY_LUAU_CONTAINER.test(rest);
}

/** One build target, named for its `dist` subdirectory, and how its output is judged. */
interface Target {
  /** `dist` subdirectory and the suffix of the `build:` script that fills it. */
  readonly name: string;
  /** Extension of the emitted module a platform implementation is written over. */
  readonly extension: string;
  /** Whether an emitted module of this target defines nothing. */
  readonly definesNothing: (source: string) => boolean;
}

const TARGETS: readonly Target[] = [
  { name: "esm", extension: ".js", definesNothing },
  { name: "node", extension: ".js", definesNothing },
  { name: "rbx", extension: ".luau", definesNothing: definesNothingLuau },
];

/** Emitted outputs named `<module><extension>` under `root`, as paths relative to the package root. */
function outputsFor(root: string, module: string, extension: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === `${module}${extension}`) {
        found.push(path.relative(PACKAGE_ROOT, full));
      }
    }
  };
  walk(root);
  return found;
}

describe("platform substitution", () => {
  for (const target of TARGETS) {
    test(`every platform module ships its implementation in the ${target.name} build`, () => {
      const dist = path.join(PACKAGE_ROOT, "dist", target.name);
      assert.ok(
        fs.existsSync(dist),
        `${path.relative(PACKAGE_ROOT, dist)} is absent; run npm run build:${target.name}`
      );

      const unsubstituted: string[] = [];
      for (const module of [...PLATFORM_MODULES, ...PRIMITIVES_MODULES]) {
        const outputs = outputsFor(dist, module, target.extension);
        assert.ok(outputs.length > 0, `no ${target.name} output named ${module}${target.extension}`);
        for (const output of outputs) {
          if (target.definesNothing(fs.readFileSync(path.join(PACKAGE_ROOT, output), "utf8")))
            unsubstituted.push(output);
        }
      }

      assert.deepEqual(unsubstituted, [], `outputs left as the empty module:\n${unsubstituted.join("\n")}`);
    });
  }

  test("self-test: the script detector reports an empty module", () => {
    assert.ok(definesNothing("export {};\n"));
    assert.ok(definesNothing('"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n'));
    assert.ok(definesNothing("/* leading */\nexport {};\n// trailing\n"));
    assert.ok(!definesNothing("export class Dict {\n}\n"));
    assert.ok(!definesNothing('"use strict";\nclass Dict {\n}\nexports.Dict = Dict;\n'));
  });

  test("self-test: the Luau detector reports an empty module", () => {
    assert.ok(definesNothingLuau("-- Compiled with roblox-ts\nreturn nil\n"));
    assert.ok(definesNothingLuau("--[[\n\t* a doc comment\n]]\nreturn nil\n"));
    assert.ok(
      definesNothingLuau(
        "-- Compiled with roblox-ts\nlocal StringUtils = {}\ndo\n\tlocal _container = StringUtils\n\t--[[ declared elsewhere ]]\nend\nreturn {\n\tStringUtils = StringUtils,\n}\n"
      )
    );
    assert.ok(!definesNothingLuau("-- Compiled with roblox-ts\nlocal Dict = {}\nreturn {\n\tDict = Dict,\n}\n"));
    assert.ok(
      !definesNothingLuau(
        "local StringUtils = {}\ndo\n\tlocal _container = StringUtils\n\tlocal function size(s)\n\t\treturn #s\n\tend\n\t_container.size = size\nend\nreturn {\n\tStringUtils = StringUtils,\n}\n"
      )
    );
  });
});
