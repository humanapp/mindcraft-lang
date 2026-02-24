#!/usr/bin/env node

const path = require("path");
const chalk = require("chalk");
const { PLATFORM_MODULES, PRIMITIVES_MODULES, generateMappings, copyPlatformFiles } = require("./build-utils");

const distDir = path.join(__dirname, "..", "dist", "node");

// Generate mappings for Node.js (.js files)
const primitivesMappings = generateMappings(PRIMITIVES_MODULES, "node", ["js", "d.ts", "d.ts.map"]);
const platformMappings = generateMappings(PLATFORM_MODULES, "node", ["js", "d.ts", "d.ts.map"]);

// Transformer to fix require() statements
function nodeTransformer(content, filename) {
  if (filename.endsWith(".js")) {
    // Fix require statements to point to generic files instead of .node files
    return content.replace(/require\("\.\/([^"]+)\.node"\)/g, 'require("./$1")');
  }
  return content;
}

// Copy primitives files
const primitivesDir = path.join(distDir, "primitives");
copyPlatformFiles(primitivesDir, primitivesMappings, nodeTransformer);

// Copy platform files
const platformDir = path.join(distDir, "platform");
copyPlatformFiles(platformDir, platformMappings, nodeTransformer);

console.log(chalk.green("Platform file copying complete."));
