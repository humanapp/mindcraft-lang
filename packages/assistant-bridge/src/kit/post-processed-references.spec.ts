import assert from "node:assert/strict";
import type { Dirent } from "node:fs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** package.json field a local package declares its build interface in. */
const buildField = "wendooBuild";

/** Directory names never walked: build output, installed packages, and tool state. */
function skipped(name: string): boolean {
  return name === "node_modules" || name === "dist" || name.startsWith(".");
}

/** Whether `path` is `directory` itself or sits below it. */
function isWithin(directory: string, path: string): boolean {
  const step = relative(directory, path);
  return step === "" || (!step.startsWith("..") && !step.startsWith(sep));
}

/** Root of the platform repository this spec file belongs to. */
const platformRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * The repository that checks the platform out as a submodule, or `undefined`
 * when the platform is the working root.
 */
function enclosingRepository(): string | undefined {
  let dir = resolve(platformRoot, "..");
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Repository roots this spec walks: the platform, and the repository holding it. */
const roots = [platformRoot, enclosingRepository()].filter((root): root is string => root !== undefined);

/** Every path under `roots` whose base name satisfies `accept`, each directory entered once. */
function filesUnderRoots(accept: (name: string) => boolean): string[] {
  const found: string[] = [];
  const entered = new Set<string>();
  const walk = (dir: string): void => {
    if (entered.has(dir)) return;
    entered.add(dir);
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skipped(entry.name)) walk(join(dir, entry.name));
      } else if (entry.isFile() && accept(entry.name)) {
        found.push(join(dir, entry.name));
      }
    }
  };
  for (const root of roots) walk(root);
  return found;
}

/** Package directories under `roots` whose build output is more than a bare compiler emit. */
function postProcessedPackageDirs(): string[] {
  const dirs: string[] = [];
  for (const manifestPath of filesUnderRoots((name) => name === "package.json")) {
    let declaration: unknown;
    try {
      declaration = (JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>)[buildField];
    } catch {
      continue;
    }
    if (typeof declaration !== "object" || declaration === null) continue;
    if ((declaration as { postProcessed?: unknown }).postProcessed === true) dirs.push(dirname(manifestPath));
  }
  return dirs;
}

/** Compiler-configuration files under `roots`. */
function configPaths(): string[] {
  return filesUnderRoots((name) => name.startsWith("tsconfig") && name.endsWith(".json"));
}

/**
 * The projects `configPath` references, as absolute paths to the referenced
 * configuration file. A reference naming a directory means that directory's
 * `tsconfig.json`.
 */
function referencedProjects(configPath: string): string[] {
  const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, "utf8"));
  const references = (parsed.config as { references?: unknown })?.references;
  if (!Array.isArray(references)) return [];
  const projects: string[] = [];
  for (const reference of references) {
    const path = (reference as { path?: unknown }).path;
    if (typeof path !== "string") continue;
    const target = resolve(dirname(configPath), path);
    projects.push(target.endsWith(".json") ? target : join(target, "tsconfig.json"));
  }
  return projects;
}

/** One reference reaching into a post-processed package from outside it. */
interface Reach {
  readonly from: string;
  readonly to: string;
  readonly packageDir: string;
}

/** Every reference under `roots` that reaches into a post-processed package from outside it. */
function reachesIntoPostProcessed(): Reach[] {
  const packageDirs = postProcessedPackageDirs();
  const found: Reach[] = [];
  for (const configPath of configPaths()) {
    for (const project of referencedProjects(configPath)) {
      for (const packageDir of packageDirs) {
        if (!isWithin(packageDir, project)) continue;
        if (isWithin(packageDir, configPath)) continue;
        found.push({ from: configPath, to: project, packageDir });
      }
    }
  }
  return found;
}

describe("post-processed package references", () => {
  test("at least one package declares itself post-processed", () => {
    assert.ok(postProcessedPackageDirs().length > 0);
  });

  test("no project outside a post-processed package references a project inside it", () => {
    const reaches = reachesIntoPostProcessed();
    const detail = reaches
      .map((reach) => `  ${relative(platformRoot, reach.from)} -> ${relative(platformRoot, reach.to)}`)
      .join("\n");
    assert.deepEqual(reaches, [], `references reaching into a post-processed package:\n${detail}`);
  });
});
