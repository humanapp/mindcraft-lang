import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** Why a dependency package's build output cannot stand in for its sources. */
export const DistFreshnessCode = {
  /** The package builds a `dist` and none is present. */
  DistMissing: "dist_missing",
  /** A source file of the package is newer than everything in its `dist`. */
  DistStale: "dist_stale",
} as const;

/** Why a dependency package's build output cannot stand in for its sources. */
export type DistFreshnessCode = (typeof DistFreshnessCode)[keyof typeof DistFreshnessCode];

/** One dependency package whose `dist` does not reflect its sources. */
export interface StaleDependency {
  readonly code: DistFreshnessCode;
  /** Name the package declares for itself. */
  readonly packageName: string;
  /** The command that rebuilds it, run from the package the check started at. */
  readonly rebuild: string;
  /** Human-readable context; the code is the contract. */
  readonly detail: string;
}

/**
 * A build refused because one or more dependency packages would have been
 * bundled from a `dist` that does not reflect their sources. Carries one
 * {@link StaleDependency} per offending package; each names the command that
 * rebuilds it.
 */
export class StaleDependencyError extends Error {
  constructor(readonly stale: readonly StaleDependency[]) {
    super(
      `${stale.length} dependency package(s) would be bundled from a stale dist:\n${stale
        .map((entry) => `  ${entry.code} (${entry.packageName}): ${entry.detail}\n    rebuild: ${entry.rebuild}`)
        .join("\n")}`
    );
    this.name = "StaleDependencyError";
  }
}

/** The shape read out of a package manifest. */
interface PackageManifest {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly scripts?: Readonly<Record<string, string>>;
}

/** Prefix of a dependency specifier naming a package by its location on disk. */
const localSpecifier = "file:";

/** Suffix of a source file that no package emits build output for. */
const specSuffix = ".spec.ts";

/** Directory a package keeps its sources in. */
const sourceDirName = "src";

/** Directory a package emits its build output to. */
const distDirName = "dist";

/**
 * Suffix of the incremental-build record a compiler writes beside a package's
 * manifest. A build that finds every output already correct rewrites this
 * record and re-emits nothing, so it is the moment a package was last built.
 */
const buildRecordSuffix = ".tsbuildinfo";

/** Read the manifest of the package at `packageDir`. Throws when it is absent or unparsable. */
function readManifest(packageDir: string): PackageManifest {
  return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as PackageManifest;
}

/**
 * Every package directory reachable from `packageDir` through `file:` runtime
 * dependencies, transitively, excluding `packageDir` itself. These are the
 * packages whose build output an artifact built here can carry.
 */
function localDependencyDirs(packageDir: string): string[] {
  const found: string[] = [];
  const visited = new Set<string>();

  const walk = (dir: string, isRoot: boolean): void => {
    const resolved = resolve(dir);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    if (!isRoot) found.push(resolved);

    for (const [, specifier] of Object.entries(readManifest(resolved).dependencies ?? {})) {
      if (!specifier.startsWith(localSpecifier)) continue;
      const dependencyDir = resolve(resolved, specifier.slice(localSpecifier.length));
      if (existsSync(join(dependencyDir, "package.json"))) walk(dependencyDir, false);
    }
  };

  walk(packageDir, true);
  return found;
}

/** The file under `directory` with the newest modification time, and that time. */
function newestFile(
  directory: string,
  accept: (path: string) => boolean
): { path: string; mtimeMs: number } | undefined {
  let newest: { path: string; mtimeMs: number } | undefined;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const inside = newestFile(path, accept);
      if (inside && (!newest || inside.mtimeMs > newest.mtimeMs)) newest = inside;
    } else if (entry.isFile() && accept(path)) {
      const { mtimeMs } = statSync(path);
      if (!newest || mtimeMs > newest.mtimeMs) newest = { path, mtimeMs };
    }
  }
  return newest;
}

