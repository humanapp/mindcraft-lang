import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { createTargetBuildStamp, readCoreBuild } from "./build-stamp.js";

/** Temporary trees this file created, removed once it finishes. */
const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

/** Version the fixture language package declares for itself. */
const languageVersion = "1.2.3";

/** The Node build output of the fixture language package, keyed by path under it. */
const builtLanguage: Readonly<Record<string, string>> = {
  "index.js": "exports.think = 1;\n",
  "index.d.ts": "export declare const think: number;\n",
  "index.js.map": '{"version":3}\n',
  "brain/rules.js": "exports.armed = true;\n",
};

/** Write `content` at `path`, creating the directories above it. */
async function write(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}

/**
 * A fresh tree holding a root package that depends on a local language package
 * carrying `output` as its Node build, returning the root package directory.
 * A language package with no `output` at all is written without a build.
 */
async function tree(output: Readonly<Record<string, string>> = builtLanguage, prefix = "stamp-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  await write(
    join(root, "package.json"),
    JSON.stringify({ name: "root", dependencies: { "@wendoo/core": "file:./core" } })
  );
  await write(join(root, "core", "package.json"), JSON.stringify({ name: "@wendoo/core", version: languageVersion }));
  for (const [path, content] of Object.entries(output)) {
    await write(join(root, "core", "dist", "node", ...path.split("/")), content);
  }
  return root;
}

/** The hash of a tree holding `output` as its language build. */
async function hashOf(output: Readonly<Record<string, string>>): Promise<string> {
  return (await readCoreBuild(await tree(output))).coreDistHash;
}

describe("reading the language build a package consumes", () => {
  test("reports the version the language package declares", async () => {
    const build = await readCoreBuild(await tree());

    assert.equal(build.coreVersion, languageVersion);
    assert.match(build.coreDistHash, /^[0-9a-f]{64}$/);
  });

  test("hashes the same content in another location the same", async () => {
    const [first, second] = [await hashOf(builtLanguage), await hashOf(builtLanguage)];

    assert.equal(first, second);
  });

  test("hashes differently when a script's content changes", async () => {
    const changed = { ...builtLanguage, "brain/rules.js": "exports.armed = false;\n" };

    assert.notEqual(await hashOf(changed), await hashOf(builtLanguage));
  });

  test("hashes differently when a script moves", async () => {
    const elsewhere = Object.fromEntries(
      Object.entries(builtLanguage).map(([path, content]) =>
        path === "brain/rules.js" ? ["brain/triggers.js", content] : [path, content]
      )
    );

    assert.notEqual(await hashOf(elsewhere), await hashOf(builtLanguage));
  });

  test("hashes differently when a script is added", async () => {
    const added = { ...builtLanguage, "brain/modes.js": "exports.otherwise = 1;\n" };

    assert.notEqual(await hashOf(added), await hashOf(builtLanguage));
  });

  test("hashes the same when output that is not a script changes", async () => {
    const retyped = { ...builtLanguage, "index.d.ts": "export declare const think: 1 | 2;\n" };

    assert.equal(await hashOf(retyped), await hashOf(builtLanguage));
  });

  test("reports a package that reaches no language package", async () => {
    const root = await mkdtemp(join(tmpdir(), "stamp-bare-"));
    roots.push(root);
    await write(join(root, "package.json"), JSON.stringify({ name: "root" }));

    assert.throws(() => readCoreBuild(root), /@wendoo\/core/);
  });

  test("reports a language package that was never built", async () => {
    const root = await tree({}, "stamp-unbuilt-");

    assert.throws(() => readCoreBuild(root), /dist\/node/);
  });
});

describe("the stamp an artifact publishes", () => {
  test("carries the language build and the moment it was built", async () => {
    const root = await tree();

    const stamp = createTargetBuildStamp(root);

    assert.deepEqual({ coreVersion: stamp.coreVersion, coreDistHash: stamp.coreDistHash }, await readCoreBuild(root));
    assert.equal(new Date(stamp.builtAt).toISOString(), stamp.builtAt);
  });
});
