#!/usr/bin/env node
/**
 * One-command release for the ecosim target package: bumps the target
 * manifest version, repackages the app bundle at the new version, then publishes
 * the target, stopping at the first step that fails. Run through
 * `npm run release-trg <patch|minor|major>`.
 *
 * The three steps mirror the manual release, each run from the app directory:
 *   1. wendoo version <bump> --dir target-package  (bump the manifest)
 *   2. npm run package                                 (rebuild dist + re-bake)
 *   3. wendoo publish --dir target-package          (ship it verbatim)
 * A nonzero exit from any step aborts the rest and becomes this script's exit
 * code. The `wendoo` binary resolves from the app's node_modules/.bin,
 * provided by the wendoo file: devDependency.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_BUMPS = ["patch", "minor", "major"];
const USAGE = "usage: npm run release-trg <patch|minor|major>";

const bump = process.argv[2];
if (bump === undefined) {
  console.error("release: a version component (patch, minor, or major) is required.");
  console.error(USAGE);
  process.exit(1);
}
if (!VERSION_BUMPS.includes(bump)) {
  console.error(`release: unknown version component "${bump}".`);
  console.error(USAGE);
  process.exit(1);
}

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const targetPackageDir = "target-package";
const wendooBin = join(appDir, "node_modules", ".bin", "wendoo");

/**
 * Runs one release step from the app directory with inherited stdio. Exits this
 * process with a nonzero code when the step cannot be launched or exits nonzero,
 * so a failed step aborts the ones that follow.
 */
function runStep(command, args) {
  const printable = [command, ...args].join(" ");
  console.log(`release: ${printable}`);
  const result = spawnSync(command, args, { cwd: appDir, stdio: "inherit" });
  if (result.error !== undefined) {
    console.error(`release: failed to run "${printable}": ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`release: "${printable}" exited with code ${result.status}.`);
    process.exit(result.status === null ? 1 : result.status);
  }
}

runStep(wendooBin, ["version", bump, "--dir", targetPackageDir]);
runStep("npm", ["run", "package"]);
runStep(wendooBin, ["publish", "--dir", targetPackageDir]);

console.log(`release: ${bump} release complete.`);
