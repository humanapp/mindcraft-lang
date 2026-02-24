#!/usr/bin/env node

const path = require("path");
const chalk = require("chalk");
const { PLATFORM_MODULES, PRIMITIVES_MODULES, generateMappings, copyPlatformFiles } = require("./build-utils");

const distDir = path.join(__dirname, "..", "dist", "rbx");

// Generate mappings for Roblox (.luau files)
const primitivesMappings = generateMappings(PRIMITIVES_MODULES, "rbx", ["luau", "d.ts", "d.ts.map"]);
const platformMappings = generateMappings(PLATFORM_MODULES, "rbx", ["luau", "d.ts", "d.ts.map"]);

// Transformer to fix TS.import statements in .luau files
function rbxTransformer(content, filename) {
  if (filename.endsWith(".luau")) {
    // Fix TS.import statements to point to generic files instead of .rbx files
    return content.replace(/TS\.import\([^,]+,\s*[^,]+,\s*"([^"]+)\.rbx"\)/g, 'TS.import(script, script.Parent, "$1")');
  }
  return content;
}

// Copy primitives files
const primitivesDir = path.join(distDir, "primitives");
copyPlatformFiles(primitivesDir, primitivesMappings, rbxTransformer);

// Copy platform files
const platformDir = path.join(distDir, "platform");
copyPlatformFiles(platformDir, platformMappings, rbxTransformer);

console.log(chalk.green("Roblox platform file copying complete."));
