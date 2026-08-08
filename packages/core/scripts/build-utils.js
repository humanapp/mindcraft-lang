#!/usr/bin/env node

/**
 * Shared utilities for post-build scripts.
 *
 * This module provides common functionality for copying platform-specific
 * implementations over generic type declarations across all build targets.
 */

const fs = require("fs");
const path = require("path");
const chalk = require("chalk");

/**
 * Base file names (without extensions) for modules that have platform-specific implementations.
 */
const PLATFORM_MODULES = [
  "dict",
  "list",
  "error",
  "string",
  "logger",
  "vector2",
  "vector3",
  "stream",
  "math",
  "task",
  "uniqueset",
  "time",
  "types",
];
const PRIMITIVES_MODULES = ["fourcc"];

/**
 * Directory beside the package manifest holding each build target's platform
 * emit, preserved so the substitution can be applied again on a later run.
 */
const PLATFORM_EMIT_DIR = ".platform-emit";

/**
 * Directory holding the preserved platform emit for one build target's output
 * subdirectory.
 * @param {string} target - Build target, named for its `dist` subdirectory ("node", "esm", "rbx")
 * @param {string} subdir - Output subdirectory the modules sit in ("platform", "primitives")
 * @returns {string} Absolute path of the directory
 */
function platformEmitDir(target, subdir) {
  return path.join(__dirname, "..", PLATFORM_EMIT_DIR, target, subdir);
}

/**
 * Generate file mappings for a given platform suffix and file extensions.
 * @param {string[]} modules - Array of module names
 * @param {string} platformSuffix - Platform suffix (e.g., "node", "rbx")
 * @param {string[]} extensions - File extensions to map (e.g., ["js", "d.ts", "d.ts.map"] or ["luau", "d.ts", "d.ts.map"])
 * @returns {Object} Mapping of platform-specific files to generic files
 */
function generateMappings(modules, platformSuffix, extensions) {
  const mappings = {};
  for (const module of modules) {
    for (const ext of extensions) {
      const platformFile = `${module}.${platformSuffix}.${ext}`;
      const genericFile = `${module}.${ext}`;
      mappings[platformFile] = genericFile;
    }
  }
  return mappings;
}

/**
 * Write each platform-specific build output over the generic module it
 * implements, applying an optional transformation, and preserve the platform
 * output under `storeDir`.
 *
 * A run takes the compiler's freshly emitted platform file whenever one is
 * present in `dir`, refreshing the store, and reads the store otherwise. The
 * platform file is removed from `dir` either way, leaving only generic names in
 * the build output. A generic file is written only when the substitution
 * changes its bytes, so a run that substitutes nothing new leaves the build
 * output untouched. Exits non-zero naming any module whose platform output is
 * in neither place.
 *
 * A declaration file's `sourceMappingURL` is retargeted to the map name the
 * substitution leaves beside it.
 *
 * @param {string} dir - Directory containing the build output
 * @param {string} storeDir - Directory the platform output is preserved in
 * @param {Object} mappings - Mapping of platform-specific file names to generic file names
 * @param {Function} [transformer] - Optional function to transform file content before writing
 */
function copyPlatformFiles(dir, storeDir, mappings, transformer) {
  const missing = [];

  for (const [platformFile, genericFile] of Object.entries(mappings)) {
    const emittedPath = path.join(dir, platformFile);
    const storedPath = path.join(storeDir, platformFile);
    const genericPath = path.join(dir, genericFile);

    if (fs.existsSync(emittedPath)) {
      fs.mkdirSync(storeDir, { recursive: true });
      fs.copyFileSync(emittedPath, storedPath);
      fs.unlinkSync(emittedPath);
    }

    if (!fs.existsSync(storedPath)) {
      missing.push(platformFile);
      continue;
    }

    let content = fs.readFileSync(storedPath, "utf8");

    if (transformer) {
      content = transformer(content, platformFile);
    }

    content = content.replace(`//# sourceMappingURL=${platformFile}.map`, `//# sourceMappingURL=${genericFile}.map`);

    const current = fs.existsSync(genericPath) ? fs.readFileSync(genericPath, "utf8") : undefined;
    if (current === content) {
      continue;
    }

    console.log(chalk.cyan(`Substituting ${platformFile} for ${genericFile}`));
    fs.writeFileSync(genericPath, content);
  }

  if (missing.length > 0) {
    console.error(chalk.red(`ERROR: Missing expected platform files in ${dir}:`));
    for (const f of missing) {
      console.error(chalk.red(`  - ${f}`));
    }
    console.error(chalk.red("This usually means the compiler did not generate all expected output."));
    console.error(chalk.red("Try: npm run clean && npm run build"));
    process.exit(1);
  }
}

module.exports = {
  PLATFORM_MODULES,
  PRIMITIVES_MODULES,
  generateMappings,
  copyPlatformFiles,
  platformEmitDir,
};
