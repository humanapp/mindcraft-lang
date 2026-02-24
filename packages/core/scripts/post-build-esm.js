#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const { PLATFORM_MODULES, PRIMITIVES_MODULES, generateMappings, copyPlatformFiles } = require("./build-utils");

const distDir = path.join(__dirname, "..", "dist", "esm");

/**
 * Fix ES module imports to include .js extensions.
 * ESM requires explicit file extensions for relative imports.
 */
function fixESModuleImports(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);

    if (file.isDirectory()) {
      fixESModuleImports(fullPath);
    } else if (file.name.endsWith(".js")) {
      let content = fs.readFileSync(fullPath, "utf8");

      // Fix relative imports that don't have extensions and convert .js to /index.js for directories
      content = content.replace(/from\s+["'](\.[^"']*?)["']/g, (match, importPath) => {
        // Check if this path ending in .js is actually a directory
        if (importPath.endsWith(".js")) {
          const pathWithoutJs = importPath.slice(0, -3);
          const resolvedPath = path.resolve(path.dirname(fullPath), pathWithoutJs);

          // If it's a directory with an index.js, use that
          if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
            const indexPath = path.join(resolvedPath, "index.js");
            if (fs.existsSync(indexPath)) {
              return `from "${pathWithoutJs}/index.js"`;
            }
          }
        }

        // Handle imports without extensions
        if (!importPath.includes(".")) {
          const resolvedPath = path.resolve(path.dirname(fullPath), importPath);
          const indexPath = path.join(resolvedPath, "index.js");

          if (fs.existsSync(indexPath)) {
            return `from "${importPath}/index.js"`;
          } else {
            return `from "${importPath}.js"`;
          }
        }

        // Keep paths with extensions as-is
        return match;
      });

      fs.writeFileSync(fullPath, content);
      console.log(`Fixed imports in ${chalk.cyan(path.relative(distDir, fullPath))}`);
    }
  }
}

// Generate mappings for ESM (uses .node.js files, same as Node.js build)
const primitivesMappings = generateMappings(PRIMITIVES_MODULES, "node", ["js", "d.ts", "d.ts.map"]);
const platformMappings = generateMappings(PLATFORM_MODULES, "node", ["js", "d.ts", "d.ts.map"]);

// Transformer to fix import statements in ESM files
function esmTransformer(content, filename) {
  if (filename.endsWith(".js")) {
    // Fix import statements to point to generic files instead of .node files
    // Handles both: import ... from "./module.node" and import ... from "./module.node.js"
    return content.replace(/from\s+["'](\.[^"']+)\.node(\.js)?["']/g, 'from "$1.js"');
  }
  return content;
}

// Copy primitives files with transformation
const primitivesDir = path.join(distDir, "primitives");
copyPlatformFiles(primitivesDir, primitivesMappings, esmTransformer);

// Copy platform files with transformation
const platformDir = path.join(distDir, "platform");
copyPlatformFiles(platformDir, platformMappings, esmTransformer);

// Fix ES module imports across the entire dist directory
console.log(`${chalk.blue("Fixing ES module imports...")}`);
fixESModuleImports(distDir);

console.log(`${chalk.green("[ok]")} ESM platform files updated and imports fixed successfully!`);
