import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { findLocalCliMain, isLocalBuild, runLocalBuild, shouldRedirect } from "./local-redirect.js";

const tempRoots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mindcraft-cli-redirect-"));
  tempRoots.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Materialize a `.../packages/cli` candidate under `cliDir`: write a package.json
 * with `name`, and, when `built`, an empty `dist/main.js`.
 */
function makeCliCandidate(cliDir: string, name: string, built: boolean): void {
  mkdirSync(cliDir, { recursive: true });
  writeFileSync(path.join(cliDir, "package.json"), JSON.stringify({ name, version: "0.0.0" }));
  if (built) {
    mkdirSync(path.join(cliDir, "dist"), { recursive: true });
    writeFileSync(path.join(cliDir, "dist", "main.js"), "");
  }
}

/** A deep start directory nested several levels under `base`. */
function deepStart(base: string): string {
  const deep = path.join(base, "a", "b", "c", "d");
  mkdirSync(deep, { recursive: true });
  return deep;
}

describe("findLocalCliMain", () => {
  it("finds the direct mindcraft-lang layout (packages/cli)", () => {
    const root = tempRoot();
    const cliDir = path.join(root, "packages", "cli");
    makeCliCandidate(cliDir, "mindcraft-cli", true);
    assert.equal(findLocalCliMain(deepStart(cliDir)), path.join(cliDir, "dist", "main.js"));
  });

  it("finds the mcu-embedded layout (external/mindcraft-lang/packages/cli)", () => {
    const root = tempRoot();
    const cliDir = path.join(root, "external", "mindcraft-lang", "packages", "cli");
    makeCliCandidate(cliDir, "mindcraft-cli", true);
    assert.equal(findLocalCliMain(deepStart(root)), path.join(cliDir, "dist", "main.js"));
  });

  it("ignores a packages/cli whose package name differs", () => {
    const root = tempRoot();
    makeCliCandidate(path.join(root, "packages", "cli"), "some-other-cli", true);
    assert.equal(findLocalCliMain(deepStart(root)), undefined);
  });

  it("ignores a name-matching package that has no dist/main.js", () => {
    const root = tempRoot();
    makeCliCandidate(path.join(root, "packages", "cli"), "mindcraft-cli", false);
    assert.equal(findLocalCliMain(deepStart(root)), undefined);
  });

  it("returns undefined when nothing qualifies up to the root", () => {
    const root = tempRoot();
    assert.equal(findLocalCliMain(deepStart(root)), undefined);
  });
});

describe("shouldRedirect", () => {
  it("does not redirect when there is no local build", () => {
    assert.equal(shouldRedirect({ localMain: undefined, runningMain: "/anything", env: {} }), false);
  });

  it("does not redirect when the escape hatch is set", () => {
    const root = tempRoot();
    const local = path.join(root, "local.js");
    const running = path.join(root, "running.js");
    writeFileSync(local, "");
    writeFileSync(running, "");
    assert.equal(
      shouldRedirect({ localMain: local, runningMain: running, env: { MINDCRAFT_CLI_NO_REDIRECT: "1" } }),
      false
    );
  });

  it("does not redirect when already running as a re-exec'd local build (loop guard)", () => {
    const root = tempRoot();
    const local = path.join(root, "local.js");
    const running = path.join(root, "running.js");
    writeFileSync(local, "");
    writeFileSync(running, "");
    assert.equal(shouldRedirect({ localMain: local, runningMain: running, env: { MINDCRAFT_CLI_LOCAL: "1" } }), false);
  });

  it("does not redirect when the local build is the running build (self, via realpath)", () => {
    const root = tempRoot();
    const real = path.join(root, "main.js");
    const link = path.join(root, "link.js");
    writeFileSync(real, "");
    symlinkSync(real, link);
    assert.equal(shouldRedirect({ localMain: link, runningMain: real, env: {} }), false);
  });

  it("redirects when a distinct local build exists and no guard blocks it", () => {
    const root = tempRoot();
    const local = path.join(root, "local.js");
    const running = path.join(root, "running.js");
    writeFileSync(local, "");
    writeFileSync(running, "");
    assert.equal(shouldRedirect({ localMain: local, runningMain: running, env: {} }), true);
  });
});

describe("isLocalBuild", () => {
  it("is true for a build whose package root has src/ beside dist/", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "src"), { recursive: true });
    mkdirSync(path.join(root, "dist"), { recursive: true });
    assert.equal(isLocalBuild(path.join(root, "dist", "main.js")), true);
  });

  it("is false for a dist-only build with no src/ (a published install)", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "dist"), { recursive: true });
    assert.equal(isLocalBuild(path.join(root, "dist", "main.js")), false);
  });
});

describe("runLocalBuild", () => {
  it("forwards argv verbatim, marks the child env, and propagates the exit code", async () => {
    const root = tempRoot();
    const childScript = path.join(root, "child.cjs");
    const outFile = path.join(root, "out.json");
    writeFileSync(
      childScript,
      [
        'const fs = require("node:fs");',
        "const out = process.argv[2];",
        "fs.writeFileSync(out, JSON.stringify({ argv: process.argv.slice(2), local: process.env.MINDCRAFT_CLI_LOCAL }));",
        "process.exit(3);",
      ].join("\n")
    );

    const args = [outFile, "alpha", "beta"];
    const code = await runLocalBuild(childScript, args, { ...process.env });

    assert.equal(code, 3);
    const recorded = JSON.parse(await readFile(outFile, "utf8")) as { argv: string[]; local: string };
    assert.deepEqual(recorded.argv, args);
    assert.equal(recorded.local, "1");
  });
});
