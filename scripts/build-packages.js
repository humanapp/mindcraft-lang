#!/usr/bin/env node

// Build all local @mindcraft-lang/* package dependencies of an app in
// topological order.
//
// Usage: node scripts/build-packages.js <app-dir>
//
// Reads the app's package.json and all transitive file: dependency package.json
// files to determine build order. Runs `npm run build:prod` for each package.

const { execSync } = require("node:child_process");
const { readFileSync, existsSync } = require("node:fs");
const { join, resolve, dirname } = require("node:path");

const SCOPE = "@mindcraft-lang/";

const appDirArg = process.argv[2];
if (!appDirArg) {
  console.error("Usage: node scripts/build-packages.js <app-dir>");
  process.exit(1);
}

const appDir = resolve(process.cwd(), appDirArg);

function readPkgAt(dir) {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

/**
 * Collects all local @mindcraft-lang/* package directories that dir depends on
 * (transitively), in topological order (dependencies before dependents).
 * The root appDir itself is excluded from the output.
 */
function collect(dir, visited, order, isRoot) {
  const realDir = resolve(dir);
  if (visited.has(realDir)) return;
  visited.add(realDir);

  const pkg = readPkgAt(realDir);
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  for (const [name, val] of Object.entries(allDeps)) {
    if (!val.startsWith("file:")) continue;
    if (!name.startsWith(SCOPE)) continue;
    const depDir = resolve(realDir, val.slice(5));
    if (!existsSync(join(depDir, "package.json"))) continue;
    collect(depDir, visited, order, false);
  }

  const pkgName = pkg.name ?? "";
  if (!isRoot && pkgName.startsWith(SCOPE)) {
    order.push(realDir);
  }
}

const visited = new Set();
const order = [];
collect(appDir, visited, order, true);

if (order.length === 0) {
  console.log("No local package dependencies to build.");
  process.exit(0);
}

console.log(`Building ${order.length} package(s) in dependency order:`);
for (const pkgDir of order) {
  const pkg = readPkgAt(pkgDir);
  console.log(`  ${pkg.name}`);
}

for (const pkgDir of order) {
  const pkg = readPkgAt(pkgDir);
  const scripts = pkg.scripts ?? {};
  const buildScript = scripts["build:prod"] ? "build:prod" : scripts["build"] ? "build" : null;
  if (!buildScript) {
    console.log(`\n> Skipping ${pkg.name} (no build script)`);
    continue;
  }
  console.log(`\n> Building ${pkg.name} (npm run ${buildScript})...`);
  execSync(`npm run ${buildScript}`, { stdio: "inherit", cwd: pkgDir });
}

console.log("\nAll packages built successfully.");
