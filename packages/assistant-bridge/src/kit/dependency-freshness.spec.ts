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
  /** Extra build output paths under `dist`, each written at {@link buildTime}. */
  readonly outputs?: readonly string[];
  /**
   * Build output paths under `dist` holding a script that defines nothing,
   * keyed to the body to write, each written at {@link buildTime}.
   */
  readonly emptyOutputs?: Readonly<Record<string, string>>;
  /** Time an incremental-build record beside the package manifest was last written. */
  readonly buildRecord?: number;
  /** Whether the root package declares the dependency as a dev dependency. */
  readonly dev?: boolean;
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

  const link = { "example/dependency": "file:../dependency" };
  await writePackage(app, { name: "app", ...(shape.dev ? { devDependencies: link } : { dependencies: link }) });
  await writePackage(dependency, { name: "example/dependency", scripts: shape.scripts ?? {} });
  for (const [path, seconds] of Object.entries(shape.sources ?? { "index.ts": beforeBuild })) {
    await writeAt(join(dependency, "src", path), moduleBody, seconds);
  }
  if (shape.built !== false) await writeAt(join(dependency, "dist", "index.js"), moduleBody, buildTime);
  for (const path of shape.outputs ?? []) await writeAt(join(dependency, "dist", path), moduleBody, buildTime);
  for (const [path, body] of Object.entries(shape.emptyOutputs ?? {}))
    await writeAt(join(dependency, "dist", path), body, buildTime);
  if (shape.buildRecord !== undefined)
    await writeAt(join(dependency, "tsconfig.tsbuildinfo"), "{}\n", shape.buildRecord);
  return app;
}

/** Stamp the dependency's build output as freshly rebuilt. */
async function rebuild(app: string): Promise<void> {
  await writeAt(join(app, "..", "dependency", "dist", "index.js"), moduleBody, afterBuild);
}

/** Name of the variant a grouped fixture's dependency builds beside its default group. */
const variantName = "extra";

/** Output directory of a grouped fixture dependency's default group. */
const baseOutput = "dist/base";

/** Output directory of a grouped fixture dependency's variant. */
const variantOutput = "dist/variant";

/** Body of a Luau module that carries an implementation. */
const luauBody = "-- Compiled\nlocal value = 1\nreturn { value = value }\n";

/** The build declaration of a grouped fixture's dependency. */
const groupedDeclaration = {
  script: "build:base",
  outputs: [baseOutput],
  postProcessed: true,
  variants: { [variantName]: { script: "build:variant", outputs: [variantOutput] } },
};

/** What one dependency of a grouped fixture tree holds. */
interface GroupedShape {
  /** Variant names the root package declares it consumes. */
  readonly needs?: readonly string[];
  /** Source files keyed by their path under `src`, each with the time it was last written. */
  readonly sources?: Readonly<Record<string, number>>;
  /** Time the default group's output was written. */
  readonly base?: number;
  /** Time the variant's output was written; `false` leaves the variant unbuilt. */
  readonly variant?: number | false;
  /** Files under the variant's output directory, keyed by path, valued by body. */
  readonly variantFiles?: Readonly<Record<string, string>>;
  /** Time an incremental-build record beside the package manifest was last written. */
  readonly buildRecord?: number;
}

/**
 * A fresh tree holding a root package that depends on one local package
 * building two output groups, returning the root directory.
 */
async function groupedTree(shape: GroupedShape): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "freshness-grouped-"));
  roots.push(root);
  const app = join(root, "app");
  const dependency = join(root, "dependency");

  await writePackage(app, {
    name: "app",
    dependencies: { "example/dependency": "file:../dependency" },
    ...(shape.needs ? { mindcraftBuild: { needs: shape.needs } } : {}),
  });
  await writePackage(dependency, {
    name: "example/dependency",
    scripts: { "build:base": "tsc", "build:variant": "tsc" },
    mindcraftBuild: groupedDeclaration,
  });

  for (const [path, seconds] of Object.entries(shape.sources ?? { "index.ts": beforeBuild })) {
    await writeAt(join(dependency, "src", path), moduleBody, seconds);
  }
  await writeAt(join(dependency, baseOutput, "index.js"), moduleBody, shape.base ?? buildTime);
  if (shape.variant !== false)
    await writeAt(join(dependency, variantOutput, "init.luau"), luauBody, shape.variant ?? buildTime);
  for (const [path, body] of Object.entries(shape.variantFiles ?? {}))
    await writeAt(join(dependency, variantOutput, path), body, buildTime);
  if (shape.buildRecord !== undefined)
    await writeAt(join(dependency, "tsconfig.tsbuildinfo"), "{}\n", shape.buildRecord);
  return app;
}

/**
 * A fresh tree holding a root package that names no variant, a middle package
 * that names one, and a grouped dependency whose variant is older than its
 * sources. Returns the root package directory.
 */
async function groupedNeedThroughMiddleTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "freshness-through-"));
  roots.push(root);
  const app = join(root, "app");
  const middle = join(root, "middle");
  const dependency = join(root, "dependency");

  await writePackage(app, { name: "app", dependencies: { "example/middle": "file:../middle" } });
  await writePackage(middle, {
    name: "example/middle",
    dependencies: { "example/dependency": "file:../dependency" },
    mindcraftBuild: { needs: [variantName] },
  });
  await writePackage(dependency, {
    name: "example/dependency",
    scripts: { "build:base": "tsc", "build:variant": "tsc" },
    mindcraftBuild: groupedDeclaration,
  });

  await writeAt(join(dependency, "src", "index.ts"), moduleBody, afterBuild);
  await writeAt(join(dependency, baseOutput, "index.js"), moduleBody, afterBuild + 1);
  await writeAt(join(dependency, variantOutput, "init.luau"), luauBody, buildTime);
  return app;
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

  test("reports a stale dev dependency, whose build output is an input to this package's build", async () => {
    const app = await tree({ scripts: { "build:prod": "tsc" }, sources: { "index.ts": afterBuild }, dev: true });

    const [stale, ...rest] = staleDependencyDists(app);

    assert.deepEqual(rest, []);
    assert.equal(stale?.code, DistFreshnessCode.DistStale);
    assert.equal(stale?.packageName, "example/dependency");
  });

  test("passes a built dev dependency", async () => {
    const app = await tree({ scripts: { "build:prod": "tsc" }, dev: true });

    assert.deepEqual(staleDependencyDists(app), []);
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

  test("reports a dependency whose build output is still named for a platform-specific source", async () => {
    const app = await tree({
      scripts: { "build:prod": "tsc" },
      sources: { "platform/dict.ts": beforeBuild, "platform/dict.node.ts": beforeBuild },
      outputs: ["platform/dict.js", "platform/dict.node.js", "platform/dict.node.d.ts"],
    });

    const [stale, ...rest] = staleDependencyDists(app);

    assert.deepEqual(rest, []);
    assert.equal(stale?.code, DistFreshnessCode.DistHalfBuilt);
    assert.equal(stale?.packageName, "example/dependency");
    assert.match(stale?.rebuild ?? "", /npm run build:prod --prefix /);
    assert.match(stale?.detail ?? "", /dict\.node/);
  });

  test("passes a dependency whose platform-specific output was renamed over the module it implements", async () => {
    const app = await tree({
      scripts: { "build:prod": "tsc" },
      sources: { "platform/dict.ts": beforeBuild, "platform/dict.node.ts": beforeBuild },
      outputs: ["platform/dict.js", "platform/dict.d.ts"],
    });

    assert.deepEqual(staleDependencyDists(app), []);
  });

  test("reports a dependency whose shared platform module was emitted as an ES module defining nothing", async () => {
    const app = await tree({
      scripts: { "build:prod": "tsc" },
      sources: { "platform/dict.ts": beforeBuild, "platform/dict.node.ts": beforeBuild },
      outputs: ["platform/dict.d.ts"],
      emptyOutputs: { "platform/dict.js": "export {};\n" },
    });

    const [stale, ...rest] = staleDependencyDists(app);

    assert.deepEqual(rest, []);
    assert.equal(stale?.code, DistFreshnessCode.DistHalfBuilt);
    assert.equal(stale?.packageName, "example/dependency");
    assert.match(stale?.rebuild ?? "", /npm run build:prod --prefix /);
    assert.match(stale?.detail ?? "", /platform[\\/]dict\.js/);
  });

  test("reports a shared platform module emitted as a CommonJS module defining nothing", async () => {
    const app = await tree({
      scripts: { "build:prod": "tsc" },
      sources: { "platform/dict.ts": beforeBuild, "platform/dict.node.ts": beforeBuild },
      emptyOutputs: {
        "platform/dict.js": '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n',
      },
    });

    const [stale, ...rest] = staleDependencyDists(app);

    assert.deepEqual(rest, []);
    assert.equal(stale?.code, DistFreshnessCode.DistHalfBuilt);
    assert.match(stale?.detail ?? "", /platform[\\/]dict\.js/);
  });

  test("passes a shared platform module carrying an implementation and a source-map comment", async () => {
    const app = await tree({
      scripts: { "build:prod": "tsc" },
      sources: { "platform/dict.ts": beforeBuild, "platform/dict.node.ts": beforeBuild },
      emptyOutputs: { "platform/dict.js": "export const value = 1;\n//# sourceMappingURL=dict.node.js.map\n" },
    });

    assert.deepEqual(staleDependencyDists(app), []);
  });

  test("passes an output defining nothing whose module has no platform-specific implementation", async () => {
    const app = await tree({
      scripts: { "build:prod": "tsc" },
      sources: { "platform/dict.ts": beforeBuild, "platform/dict.node.ts": beforeBuild, "other.ts": beforeBuild },
      outputs: ["platform/dict.js"],
      emptyOutputs: { "other.js": "export {};\n" },
    });

    assert.deepEqual(staleDependencyDists(app), []);
  });

  test("passes a dependency whose declaration file sits beside the module it declares", async () => {
    const app = await tree({
      scripts: { "build:prod": "tsc" },
      sources: { "globals.ts": beforeBuild, "globals.d.ts": beforeBuild },
      outputs: ["globals.js", "globals.d.ts"],
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

describe("checking a dependency that builds more than one output group", () => {
  test("reports a needed variant left behind by a build of the default group", async () => {
    const app = await groupedTree({
      needs: [variantName],
      sources: { "index.ts": afterBuild },
      base: afterBuild + 1,
      variant: buildTime,
    });

    const [stale, ...rest] = staleDependencyDists(app);

    assert.deepEqual(rest, []);
    assert.equal(stale?.code, DistFreshnessCode.DistStale);
    assert.match(stale?.rebuild ?? "", /npm run build:variant --prefix /);
  });

  test("passes the same tree for a package that does not name the variant", async () => {
    const app = await groupedTree({
      sources: { "index.ts": afterBuild },
      base: afterBuild + 1,
      variant: buildTime,
    });

    assert.deepEqual(staleDependencyDists(app), []);
  });

  test("reports a needed variant that was never built", async () => {
    const app = await groupedTree({ needs: [variantName], variant: false });

    const [stale, ...rest] = staleDependencyDists(app);

    assert.deepEqual(rest, []);
    assert.equal(stale?.code, DistFreshnessCode.DistMissing);
    assert.match(stale?.rebuild ?? "", /npm run build:variant --prefix /);
    assert.match(stale?.detail ?? "", /variant/);
  });

  test("does not excuse a stale variant with a build record it cannot attribute", async () => {
    const app = await groupedTree({
      needs: [variantName],
      sources: { "index.ts": afterBuild },
      base: afterBuild + 1,
      variant: buildTime,
      buildRecord: afterBuild + 2,
    });

    const [stale] = staleDependencyDists(app);

    assert.equal(stale?.code, DistFreshnessCode.DistStale);
  });

  test("reports a variant whose shared platform module was emitted as a Luau module returning nothing", async () => {
    const app = await groupedTree({
      needs: [variantName],
      sources: { "platform/dict.ts": beforeBuild, "platform/dict.rbx.ts": beforeBuild },
      variantFiles: { "platform/dict.luau": "-- Compiled\n--[[ a doc comment ]]\nreturn nil\n" },
    });

    const [stale, ...rest] = staleDependencyDists(app);

    assert.deepEqual(rest, []);
    assert.equal(stale?.code, DistFreshnessCode.DistHalfBuilt);
    assert.match(stale?.detail ?? "", /platform[\\/]dict\.luau/);
  });

  test("reports a variant whose shared platform module was emitted as an empty Luau container", async () => {
    const app = await groupedTree({
      needs: [variantName],
      sources: { "platform/dict.ts": beforeBuild, "platform/dict.rbx.ts": beforeBuild },
      variantFiles: {
        "platform/dict.luau":
          "-- Compiled\nlocal Dict = {}\ndo\n\tlocal _container = Dict\n\t--[[ declared elsewhere ]]\nend\nreturn {\n\tDict = Dict,\n}\n",
      },
    });

    const [stale, ...rest] = staleDependencyDists(app);

    assert.deepEqual(rest, []);
    assert.equal(stale?.code, DistFreshnessCode.DistHalfBuilt);
    assert.match(stale?.detail ?? "", /platform[\\/]dict\.luau/);
  });

  test("passes a variant whose shared platform module carries a Luau implementation", async () => {
    const app = await groupedTree({
      needs: [variantName],
      sources: { "platform/dict.ts": beforeBuild, "platform/dict.rbx.ts": beforeBuild },
      variantFiles: { "platform/dict.luau": luauBody },
    });

    assert.deepEqual(staleDependencyDists(app), []);
  });

  test("passes once the reported variant is rebuilt", async () => {
    const app = await groupedTree({
      needs: [variantName],
      sources: { "index.ts": afterBuild },
      base: afterBuild + 1,
      variant: afterBuild + 1,
    });

    assert.deepEqual(staleDependencyDists(app), []);
  });

  test("judges a variant named only by a package reached through another dependency", async () => {
    const app = await groupedNeedThroughMiddleTree();

    const [stale, ...rest] = staleDependencyDists(app);

    assert.deepEqual(rest, []);
    assert.equal(stale?.code, DistFreshnessCode.DistStale);
    assert.match(stale?.rebuild ?? "", /npm run build:variant --prefix /);
  });
});
