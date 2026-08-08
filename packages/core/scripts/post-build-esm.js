#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const {
  PLATFORM_MODULES,
  PRIMITIVES_MODULES,
  generateMappings,
  copyPlatformFiles,
  platformEmitDir,
} = require("./build-utils");

const distDir = path.join(__dirname, "..", "dist", "esm");

/** Characters a JavaScript identifier is made of. */
const identifierChar = /[A-Za-z0-9_$]/;

/** Words a `/` may follow and still open a regular expression. */
const regexPrecedents = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "typeof",
  "void",
  "yield",
]);

/**
 * Whether a `/` following `previous` -- the last significant token scanned --
 * opens a regular expression rather than a division.
 *
 * @param {string} previous - Last significant token, a whole word or a single character; empty at the start of a file
 * @returns {boolean} True when the `/` opens a regular expression
 */
function opensRegex(previous) {
  if (previous === "") return true;
  if (regexPrecedents.has(previous)) return true;
  return !/[A-Za-z0-9_$)\]}'"`]$/.test(previous);
}

/**
 * Index just past the string literal that opens at `start`, or the end of its
 * line when the literal is unterminated.
 *
 * @param {string} source - Text being scanned
 * @param {number} start - Index of the opening quote
 * @returns {number} Index just past the closing quote
 */
function endOfQuoted(source, start) {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") i++;
    else if (ch === quote) return i + 1;
    else if (ch === "\n") return i;
  }
  return source.length;
}

/**
 * Index just past the regular expression literal that opens at `start`,
 * including its flags, or the end of its line when it is unterminated.
 *
 * @param {string} source - Text being scanned
 * @param {number} start - Index of the opening slash
 * @returns {number} Index just past the last flag character
 */
function endOfRegex(source, start) {
  let inClass = false;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") i++;
    else if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "\n") return i;
    else if (ch === "/" && !inClass) {
      let end = i + 1;
      while (end < source.length && identifierChar.test(source[end])) end++;
      return end;
    }
  }
  return source.length;
}

/**
 * Rewrite every relative module specifier of an ES module through `rewrite`,
 * leaving text inside strings, template literals, comments, and regular
 * expressions exactly as it was found.
 *
 * @param {string} source - Contents of an emitted module
 * @param {Function} rewrite - Maps a relative specifier to the specifier to emit in its place
 * @returns {string} The module with each specifier replaced by its rewrite
 */
function rewriteRelativeSpecifiers(source, rewrite) {
  // Each frame is either a template literal's text or a code context: the
  // module's own, or one opened by a `${` inside a template.
  const frames = [{ template: false, braces: 0 }];
  let previous = "";
  let out = "";
  let i = 0;

  while (i < source.length) {
    const frame = frames[frames.length - 1];
    const ch = source[i];

    if (frame.template) {
      if (ch === "\\") {
        out += source.slice(i, i + 2);
        i += 2;
      } else if (ch === "`") {
        frames.pop();
        previous = "`";
        out += ch;
        i++;
      } else if (ch === "$" && source[i + 1] === "{") {
        frames.push({ template: false, braces: 0 });
        previous = "{";
        out += "${";
        i += 2;
      } else {
        out += ch;
        i++;
      }
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      const stop = source.indexOf("\n", i);
      out += source.slice(i, stop === -1 ? source.length : stop);
      i = stop === -1 ? source.length : stop;
      continue;
    }

    if (ch === "/" && source[i + 1] === "*") {
      const stop = source.indexOf("*/", i + 2);
      const end = stop === -1 ? source.length : stop + 2;
      out += source.slice(i, end);
      i = end;
      continue;
    }

    if (ch === "/" && opensRegex(previous)) {
      const end = endOfRegex(source, i);
      out += source.slice(i, end);
      i = end;
      previous = "/";
      continue;
    }

    if (ch === '"' || ch === "'") {
      const end = endOfQuoted(source, i);
      out += source.slice(i, end);
      i = end;
      previous = ch;
      continue;
    }

    if (ch === "`") {
      frames.push({ template: true });
      out += ch;
      i++;
      continue;
    }

    if (ch === "}" && frame.braces === 0 && frames.length > 1) {
      frames.pop();
      out += ch;
      i++;
      previous = ch;
      continue;
    }

    if (identifierChar.test(ch)) {
      let end = i;
      while (end < source.length && identifierChar.test(source[end])) end++;
      const word = source.slice(i, end);
      out += word;
      i = end;
      previous = word;

      // A quote directly after `from` or `import` opens a module specifier.
      if (word === "from" || word === "import") {
        let quoteAt = i;
        while (quoteAt < source.length && (source[quoteAt] === " " || source[quoteAt] === "\t")) quoteAt++;
        const quote = source[quoteAt];
        const stop = quote === '"' || quote === "'" ? endOfQuoted(source, quoteAt) : -1;
        if (stop > quoteAt + 1 && source[stop - 1] === quote) {
          const specifier = source.slice(quoteAt + 1, stop - 1);
          out +=
            source.slice(i, quoteAt) + quote + (specifier.startsWith(".") ? rewrite(specifier) : specifier) + quote;
          i = stop;
          previous = quote;
        }
      }
      continue;
    }

    if (ch === "{") frame.braces++;
    else if (ch === "}") frame.braces--;
    if (!/\s/.test(ch)) previous = ch;
    out += ch;
    i++;
  }

  return out;
}

/**
 * Give every relative import of every module under `dir` the extension ESM
 * requires, resolving a specifier that names a directory to its `index.js`.
 * A module whose specifiers already read that way is left untouched.
 *
 * @param {string} dir - Directory of emitted ES modules to walk
 */
function fixESModuleImports(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);

    if (file.isDirectory()) {
      fixESModuleImports(fullPath);
    } else if (file.name.endsWith(".js")) {
      const content = fs.readFileSync(fullPath, "utf8");

      const fixed = rewriteRelativeSpecifiers(content, (importPath) => {
        // A specifier ending in .js may still name a directory holding an index.
        if (importPath.endsWith(".js")) {
          const pathWithoutJs = importPath.slice(0, -3);
          const resolvedPath = path.resolve(path.dirname(fullPath), pathWithoutJs);

          if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
            const indexPath = path.join(resolvedPath, "index.js");
            if (fs.existsSync(indexPath)) {
              return `${pathWithoutJs}/index.js`;
            }
          }
        }

        if (!importPath.includes(".")) {
          const resolvedPath = path.resolve(path.dirname(fullPath), importPath);
          const indexPath = path.join(resolvedPath, "index.js");

          return fs.existsSync(indexPath) ? `${importPath}/index.js` : `${importPath}.js`;
        }

        return importPath;
      });

      if (fixed === content) continue;

      fs.writeFileSync(fullPath, fixed);
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
copyPlatformFiles(primitivesDir, platformEmitDir("esm", "primitives"), primitivesMappings, esmTransformer);

// Copy platform files with transformation
const platformDir = path.join(distDir, "platform");
copyPlatformFiles(platformDir, platformEmitDir("esm", "platform"), platformMappings, esmTransformer);

// Fix ES module imports across the entire dist directory
console.log(`${chalk.blue("Fixing ES module imports...")}`);
fixESModuleImports(distDir);

console.log(`${chalk.green("[ok]")} ESM platform files updated and imports fixed successfully!`);
