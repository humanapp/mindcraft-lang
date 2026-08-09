#!/usr/bin/env node

// Remove a package's private local `file:` dependencies from its manifest, in
// place.
//
// Usage: node scripts/strip-private-local-deps.js <dir>
//
// Run by the publish workflow of the package at <dir>, on the CI runner, after
// the build and tests and before `npm publish`. Only `dependencies` is touched;
// a `file:` specifier naming a public sibling is left alone.

const { readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

/** Prefix of a dependency specifier naming a package by its location on disk. */
const localSpecifier = "file:";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Remove the private local dependencies from the manifest of the package at
 * `dir`. Returns the names removed, in declaration order.
 *
 * @param {string} dir - Directory of the package being published
 */
function stripPrivateLocalDependencies(dir) {
  const pkg = readJson(join(dir, "package.json"));
  const removed = [];

  for (const [name, specifier] of Object.entries(pkg.dependencies || {})) {
    if (!specifier.startsWith(localSpecifier)) continue;
    const localPath = specifier.slice(localSpecifier.length);
    const sibling = readJson(join(dir, localPath, "package.json"));
    if (!sibling.private) continue;
    delete pkg.dependencies[name];
    removed.push(name);
  }

  writeJson(join(dir, "package.json"), pkg);
  return removed;
}

function main(argv) {
  if (argv.length !== 1) {
    console.error("Usage: node scripts/strip-private-local-deps.js <dir>");
    return 1;
  }

  const dir = resolve(process.cwd(), argv[0]);
  const removed = stripPrivateLocalDependencies(dir);
  console.log(
    removed.length === 0
      ? "No private local file: dependencies to strip."
      : `Removed private local dependencies: ${removed.join(", ")}`
  );
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
