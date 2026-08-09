#!/usr/bin/env node

// Check that a package's TypeScript source files are partitioned across its
// compiler projects exactly as the package declares, and that the editor's
// language service reaches the same answer as the command-line gates.
//
// Usage:
//   node scripts/tsconfig-partition.js <dir>
//
// A package declares its partition in `tsconfig.projects.json` beside its
// package.json:
//
//   {
//     "solution": "tsconfig.json",
//     "projects": [
//       { "project": "tsconfig.app.json", "include": ["src/**/*.ts"], "exclude": ["src/**/*.spec.ts"] },
//       { "project": "tsconfig.spec.json", "include": ["src/**/*.spec.ts"] }
//     ]
//   }
//
// `include` and `exclude` carry tsconfig glob semantics and are resolved
// against the package directory. The list is ordered and the first entry whose
// patterns match a file owns it; later entries that also match it hold it as a
// shared input. `solution` names the config file that routes the editor: it
// compiles nothing of its own and references every project, in the order the
// list gives.
//
// Three answers are computed for every source file the package holds:
//
//   declared -- the first project in the list whose patterns match it
//   gate     -- the projects whose parsed configuration roots it
//   editor   -- the project the language service resolves it to, by walking up
//               to the nearest tsconfig.json and searching project references
//
// The package passes when all three agree for every file.

const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { dirname, join, relative, resolve, sep } = require("node:path");

/** File a package declares its partition in, beside its package.json. */
const conventionFile = "tsconfig.projects.json";

/** Stable identifiers for the ways a package's partition can be broken. */
const PartitionViolationCode = Object.freeze({
  /** A source file no project in the convention claims. */
  Orphaned: "partition_orphaned",
  /** A file two projects root while the convention gives it to one of them. */
  DoubleClaim: "partition_double_claim",
  /** A project whose configuration roots a different set of files than the convention derives. */
  ConfigDrift: "partition_config_drift",
  /** A file the language service resolves to a project other than the one that owns it. */
  EditorDisagreement: "partition_editor_disagreement",
  /** A compiler configuration the package holds that the convention does not name. */
  UnlistedConfig: "partition_unlisted_config",
});

/** Answer used in place of a project name for a file no configuration claims. */
const inferredProject = "(inferred)";

/** The TypeScript installation the package at `packageDir` compiles with. */
function loadTypeScript(packageDir) {
  const entry = require.resolve("typescript", { paths: [packageDir] });
  return require(entry);
}

/** Read and parse the JSON at `path`, throwing with the path when it is unreadable. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${error.message}`);
  }
}

/** Path of `file` relative to `packageDir`, in posix form. */
function packagePath(packageDir, file) {
  return relative(packageDir, file).split(sep).join("/");
}

/**
 * Every file the package holds, as package-relative posix paths. Files git
 * ignores are left out and files not yet committed are counted.
 */
function packageFiles(packageDir) {
  const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "."], {
    cwd: packageDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return listed
    .split("\n")
    .filter((line) => line.length > 0 && existsSync(join(packageDir, line)))
    .sort();
}

/** Every TypeScript source file the package holds, as package-relative posix paths. */
function sourceFiles(packageDir) {
  return packageFiles(packageDir).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
}

/**
 * Expand the `include` and `exclude` patterns of a convention entry against the
 * package directory, returning package-relative posix paths.
 */
function conventionMatches(ts, packageDir, entry) {
  const parsed = ts.parseJsonConfigFileContent(
    { compilerOptions: {}, include: entry.include, exclude: entry.exclude ?? [] },
    ts.sys,
    packageDir
  );
  if (parsed.errors.length > 0) {
    const [first] = parsed.errors;
    throw new Error(
      `${conventionFile} entry for ${entry.project}: ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`
    );
  }
  return new Set(parsed.fileNames.map((file) => packagePath(packageDir, file)));
}

/**
 * Parse the compiler configuration at `configPath`, returning the files it
 * roots inside the package and the configurations it references.
 */
