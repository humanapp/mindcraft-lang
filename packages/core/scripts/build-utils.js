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
 * Copy platform-specific files to generic files, applying optional transformations.
 * @param {string} dir - Directory containing the files
 * @param {Object} mappings - File mapping object
 * @param {Function} [transformer] - Optional function to transform file content before writing
 */
function copyPlatformFiles(dir, mappings, transformer) {
  const missing = [];

  for (const [platformFile, genericFile] of Object.entries(mappings)) {
    const platformPath = path.join(dir, platformFile);
    const genericPath = path.join(dir, genericFile);

    if (fs.existsSync(platformPath)) {
      console.log(chalk.cyan(`Copying ${platformFile} to ${genericFile}`));

      let content = fs.readFileSync(platformPath, "utf8");

      // Apply transformation if provided
      if (transformer) {
        content = transformer(content, platformFile);
      }

      fs.writeFileSync(genericPath, content);

      console.log(chalk.gray(`Deleting ${platformFile}`));
      fs.unlinkSync(platformPath);
    } else {
      missing.push(platformFile);
    }
  }

  if (missing.length > 0) {
    console.error(chalk.red(`ERROR: Missing expected platform files in ${dir}:`));
    for (const f of missing) {
      console.error(chalk.red(`  - ${f}`));
    }
    console.error(chalk.red("This usually means the compiler did not generate all expected output."));
    console.error(chalk.red("Try: rm -rf dist/ && npm run build"));
    process.exit(1);
  }
}

module.exports = {
  PLATFORM_MODULES,
  PRIMITIVES_MODULES,
  generateMappings,
  copyPlatformFiles,
};
