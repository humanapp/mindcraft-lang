const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const { after, describe, test } = require("node:test");

const { PartitionViolationCode, partitionViolations } = require("./tsconfig-partition.js");

/** Temporary packages this file created, removed once it finishes. */
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** TypeScript installation the fixture packages resolve their compiler from. */
const typescriptDir = dirname(
  require.resolve("typescript/package.json", { paths: [join(__dirname, "..", "packages", "ts-compiler")] })
);

/** Write `content` at `path`, creating its directory. */
function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

/** Write `value` as JSON at `path`. */
function writeJson(path, value) {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Compiler options every fixture project compiles with. */
const compilerOptions = { module: "ESNext", moduleResolution: "bundler", noEmit: true, strict: true };

/** What one fixture package holds. */
const defaults = {
  sources: { "src/main.ts": "export const value = 1;\n", "src/main.spec.ts": "export const check = 1;\n" },
  convention: {
    solution: "tsconfig.json",
    projects: [
      { project: "tsconfig.app.json", include: ["src/**/*.ts"], exclude: ["src/**/*.spec.ts"] },
      { project: "tsconfig.spec.json", include: ["src/**/*.spec.ts"] },
    ],
  },
  configs: {
    "tsconfig.json": { files: [], references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.spec.json" }] },
    "tsconfig.app.json": { compilerOptions, include: ["src/**/*.ts"], exclude: ["src/**/*.spec.ts"] },
    "tsconfig.spec.json": { compilerOptions, include: ["src/**/*.spec.ts"] },
  },
};

/**
 * A fresh package whose sources, convention, and compiler configurations are
 * the defaults with `shape` merged over them, returning its directory.
 */
function fixture(shape = {}) {
  const root = mkdtempSync(join(tmpdir(), "tsconfig-partition-"));
  roots.push(root);
  writeJson(join(root, "package.json"), { name: "fixture", private: true });
  mkdirSync(join(root, "node_modules"), { recursive: true });
  symlinkSync(typescriptDir, join(root, "node_modules", "typescript"), "dir");
  execFileSync("git", ["init", "--quiet"], { cwd: root });

  for (const [path, body] of Object.entries({ ...defaults.sources, ...shape.sources })) write(join(root, path), body);
  writeJson(join(root, "tsconfig.projects.json"), shape.convention ?? defaults.convention);
  for (const [path, value] of Object.entries({ ...defaults.configs, ...shape.configs })) {
    writeJson(join(root, path), value);
  }
  return root;
}

describe("judging a package's compiler project partition", () => {
  test("accepts a package whose configurations and editor routing match its convention", () => {
    assert.deepEqual(partitionViolations(fixture()), []);
  });

  test("reports a source file the convention gives to no project", () => {
    const root = fixture({ sources: { "tools/helper.ts": "export const helper = 1;\n" } });

    const violations = partitionViolations(root).filter(
      (violation) => violation.code === PartitionViolationCode.Orphaned
    );

    assert.equal(violations.length, 1);
    assert.equal(violations[0].file, "tools/helper.ts");
  });

  test("reports a file a second project roots without the convention giving it", () => {
    const root = fixture({
      configs: { "tsconfig.spec.json": { compilerOptions, include: ["src/**/*.ts"] } },
    });

    const violations = partitionViolations(root).filter(
      (violation) => violation.code === PartitionViolationCode.DoubleClaim
    );

    assert.deepEqual(
      violations.map((violation) => violation.file),
      ["src/main.ts"]
    );
    assert.equal(violations[0].config, "tsconfig.spec.json");
  });

  test("reports a project whose include leaves out a file the convention gives it", () => {
    const root = fixture({
      configs: { "tsconfig.spec.json": { compilerOptions, include: ["src/nothing/**/*.spec.ts"] } },
    });

    const violations = partitionViolations(root).filter(
      (violation) => violation.code === PartitionViolationCode.ConfigDrift
    );

    assert.deepEqual(
      violations.map((violation) => violation.file),
      ["src/main.spec.ts"]
    );
    assert.equal(violations[0].config, "tsconfig.spec.json");
  });

  test("reports a file the language service resolves to a project other than its owner", () => {
    const root = fixture({
      configs: { "tsconfig.json": { files: [], references: [{ path: "./tsconfig.app.json" }] } },
    });

    const violations = partitionViolations(root).filter(
      (violation) => violation.code === PartitionViolationCode.EditorDisagreement
    );

    assert.deepEqual(
      violations.map((violation) => violation.file),
      ["src/main.spec.ts"]
    );
    assert.match(violations[0].message, /\(inferred\)/);
  });

  test("reports a compiler configuration the convention does not name", () => {
    const root = fixture({ configs: { "tsconfig.extra.json": { compilerOptions, include: ["src/**/*.ts"] } } });

    const violations = partitionViolations(root).filter(
      (violation) => violation.code === PartitionViolationCode.UnlistedConfig
    );

    assert.deepEqual(
      violations.map((violation) => violation.config),
      ["tsconfig.extra.json"]
    );
  });
});