function readProject(ts, packageDir, configPath) {
  const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  if (!parsed) throw new Error(`Cannot parse ${configPath}`);
  const roots = new Set();
  for (const file of parsed.fileNames) {
    const inside = packagePath(packageDir, file);
    if (!inside.startsWith("../")) roots.add(inside);
  }
  const references = (parsed.projectReferences ?? []).map((reference) => resolveReference(ts, reference.path));
  return { roots, references };
}

/** Absolute path of the configuration file a project reference names. */
function resolveReference(ts, referencePath) {
  const resolved = resolve(referencePath);
  return ts.sys.directoryExists(resolved) ? join(resolved, "tsconfig.json") : resolved;
}

/**
 * Resolve `file` the way the language service does: take the nearest
 * tsconfig.json at or above it, answer with that project when it roots the
 * file, otherwise search the projects it references depth first, then repeat
 * with the next tsconfig.json above. Walking stops at the package directory.
 * Returns a package-relative config path, or {@link inferredProject}.
 */
function editorProject(packageDir, file, projects) {
  const root = resolve(packageDir);
  let directory = dirname(resolve(root, file));
  for (;;) {
    const candidate = join(directory, "tsconfig.json");
    if (existsSync(candidate)) {
      const found = searchProject(root, file, candidate, projects, new Set());
      if (found) return found;
    }
    if (directory === root || dirname(directory) === directory) return inferredProject;
    directory = dirname(directory);
  }
}

/**
 * Answer with `configPath` when its project roots `file`, otherwise with the
 * first project it references, depth first, that does. Returns undefined when
 * neither it nor anything it reaches roots the file.
 */
function searchProject(packageDir, file, configPath, projects, seen) {
  if (seen.has(configPath)) return undefined;
  seen.add(configPath);
  const project = projects.get(configPath);
  if (!project) return undefined;
  if (project.roots.has(file)) return packagePath(packageDir, configPath);
  for (const reference of project.references) {
    const found = searchProject(packageDir, file, reference, projects, seen);
    if (found) return found;
  }
  return undefined;
}

/** Every compiler configuration file the package holds, as package-relative posix paths. */
function configFiles(packageDir) {
  return packageFiles(packageDir).filter((file) => {
    const name = file.slice(file.lastIndexOf("/") + 1);
    return name.startsWith("tsconfig.") && name.endsWith(".json") && name !== conventionFile;
  });
}

/**
 * Judge the partition of the package at `packageDir` against the convention it
 * declares, returning one entry per violation. An empty array means the
 * convention, the configurations, and the language service all agree.
 *
 * Throws when the package declares no convention, or when a configuration it
 * names cannot be parsed.
 */
function partitionViolations(packageDir) {
  const root = resolve(packageDir);
  const ts = loadTypeScript(root);
  const convention = readJson(join(root, conventionFile));
  const violations = [];

  const entries = convention.projects ?? [];
  const declaredConfigs = new Set([convention.solution, ...entries.map((entry) => entry.project)]);

  const projects = new Map();
  const declaredFiles = new Map();
  for (const entry of entries) {
    const configPath = join(root, entry.project);
    projects.set(configPath, readProject(ts, root, configPath));
    declaredFiles.set(entry.project, conventionMatches(ts, root, entry));
  }
  const solutionPath = join(root, convention.solution);
  projects.set(solutionPath, readProject(ts, root, solutionPath));
  loadReferenced(ts, root, projects);

  violations.push(...unlistedConfigViolations(root, declaredConfigs));
  violations.push(...referenceOrderViolations(root, convention, projects.get(solutionPath)));
  violations.push(...configDriftViolations(entries, projects, declaredFiles, root));
  violations.push(...fileViolations(root, entries, projects, declaredFiles));
  return violations;
}

/** Parse every configuration the loaded projects reach through their references, into `projects`. */
function loadReferenced(ts, packageDir, projects) {
  const pending = [...projects.values()].flatMap((project) => project.references);
  while (pending.length > 0) {
    const configPath = pending.pop();
    if (projects.has(configPath) || !existsSync(configPath)) continue;
    const project = readProject(ts, packageDir, configPath);
    projects.set(configPath, project);
    pending.push(...project.references);
  }
}

