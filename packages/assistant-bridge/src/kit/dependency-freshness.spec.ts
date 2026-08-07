import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import {
  assertDependencyDistsFresh,
  DistFreshnessCode,
  StaleDependencyError,
  staleDependencyDists,
} from "./dependency-freshness.js";

/** Temporary trees this file created, removed once it finishes. */
const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

/** Modification time, in seconds, of a file written before its package was built. */
const beforeBuild = 1_700_000_000;

/** Modification time, in seconds, of a file written after its package was built. */
const afterBuild = 1_700_000_600;

/** Modification time, in seconds, of a package's build output. */
const buildTime = 1_700_000_300;

/** Write `content` at `path`, creating its directory, and stamp it at `seconds`. */
async function writeAt(path: string, content: string, seconds: number): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
  await utimes(path, seconds, seconds);
}

/** Body every fixture source file and build output carries. */
const moduleBody = "export const value = 1;\n";

/** Write the manifest `manifest` as the package at `dir`, creating the directory. */
async function writePackage(dir: string, manifest: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify(manifest), "utf8");
}

/** What one dependency package of a fixture tree holds. */
interface DependencyShape {
  /** Scripts the package declares; a package with none is never checked. */
  readonly scripts?: Readonly<Record<string, string>>;
  /** Source files keyed by their path under `src`, each with the time it was last written. */
  readonly sources?: Readonly<Record<string, number>>;
  /** Whether the package holds build output, written at {@link buildTime}. */
  readonly built?: boolean;
  /** Time an incremental-build record beside the package manifest was last written. */
  readonly buildRecord?: number;
}

/**
 * A fresh tree holding a root package that depends on one local package,
 * returning the root directory.
 */
async function tree(shape: DependencyShape): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "freshness-"));
  roots.push(root);
  const app = join(root, "app");
  const dependency = join(root, "dependency");

  await writePackage(app, { name: "app", dependencies: { "example/dependency": "file:../dependency" } });
  await writePackage(dependency, { name: "example/dependency", scripts: shape.scripts ?? {} });
  for (const [path, seconds] of Object.entries(shape.sources ?? { "index.ts": beforeBuild })) {
    await writeAt(join(dependency, "src", path), moduleBody, seconds);
  }
  if (shape.built !== false) await writeAt(join(dependency, "dist", "index.js"), moduleBody, buildTime);
  if (shape.buildRecord !== undefined)
    await writeAt(join(dependency, "tsconfig.tsbuildinfo"), "{}\n", shape.buildRecord);
  return app;
}

/** Stamp the dependency's build output as freshly rebuilt. */
async function rebuild(app: string): Promise<void> {
  await writeAt(join(app, "..", "dependency", "dist", "index.js"), moduleBody, afterBuild);
}

/** Name of the package the root package of a chained fixture tree depends on directly. */
const directName = "example/direct";

/** Name of the package a chained fixture tree reaches only through {@link directName}. */
const indirectName = "example/indirect";

/**
 * A fresh tree holding a root package that depends on one local package, which
 * itself depends on a second one. Both declare a build; the direct dependency
 * is built after its sources and the indirect one is not. Returns the root
 * package directory.
 */
async function chainedTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "freshness-chain-"));
  roots.push(root);
  const app = join(root, "app");
  const direct = join(root, "direct");
  const indirect = join(root, "indirect");

  await writePackage(app, { name: "app", dependencies: { [directName]: "file:../direct" } });
  await writePackage(direct, {
    name: directName,
    scripts: { "build:prod": "tsc" },
    dependencies: { [indirectName]: "file:../indirect" },
  });
  await writePackage(indirect, { name: indirectName, scripts: { "build:prod": "tsc" } });

  await writeAt(join(direct, "src", "index.ts"), moduleBody, beforeBuild);
  await writeAt(join(direct, "dist", "index.js"), moduleBody, buildTime);
  await writeAt(join(indirect, "src", "index.ts"), moduleBody, afterBuild);
  await writeAt(join(indirect, "dist", "index.js"), moduleBody, buildTime);
  return app;
}