/** The later of two moments, either of which may be absent. */
function later(
  a: { path: string; mtimeMs: number } | undefined,
  b: { path: string; mtimeMs: number } | undefined
): { path: string; mtimeMs: number } | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a.mtimeMs > b.mtimeMs ? a : b;
}

/** The newest incremental-build record beside `packageDir`'s manifest, if it keeps one. */
function newestBuildRecord(packageDir: string): { path: string; mtimeMs: number } | undefined {
  let newest: { path: string; mtimeMs: number } | undefined;
  for (const entry of readdirSync(packageDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(buildRecordSuffix)) continue;
    const path = join(packageDir, entry.name);
    newest = later(newest, { path, mtimeMs: statSync(path).mtimeMs });
  }
  return newest;
}

/** The npm script that rebuilds `manifest`, or `undefined` when it declares none. */
function buildScript(manifest: PackageManifest): string | undefined {
  const scripts = manifest.scripts ?? {};
  if (scripts["build:prod"]) return "build:prod";
  if (scripts.build) return "build";
  return undefined;
}

/** Whether `dependencyDir`'s `dist` reflects its sources, as a finding or `undefined`. */
function staleness(packageDir: string, dependencyDir: string): StaleDependency | undefined {
  const manifest = readManifest(dependencyDir);
  const script = buildScript(manifest);
  const sourceDir = join(dependencyDir, sourceDirName);
  if (script === undefined || !existsSync(sourceDir)) return undefined;

  const packageName = manifest.name ?? relative(packageDir, dependencyDir);
  const rebuild = `npm run ${script} --prefix ${relative(packageDir, dependencyDir)}`;
  const newestSource = newestFile(sourceDir, (path) => !path.endsWith(specSuffix));
  if (newestSource === undefined) return undefined;

  const distDir = join(dependencyDir, distDirName);
  const built = existsSync(distDir) ? newestFile(distDir, () => true) : undefined;
  if (built === undefined) {
    return {
      code: DistFreshnessCode.DistMissing,
      packageName,
      rebuild,
      detail: `${relative(packageDir, distDir)} holds no build output`,
    };
  }
  const lastBuilt = later(built, newestBuildRecord(dependencyDir));
  if (lastBuilt === undefined || newestSource.mtimeMs <= lastBuilt.mtimeMs) return undefined;
  return {
    code: DistFreshnessCode.DistStale,
    packageName,
    rebuild,
    detail:
      `${relative(dependencyDir, newestSource.path)} was edited after the package was last built ` +
      `(${relative(dependencyDir, lastBuilt.path)})`,
  };
}

/**
 * Every `file:` runtime dependency of the package at `packageDir`, transitively,
 * whose `dist` does not reflect its `src`: either no build output at all, or a
 * source file edited after the package was last built. A package was last built
 * at the newest of its build output and its incremental-build records, so a
 * build that re-emits nothing still counts. Source files ending in `.spec.ts`
 * are not build inputs and are not compared. A dependency that declares no build
 * script or keeps no `src` directory is not checked.
 *
 * @param packageDir Absolute path of the package whose bundle is about to be built.
 */
export function staleDependencyDists(packageDir: string): StaleDependency[] {
  const stale: StaleDependency[] = [];
  for (const dependencyDir of localDependencyDirs(packageDir)) {
    const finding = staleness(packageDir, dependencyDir);
    if (finding) stale.push(finding);
  }
  return stale.sort((a, b) => (a.packageName < b.packageName ? -1 : 1));
}

/**
 * Refuse to bundle when any package {@link staleDependencyDists} reports would
 * contribute a `dist` that does not reflect its sources. Call this before
 * building an artifact that carries dependency build output. Throws
 * {@link StaleDependencyError} naming every offending package and the command
 * that rebuilds it.
 *
 * @param packageDir Absolute path of the package whose bundle is about to be built.
 */
export function assertDependencyDistsFresh(packageDir: string): void {
  const stale = staleDependencyDists(packageDir);
  if (stale.length > 0) throw new StaleDependencyError(stale);
}
