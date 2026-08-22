import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { formatCliVersion, readCliVersion } from "./cli.js";
import { makeScratchDir, runCliBin } from "./test-support/publish-fixtures.js";

const tempRoots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "wendoo-cli-version-"));
  tempRoots.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("readCliVersion", () => {
  it("reads the version from a package.json", () => {
    const root = tempRoot();
    const packageJson = path.join(root, "package.json");
    writeFileSync(packageJson, JSON.stringify({ name: "wendoo-cli", version: "9.9.9" }));
    assert.equal(readCliVersion(packageJson), "9.9.9");
  });

  it("falls back to 0.0.0 when no version is declared", () => {
    const root = tempRoot();
    const packageJson = path.join(root, "package.json");
    writeFileSync(packageJson, JSON.stringify({ name: "wendoo-cli" }));
    assert.equal(readCliVersion(packageJson), "0.0.0");
  });
});

describe("formatCliVersion", () => {
  it("appends (local) for a working-copy build with src/ present", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "src"), { recursive: true });
    mkdirSync(path.join(root, "dist"), { recursive: true });
    assert.equal(formatCliVersion("9.9.9", path.join(root, "dist", "main.js")), "9.9.9 (local)");
  });

  it("prints no marker for a dist-only build", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "dist"), { recursive: true });
    assert.equal(formatCliVersion("9.9.9", path.join(root, "dist", "main.js")), "9.9.9");
  });
});

describe("wendoo CLI from a non-repo directory", () => {
  const scratchDirs: string[] = [];

  after(async () => {
    for (const dir of scratchDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function scratch(): Promise<string> {
    const dir = await makeScratchDir();
    scratchDirs.push(dir);
    return dir;
  }

  it("prints its own version for --version and -v and dispatches commands", async () => {
    const cwd = await scratch();
    for (const flag of ["--version", "-v"]) {
      const result = await runCliBin(cwd, flag);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /^\d+\.\d+\.\d+( \(local\))?\n$/);
    }

    const unknown = await runCliBin(cwd, "definitely-not-a-command");
    assert.equal(unknown.code, 1);
  });
});