describe("checking the build output of a package's local dependencies", () => {
  test("passes a dependency whose build output is newer than its sources", async () => {
    const app = await tree({ scripts: { "build:prod": "tsc" } });

    assert.deepEqual(staleDependencyDists(app), []);
  });

  test("reports a dependency that declares a build and holds no build output", async () => {
    const app = await tree({ scripts: { build: "tsc" }, built: false });

    const [stale, ...rest] = staleDependencyDists(app);

    assert.deepEqual(rest, []);
    assert.equal(stale?.code, DistFreshnessCode.DistMissing);
    assert.equal(stale?.packageName, "example/dependency");
    assert.match(stale?.rebuild ?? "", /npm run build --prefix /);
  });

  test("reports a dependency whose source is newer than its build output", async () => {
    const app = await tree({ scripts: { "build:prod": "tsc" }, sources: { "index.ts": afterBuild } });

    const [stale] = staleDependencyDists(app);

    assert.equal(stale?.code, DistFreshnessCode.DistStale);
    assert.equal(stale?.packageName, "example/dependency");
    assert.match(stale?.rebuild ?? "", /npm run build:prod --prefix /);
    assert.match(stale?.detail ?? "", /index\.ts/);
  });

  test("reports a stale package reached only through another dependency", async () => {
    const app = await chainedTree();

    const [stale, ...rest] = staleDependencyDists(app);

    assert.deepEqual(rest, []);
    assert.equal(stale?.code, DistFreshnessCode.DistStale);
    assert.equal(stale?.packageName, indirectName);
    assert.match(stale?.rebuild ?? "", /--prefix \.\.[\\/]indirect$/);
  });

  test("passes once the reported dependency is rebuilt", async () => {
    const app = await tree({ scripts: { "build:prod": "tsc" }, sources: { "index.ts": afterBuild } });
    assert.equal(staleDependencyDists(app).length, 1);

    await rebuild(app);

    assert.deepEqual(staleDependencyDists(app), []);
  });

  test("passes a dependency whose rebuild re-emitted nothing and only refreshed its build record", async () => {
    const app = await tree({
      scripts: { "build:prod": "tsc" },
      sources: { "index.ts": afterBuild },
      buildRecord: afterBuild + 1,
    });

    assert.deepEqual(staleDependencyDists(app), []);
  });

  test("reports a dependency edited after its build record was last written", async () => {
    const app = await tree({
      scripts: { "build:prod": "tsc" },
      sources: { "index.ts": afterBuild },
      buildRecord: buildTime,
    });

    const [stale] = staleDependencyDists(app);

    assert.equal(stale?.code, DistFreshnessCode.DistStale);
  });

  test("passes a dependency whose only newer source is a spec, which nothing emits for", async () => {
    const app = await tree({
      scripts: { "build:prod": "tsc" },
      sources: { "index.ts": beforeBuild, "index.spec.ts": afterBuild },
    });

    assert.deepEqual(staleDependencyDists(app), []);
  });

  test("passes a dependency that declares no build script", async () => {
    const app = await tree({ sources: { "index.ts": afterBuild }, built: false });

    assert.deepEqual(staleDependencyDists(app), []);
  });

  test("refuses to build against a stale dependency, naming it and its rebuild command", async () => {
    const app = await tree({ scripts: { "build:prod": "tsc" }, sources: { "index.ts": afterBuild } });

    const error = await Promise.resolve()
      .then(() => {
        assertDependencyDistsFresh(app);
      })
      .then(
        () => undefined,
        (caught: unknown) => caught
      );

    assert.ok(error instanceof StaleDependencyError, `expected a StaleDependencyError, got ${String(error)}`);
    assert.equal(error.stale.length, 1);
    assert.equal(error.stale[0]?.code, DistFreshnessCode.DistStale);
  });

  test("accepts a tree whose dependencies are all built", async () => {
    const app = await tree({ scripts: { "build:prod": "tsc" } });

    assert.doesNotThrow(() => {
      assertDependencyDistsFresh(app);
    });
  });
});