/** Report every compiler configuration the package holds that the convention does not name. */
function unlistedConfigViolations(root, declaredConfigs) {
  return configFiles(root)
    .filter((file) => !declaredConfigs.has(file))
    .map((file) => ({
      code: PartitionViolationCode.UnlistedConfig,
      config: file,
      message: `${file} is a compiler configuration that ${conventionFile} does not name`,
    }));
}

/** Report a solution file whose references are not the convention's projects, in its order. */
function referenceOrderViolations(root, convention, solution) {
  const expected = convention.projects.map((entry) => entry.project);
  const actual = solution.references.map((reference) => packagePath(root, reference));
  if (expected.length === actual.length && expected.every((name, index) => name === actual[index])) return [];
  return [
    {
      code: PartitionViolationCode.ConfigDrift,
      config: convention.solution,
      message: `${convention.solution} must reference ${expected.join(", ")} in that order, and references ${
        actual.join(", ") || "nothing"
      }`,
    },
  ];
}

/** Report every project whose configuration roots a different set of files than the convention derives. */
function configDriftViolations(entries, projects, declaredFiles, root) {
  const violations = [];
  for (const entry of entries) {
    const declared = declaredFiles.get(entry.project);
    const { roots } = projects.get(join(root, entry.project));
    for (const file of roots) {
      if (declared.has(file)) continue;
      const alsoRootedBy = entries
        .filter((other) => other !== entry && projects.get(join(root, other.project)).roots.has(file))
        .map((other) => other.project);
      violations.push(
        alsoRootedBy.length > 0
          ? {
              code: PartitionViolationCode.DoubleClaim,
              file,
              config: entry.project,
              message: `${entry.project} roots ${file}, which ${conventionFile} does not give it, and ${alsoRootedBy.join(", ")} roots it too`,
            }
          : {
              code: PartitionViolationCode.ConfigDrift,
              file,
              config: entry.project,
              message: `${entry.project} roots ${file}, which ${conventionFile} does not give it`,
            }
      );
    }
    for (const file of declared) {
      if (roots.has(file)) continue;
      violations.push({
        code: PartitionViolationCode.ConfigDrift,
        file,
        config: entry.project,
        message: `${conventionFile} gives ${file} to ${entry.project}, whose include and exclude leave it out`,
      });
    }
  }
  return violations;
}

/** Report every source file the convention leaves unclaimed or the language service misroutes. */
function fileViolations(root, entries, projects, declaredFiles) {
  const violations = [];
  for (const file of sourceFiles(root)) {
    const owner = entries.find((entry) => declaredFiles.get(entry.project).has(file));
    if (!owner) {
      violations.push({
        code: PartitionViolationCode.Orphaned,
        file,
        message: `${file} is claimed by no project in ${conventionFile}`,
      });
      continue;
    }
    const editor = editorProject(root, file, projects);
    if (editor !== owner.project) {
      violations.push({
        code: PartitionViolationCode.EditorDisagreement,
        file,
        config: owner.project,
        message: `${file} belongs to ${owner.project}, and the language service resolves it to ${editor}`,
      });
    }
  }
  return violations;
}

/** Render `violations` as one line each, for a check that failed. */
function formatViolations(violations) {
  return violations.map((violation) => `${violation.code}: ${violation.message}`).join("\n");
}

module.exports = { PartitionViolationCode, conventionFile, formatViolations, partitionViolations };

if (require.main === module) {
  const [dir] = process.argv.slice(2);
  if (!dir) {
    process.stderr.write("usage: node scripts/tsconfig-partition.js <dir>\n");
    process.exit(2);
  }
  const violations = partitionViolations(dir);
  if (violations.length > 0) {
    process.stderr.write(`${formatViolations(violations)}\n`);
    process.exit(1);
  }
}
