import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** Why a dependency package's build output cannot stand in for its sources. */
export const DistFreshnessCode = {
  /** The package builds an output group and none of that group is present. */
  DistMissing: "dist_missing",
  /** A source file of the package is newer than everything in one of its output groups. */
  DistStale: "dist_stale",
  /**
   * The step that writes a platform-specific implementation over the shared
   * module it implements did not complete: an output group still holds output
   * named for a platform-specific source, or a shared module was left as the
   * empty module a compiler emits for a declaration-only source.
   */
  DistHalfBuilt: "dist_half_built",
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
        .join("\n")}\nRebuild the packages named above, then run this build again.`
    );
    this.name = "StaleDependencyError";
  }
}

/** One thing a package builds: the script that builds it and what it leaves behind. */
interface BuildStep {
  /** npm script that produces the step's outputs. */
  readonly script: string;
  /** Paths, relative to the package, the script must leave behind. */
  readonly outputs: readonly string[];
}

/** How a package declares what it builds, in its manifest's `wendooBuild` field. */
interface BuildDeclaration extends Partial<BuildStep> {
  /** Output groups built only when a package in the graph names them in {@link needs}. */
  readonly variants?: Readonly<Record<string, BuildStep>>;
  /** Variant names this package consumes from the packages it depends on. */
  readonly needs?: readonly string[];
}

/** The shape read out of a package manifest. */
interface PackageManifest {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly wendooBuild?: BuildDeclaration;
}

/** Prefix of a dependency specifier naming a package by its location on disk. */
const localSpecifier = "file:";

/** Suffix of a source file that no package emits build output for. */
const specSuffix = ".spec.ts";

/** Suffix of a source file holding declarations only. */
const declarationSuffix = ".d.ts";

/** Suffix of a source file a compiler emits build output for. */
const sourceSuffix = ".ts";

/** Directory a package keeps its sources in. */
const sourceDirName = "src";

/** Directory a package keeps the scripts its build runs in. */
const scriptDirName = "scripts";

/** Prefix of a compiler configuration a package carries beside its manifest. */
const compilerConfigPrefix = "tsconfig";

/** Suffix of a compiler configuration a package carries beside its manifest. */
const compilerConfigSuffix = ".json";

/** Directory a package emits its build output to. */
const distDirName = "dist";

/** Read the manifest of the package at `packageDir`. Throws when it is absent or unparsable. */
function readManifest(packageDir: string): PackageManifest {
  return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as PackageManifest;
}

/**
 * Every package directory reachable from `packageDir` through `file:`
 * dependencies, runtime and dev alike, transitively, excluding `packageDir`
 * itself. These are the packages whose build output a build started here
 * consumes.
 */
function localDependencyDirs(packageDir: string): string[] {
  const found: string[] = [];
  const visited = new Set<string>();

  const walk = (dir: string, isRoot: boolean): void => {
    const resolved = resolve(dir);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    if (!isRoot) found.push(resolved);

    const manifest = readManifest(resolved);
    for (const specifier of Object.values({ ...manifest.dependencies, ...manifest.devDependencies })) {
      if (!specifier.startsWith(localSpecifier)) continue;
      const dependencyDir = resolve(resolved, specifier.slice(localSpecifier.length));
      if (existsSync(join(dependencyDir, "package.json"))) walk(dependencyDir, false);
    }
  };

  walk(packageDir, true);
  return found;
}

/**
 * Directory of the package named `packageName` that `packageDir` reaches
 * through `file:` dependencies, runtime and dev alike, transitively;
 * `undefined` when nothing it reaches declares that name.
 *
 * @param packageDir Absolute path of the package to search from.
 * @param packageName Name the sought package declares for itself.
 */
export function localDependencyDir(packageDir: string, packageName: string): string | undefined {
  return localDependencyDirs(packageDir).find((dir) => readManifest(dir).name === packageName);
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

/** The newest compiler configuration beside the manifest in `packageDir`. */
function newestCompilerConfig(packageDir: string): { path: string; mtimeMs: number } | undefined {
  let newest: { path: string; mtimeMs: number } | undefined;
  for (const entry of readdirSync(packageDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(compilerConfigPrefix) || !entry.name.endsWith(compilerConfigSuffix)) continue;
    const path = join(packageDir, entry.name);
    newest = later(newest, { path, mtimeMs: statSync(path).mtimeMs });
  }
  return newest;
}

/**
 * The newest build input of the package at `packageDir`, the moment its output
 * must be no older than. A build input is any of: a source file under `src`
 * that is not a spec, a `tsconfig*.json` beside the manifest, or a file under
 * the `scripts` directory the package keeps its build scripts in.
 */
function newestBuildInput(packageDir: string): { path: string; mtimeMs: number } | undefined {
  const sourceDir = join(packageDir, sourceDirName);
  const scriptDir = join(packageDir, scriptDirName);
  const sources = existsSync(sourceDir) ? newestFile(sourceDir, (path) => !path.endsWith(specSuffix)) : undefined;
  const scripts = existsSync(scriptDir) ? newestFile(scriptDir, () => true) : undefined;
  return later(later(sources, scripts), newestCompilerConfig(packageDir));
}

/**
 * Stems of the platform-specific implementations under `directory` and below,
 * each in the `<module>.<platform>` form its file name carries. A source file is
 * one when a `<module>.ts` sits beside it declaring the module both build
 * targets share.
 */
function platformImplementationStems(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const siblings = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const stems: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      stems.push(...platformImplementationStems(join(directory, entry.name)));
      continue;
    }
    const { name } = entry;
    if (!entry.isFile() || !name.endsWith(sourceSuffix)) continue;
    if (name.endsWith(specSuffix) || name.endsWith(declarationSuffix)) continue;
    const stem = name.slice(0, -sourceSuffix.length);
    const platformStart = stem.lastIndexOf(".");
    if (platformStart <= 0) continue;
    if (siblings.has(`${stem.slice(0, platformStart)}${sourceSuffix}`)) stems.push(stem);
  }

  return stems;
}

/** Every file under `directory` and below, keyed by file name, valued by full path. */
function outputsByName(directory: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [name, paths] of outputsByName(path)) found.set(name, [...(found.get(name) ?? []), ...paths]);
    } else if (entry.isFile()) {
      found.set(entry.name, [...(found.get(entry.name) ?? []), path]);
    }
  }
  return found;
}

/** Statements a compiler emits to mark a module whose source defines nothing. */
const emptyModuleMarkers = [
  '"use strict";',
  'Object.defineProperty(exports, "__esModule", { value: true });',
  "export {};",
];

/** `text` with every whitespace run removed. */
function withoutWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

/**
 * Whether `source` defines nothing once its comments, whitespace, and module
 * markers are removed.
 *
 * @param source Contents of an emitted JavaScript module.
 */
function definesNothing(source: string): boolean {
  let rest = withoutWhitespace(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""));
  for (const marker of emptyModuleMarkers) rest = rest.split(withoutWhitespace(marker)).join("");
  return rest.length === 0;
}

/** A Luau module that returns no value, once comments and whitespace are removed. */
const emptyLuauModule = "returnnil";

/**
 * A Luau module holding one empty container table, once comments and whitespace
 * are removed. A namespace whose every member is declared elsewhere compiles to
 * this.
 */
const emptyLuauContainer = /^local(\w+)={}dolocal_container=\1endreturn{\1=\1,?}$/;

/**
 * Whether `source` defines nothing once its comments and whitespace are
 * removed.
 *
 * @param source Contents of an emitted Luau module.
 */
function definesNothingLuau(source: string): boolean {
  const rest = withoutWhitespace(source.replace(/--\[\[[\s\S]*?\]\]/g, "").replace(/--[^\n]*/g, ""));
  return rest === emptyLuauModule || emptyLuauContainer.test(rest);
}

/** Extensions of build output a shared module's implementation is judged in, and how. */
const stubDetectors: ReadonlyArray<{ suffix: string; definesNothing: (source: string) => boolean }> = [
  { suffix: ".js", definesNothing },
  { suffix: ".luau", definesNothing: definesNothingLuau },
];

/**
 * Build output named for a shared module in `stems` that defines nothing, as
 * paths relative to `dependencyDir`, sorted. These are the modules whose
 * platform-specific implementation was never written over them.
 *
 * @param dependencyDir Absolute path of the package the output belongs to.
 * @param emitted Build output of the package, keyed by file name.
 * @param stems Platform-specific implementation stems, each `<module>.<platform>`.
 */
function unsubstitutedOutputs(
  dependencyDir: string,
  emitted: Map<string, string[]>,
  stems: readonly string[]
): string[] {
  const sharedModules = new Set(stems.map((stem) => stem.slice(0, stem.lastIndexOf("."))));
  const found: string[] = [];
  for (const module of sharedModules) {
    for (const detector of stubDetectors) {
      for (const path of emitted.get(`${module}${detector.suffix}`) ?? []) {
        if (detector.definesNothing(readFileSync(path, "utf8"))) found.push(relative(dependencyDir, path));
      }
    }
  }
  return found.sort();
}

/** The npm script that rebuilds `manifest`, or `undefined` when it declares none. */
function buildScript(manifest: PackageManifest): string | undefined {
  const scripts = manifest.scripts ?? {};
  if (scripts["build:prod"]) return "build:prod";
  if (scripts.build) return "build";
  return undefined;
}

/** The variants declared by `manifest`, keyed by name. */
function declaredVariants(manifest: PackageManifest): Readonly<Record<string, BuildStep>> {
  return manifest.wendooBuild?.variants ?? {};
}

/**
 * The output groups a build of `manifest` produces for a graph that needs
 * `needed`: its default group, then each variant it declares that `needed`
 * names. A package that declares nothing builds its build script into `dist`.
 * Empty when the package builds nothing.
 */
function buildSteps(manifest: PackageManifest, needed: ReadonlySet<string>): BuildStep[] {
  const declaration = manifest.wendooBuild;
  const script = declaration?.script ?? buildScript(manifest);
  if (script === undefined) return [];
  const steps: BuildStep[] = [{ script, outputs: declaration?.outputs ?? [distDirName] }];
  for (const [name, variant] of Object.entries(declaredVariants(manifest))) {
    if (needed.has(name)) steps.push(variant);
  }
  return steps;
}

/** Every build output under the existing directories among `dirs`, keyed by file name. */
function outputsUnder(dirs: readonly string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const [name, paths] of outputsByName(dir)) found.set(name, [...(found.get(name) ?? []), ...paths]);
  }
  return found;
}

/** Everything one dependency is judged against, shared by every output group of it. */
interface Subject {
  readonly packageDir: string;
  readonly dependencyDir: string;
  readonly packageName: string;
  /** Newest build input of the dependency, the moment its output must be no older than. */
  readonly newestInput: { path: string; mtimeMs: number };
  /** Platform-specific implementation stems of the dependency, each `<module>.<platform>`. */
  readonly stems: readonly string[];
}

/** Whether one output group of `subject` reflects its sources, as a finding or `undefined`. */
function stepStaleness(subject: Subject, step: BuildStep): StaleDependency | undefined {
  const { packageDir, dependencyDir, packageName, newestInput, stems } = subject;
  const rebuild = `npm run ${step.script} --prefix ${relative(packageDir, dependencyDir)}`;
  const outputDirs = step.outputs.map((output) => join(dependencyDir, output));

  const built = outputDirs
    .filter((dir) => existsSync(dir))
    .map((dir) => newestFile(dir, () => true))
    .reduce<{ path: string; mtimeMs: number } | undefined>(later, undefined);
  if (built === undefined) {
    return {
      code: DistFreshnessCode.DistMissing,
      packageName,
      rebuild,
      detail: `${step.outputs.map((output) => relative(packageDir, join(dependencyDir, output))).join(", ")} holds no build output`,
    };
  }

  const emitted = outputsUnder(outputDirs);
  const leftBehind = stems.filter((stem) => [...emitted.keys()].some((name) => name.startsWith(`${stem}.`))).sort();
  if (leftBehind.length > 0) {
    return {
      code: DistFreshnessCode.DistHalfBuilt,
      packageName,
      rebuild,
      detail:
        `${relative(packageDir, dependencyDir)} still holds output named ${leftBehind.join(", ")}, ` +
        `which a complete build renames over the module it implements`,
    };
  }
  const unsubstituted = unsubstitutedOutputs(dependencyDir, emitted, stems);
  if (unsubstituted.length > 0) {
    return {
      code: DistFreshnessCode.DistHalfBuilt,
      packageName,
      rebuild,
      detail:
        `${relative(packageDir, dependencyDir)} emitted ${unsubstituted.join(", ")} defining nothing, ` +
        `and a complete build writes a platform-specific implementation over each`,
    };
  }

  if (built === undefined || newestInput.mtimeMs <= built.mtimeMs) return undefined;
  const lastBuilt = built;
  return {
    code: DistFreshnessCode.DistStale,
    packageName,
    rebuild,
    detail:
      `${relative(dependencyDir, newestInput.path)} was edited after the package was last built ` +
      `(${relative(dependencyDir, lastBuilt.path)})`,
  };
}

/** Whether `dependencyDir`'s build output reflects its sources, as a finding or `undefined`. */
function staleness(
  packageDir: string,
  dependencyDir: string,
  needed: ReadonlySet<string>
): StaleDependency | undefined {
  const manifest = readManifest(dependencyDir);
  const sourceDir = join(dependencyDir, sourceDirName);
  const steps = buildSteps(manifest, needed);
  if (steps.length === 0 || !existsSync(sourceDir)) return undefined;

  const newestInput = newestBuildInput(dependencyDir);
  if (newestInput === undefined) return undefined;

  const subject: Subject = {
    packageDir,
    dependencyDir,
    packageName: manifest.name ?? relative(packageDir, dependencyDir),
    newestInput,
    stems: platformImplementationStems(sourceDir),
  };

  for (const step of steps) {
    const finding = stepStaleness(subject, step);
    if (finding) return finding;
  }
  return undefined;
}

/**
 * The variant names the package at `packageDir` and the packages it reaches
 * name in `wendooBuild.needs`. These are the output groups a build started
 * here consumes on top of every dependency's default group.
 */
function neededVariants(packageDir: string): Set<string> {
  const names = new Set<string>();
  for (const dir of [packageDir, ...localDependencyDirs(packageDir)]) {
    for (const name of readManifest(dir).wendooBuild?.needs ?? []) names.add(name);
  }
  return names;
}

/**
 * Every `file:` dependency of the package at `packageDir`, runtime and dev
 * alike, transitively, whose build output does not reflect its build inputs: no
 * output at all, output left under a platform-specific source's name, a shared
 * platform module emitted as a script defining nothing, or a build input edited
 * after the package was last built. A build input is any of: a file under `src`
 * that does not end in `.spec.ts`, a `tsconfig*.json` beside the manifest, or a
 * file under the package's `scripts` directory. Each
 * dependency is judged over the output groups a build started at `packageDir`
 * consumes -- its default group, plus every variant named in the
 * `wendooBuild.needs` of `packageDir` or anything it reaches -- so a group
 * nothing in this graph consumes is not compared. A package that builds one
 * group was last built at the newest of that output and its incremental-build
 * records, so a build that re-emits nothing still counts. A dependency that
 * declares no build script or keeps no `src` directory is not checked.
 *
 * @param packageDir Absolute path of the package whose bundle is about to be built.
 */
export function staleDependencyDists(packageDir: string): StaleDependency[] {
  const needed = neededVariants(packageDir);
  const stale: StaleDependency[] = [];
  for (const dependencyDir of localDependencyDirs(packageDir)) {
    const finding = staleness(packageDir, dependencyDir, needed);
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
