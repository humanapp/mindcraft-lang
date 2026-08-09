#!/usr/bin/env node

// Rewrite a package's public local `file:` dependencies to registry version
// ranges, in place, and re-resolve its lockfile against the registry.
//
// Usage: node scripts/rewrite-local-deps.js <dir>
//
// Run by the publish workflow of the package at <dir>, on the CI runner, before
// `npm ci` and `npm publish`. In both `dependencies` and `devDependencies`,
// every `file:` dependency naming a public sibling becomes `^<the sibling's
// version>`. A `file:` dependency naming a private sibling is left unchanged.
// Failed re-resolves are retried with a linear backoff before the script exits
// non-zero.

const { execSync } = require("node:child_process");
const { readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

/** Prefix of a dependency specifier naming a package by its location on disk. */
const localSpecifier = "file:";

/** Manifest fields holding dependencies that are rewritten. */
const dependencyFields = ["dependencies", "devDependencies"];

/** Command that re-resolves the lockfile without touching `node_modules`. */
const resolveCommand = "npm install --package-lock-only";

/** How many times `resolveCommand` runs before the script gives up. */
const resolveAttempts = 5;

/** Seconds waited after the Nth failed attempt, multiplied by N. */
const retryBackoffSeconds = 15;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Rewrite the manifest and lockfile of the package at `dir` in place. Returns
 * the names of the dependencies that were rewritten, in declaration order.
 *
 * @param {string} dir - Directory of the package being published
 */
function rewriteLocalDependencies(dir) {
  const pkg = readJson(join(dir, "package.json"));
  const lock = readJson(join(dir, "package-lock.json"));
  const rewritten = [];

  for (const field of dependencyFields) {
    for (const [name, specifier] of Object.entries(pkg[field] || {})) {
      if (!specifier.startsWith(localSpecifier)) continue;
      const localPath = specifier.slice(localSpecifier.length);
      const sibling = readJson(join(dir, localPath, "package.json"));
      if (sibling.private) continue;
      pkg[field][name] = `^${sibling.version}`;
      // Drop the file:-based lockfile entries so npm re-resolves from registry
      delete lock.packages[localPath];
      delete lock.packages[`node_modules/${name}`];
      rewritten.push(name);
    }
  }

  writeJson(join(dir, "package.json"), pkg);
  writeJson(join(dir, "package-lock.json"), lock);
  return rewritten;
}

/**
 * Re-resolve the lockfile of the package at `dir`, retrying up to
 * `resolveAttempts` times with a linear backoff. Throws when every attempt
 * fails.
 *
 * @param {string} dir - Directory of the package being published
 */
function resolveLockfile(dir) {
  for (let attempt = 1; attempt <= resolveAttempts; attempt++) {
    try {
      execSync(resolveCommand, { stdio: "inherit", cwd: dir });
      return;
    } catch {
      if (attempt === resolveAttempts) {
        throw new Error(`${resolveCommand} failed after ${attempt} attempts`);
      }
      const wait = attempt * retryBackoffSeconds;
      console.error(
        `Attempt ${attempt} failed (a just-published dependency version may not be resolvable yet); ` +
          `retrying in ${wait}s...`
      );
      execSync(`sleep ${wait}`);
    }
  }
}

function main(argv) {
  if (argv.length !== 1) {
    console.error("Usage: node scripts/rewrite-local-deps.js <dir>");
    return 1;
  }

  const dir = resolve(process.cwd(), argv[0]);
  const rewritten = rewriteLocalDependencies(dir);
  console.log(
    rewritten.length === 0
      ? "No public local file: dependencies to rewrite."
      : `Rewrote to version ranges: ${rewritten.join(", ")}`
  );
  resolveLockfile(dir);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
