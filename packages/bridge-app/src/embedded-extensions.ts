import { MINDCRAFT_JSON_PATH, parseExtensionReference, parseProjectContentManifest } from "@mindcraft-lang/app-host";
import type { DependencyMount, ProjectDependency } from "@mindcraft-lang/ts-compiler";

/** An extensions list keyed by `<owner>/<repo>` coordinate; each value is an extension reference string. */
type ExtensionsMap = Readonly<Record<string, string>>;

/** One source file of an embedded extension, at its extension-relative path. */
export interface EmbeddedExtensionFile {
  /** Extension-relative path (e.g. `index.ts`). */
  path: string;
  /** Full file content. */
  content: string;
}

/**
 * One entry of a host application's embed record: an extension whose content is
 * bundled with the application, identified by its canonical `<owner>/<repo>`
 * coordinate.
 */
export interface EmbeddedExtension {
  /**
   * Canonical `<owner>/<repo>` coordinate identifying this extension: its
   * identity, its compiler namespace, and the name it is imported and stored
   * under. An `embedded:<repo>` manifest reference resolves to the embed entry
   * whose coordinate's repository segment matches.
   */
  canonicalOrigin: string;
  /** The extension's source files, delivered as a read-only dependency mount. */
  files: readonly EmbeddedExtensionFile[];
}

/** The kind of conflict a resolution warning reports. */
export type ExtensionResolutionWarningKind =
  /** The same origin was required at two different versions; the higher was selected. */
  | "version-conflict"
  /** The same origin was required at one version through two different references; the reference nearest the host project was selected. */
  | "reference-tiebreak";

/**
 * A non-fatal conflict encountered while resolving a project's extension
 * dependency graph. The selected origin is always resolvable; warnings are
 * returned on the resolution result.
 */
export interface ExtensionResolutionWarning {
  /** Discriminates the kind of conflict. */
  readonly kind: ExtensionResolutionWarningKind;
  /** The origin the conflict was resolved for. */
  readonly origin: string;
  /** The reference string selected for this origin. */
  readonly selectedReference: string;
  /** The reference string that lost the conflict. */
  readonly rejectedReference: string;
  /** For a version conflict, the selected version; absent for a reference tie-break. */
  readonly selectedVersion?: string;
  /** For a version conflict, the rejected version; absent for a reference tie-break. */
  readonly rejectedVersion?: string;
  /** Human-readable summary naming both requesters. */
  readonly message: string;
}

/**
 * A dependency cycle in a project's extension graph. Resolution fails with this
 * error; the graph names the origins on the cycle in traversal order.
 */
export class ExtensionResolutionCycleError extends Error {
  /** The origins on the cycle, in the order traversed, with the first origin repeated at the end. */
  readonly cycle: readonly string[];
  constructor(cycle: readonly string[]) {
    super(`Extension dependency cycle: ${cycle.join(" -> ")}`);
    this.name = "ExtensionResolutionCycleError";
    this.cycle = cycle;
  }
}

/** Compiler inputs resolved from a project's extensions list and a host embed record. */
export interface ResolvedExtensions {
  /** Each direct dependency's `<owner>/<repo>` coordinate, resolving its `@ext/<owner>/<repo>` imports. */
  dependencies: readonly ProjectDependency[];
  /**
   * Read-only content of every origin in the transitive dependency closure,
   * one mount per origin, each carrying its own extensions list so nested
   * `@ext/<owner>/<repo>` imports resolve against the correct origin.
   */
  dependencyMounts: readonly DependencyMount[];
  /** Non-fatal conflicts encountered during resolution, in encounter order. */
  warnings: readonly ExtensionResolutionWarning[];
}

/**
 * A candidate for one origin in the transitive closure: its content, its own
 * extensions list, its declared version, the reference that reached it, and the
 * distance from the host project at which it was first reached.
 */
interface OriginCandidate {
  origin: string;
  version: string;
  reference: string;
  depth: number;
  files: ReadonlyMap<string, string>;
  extensions: ExtensionsMap;
}

const ZERO_VERSION = "0.0.0";

/** Compare two semver strings by their release triple; a higher triple compares greater. */
function compareSemver(a: string, b: string): number {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (Number.isNaN(va) || Number.isNaN(vb) || va !== vb) {
      return (Number.isNaN(va) ? 0 : va) - (Number.isNaN(vb) ? 0 : vb);
    }
  }
  return 0;
}

/** Build the origin-relative file map for an embedded extension, with leading-slash paths. */
function embeddedFiles(extension: EmbeddedExtension): Map<string, string> {
  const files = new Map<string, string>();
  for (const file of extension.files) {
    files.set(file.path.startsWith("/") ? file.path : `/${file.path}`, file.content);
  }
  return files;
}

/**
 * Read an extension's own version and extensions list from the `mindcraft.json`
 * carried in its content. An extension without a manifest, or with an
 * unparseable one, contributes no dependencies and compares as `0.0.0`.
 */
function readOwnManifest(files: ReadonlyMap<string, string>): {
  version: string;
  extensions: ExtensionsMap;
} {
  const manifestContent = files.get(`/${MINDCRAFT_JSON_PATH}`) ?? files.get(MINDCRAFT_JSON_PATH);
  if (manifestContent === undefined) {
    return { version: ZERO_VERSION, extensions: {} };
  }
  const parsed = parseProjectContentManifest(manifestContent);
  if (!parsed.ok) {
    return { version: ZERO_VERSION, extensions: {} };
  }
  return { version: parsed.manifest.version, extensions: parsed.manifest.extensions };
}

/** Resolve one embedded reference string against the embed record into an origin candidate at the given depth. */
function embeddedCandidate(
  reference: string,
  depth: number,
  byRepoSegment: ReadonlyMap<string, EmbeddedExtension>
): OriginCandidate | undefined {
  const parsed = parseExtensionReference(reference);
  if (parsed === undefined || parsed.transport !== "embedded") {
    return undefined;
  }
  const extension = byRepoSegment.get(parsed.slug);
  if (extension === undefined) {
    return undefined;
  }
  const files = embeddedFiles(extension);
  const own = readOwnManifest(files);
  return {
    origin: extension.canonicalOrigin,
    version: own.version,
    reference,
    depth,
    files,
    extensions: own.extensions,
  };
}

/** A resolved origin: the winning candidate plus the coordinates its own imports resolve through. */
interface ResolvedOrigin {
  candidate: OriginCandidate;
  /** This origin's own dependency coordinates, resolving its `@ext/<owner>/<repo>` imports. */
  dependencies: ProjectDependency[];
}

/** The repository segment (`<repo>`) of an `<owner>/<repo>` coordinate, used to match `embedded:<repo>` references. */
function repoSegmentOf(coordinate: string): string {
  const slash = coordinate.indexOf("/");
  return slash < 0 ? coordinate : coordinate.slice(slash + 1);
}

/**
 * Resolve a project's extensions list against a host application's embed record
 * into compiler dependency inputs. Resolution is transitive: an extension's own
 * `mindcraft.json` extensions resolve recursively. Each origin appears once in
 * the closure regardless of how many dependents reference it, so references to
 * an origin's published types across a diamond unify on one registration.
 *
 * When the same origin is required at two different versions, the higher
 * semantic version is selected and a `version-conflict` warning names both
 * requesters; when the versions are equal but the references differ, the
 * reference nearest the host project wins and a `reference-tiebreak` warning is
 * emitted. References of non-embedded transports and embedded references
 * naming no bundled extension are skipped; an unresolved import surfaces later
 * as an ordinary compiler diagnostic.
 *
 * @throws {ExtensionResolutionCycleError} when the extension graph contains a
 *   dependency cycle.
 */
export function resolveEmbeddedExtensions(
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[]
): ResolvedExtensions {
  if (!extensions) {
    return { dependencies: [], dependencyMounts: [], warnings: [] };
  }
  const byRepoSegment = new Map(embedRecord.map((extension) => [repoSegmentOf(extension.canonicalOrigin), extension]));
  const warnings: ExtensionResolutionWarning[] = [];

  // The project's direct dependencies: each dependency's `<owner>/<repo>`
  // coordinate, which its reference resolves to. The coordinate is derived
  // from identity, never from the manifest key. Unresolved references are
  // skipped.
  const directDependencies: ProjectDependency[] = [];
  const rootCandidates: OriginCandidate[] = [];
  for (const reference of Object.values(extensions)) {
    const candidate = embeddedCandidate(reference, 0, byRepoSegment);
    if (candidate === undefined) {
      continue;
    }
    directDependencies.push({ coordinate: candidate.origin });
    rootCandidates.push(candidate);
  }

  const resolved = new Map<string, ResolvedOrigin>();

  /** Unify a candidate into the resolved set, selecting the winner and recording any conflict warning. */
  const unify = (candidate: OriginCandidate): void => {
    const existing = resolved.get(candidate.origin);
    if (existing === undefined) {
      resolved.set(candidate.origin, { candidate, dependencies: [] });
      return;
    }
    const versionOrder = compareSemver(candidate.version, existing.candidate.version);
    if (versionOrder > 0) {
      warnings.push(versionConflict(candidate, existing.candidate));
      resolved.set(candidate.origin, { candidate, dependencies: existing.dependencies });
    } else if (versionOrder < 0) {
      warnings.push(versionConflict(existing.candidate, candidate));
    } else if (candidate.reference !== existing.candidate.reference) {
      // Equal versions, different references: the reference nearest the host
      // project wins. A strictly-shallower newcomer replaces the incumbent.
      const winner = candidate.depth < existing.candidate.depth ? candidate : existing.candidate;
      const loser = winner === candidate ? existing.candidate : candidate;
      warnings.push(referenceTiebreak(winner, loser));
      if (winner === candidate) {
        resolved.set(candidate.origin, { candidate, dependencies: existing.dependencies });
      }
    }
  };

  // Breadth-first: an origin's shallower reference unifies before any deeper
  // reference to the same origin. The nearest-the-root tie-break reads this order.
  for (const candidate of rootCandidates) {
    unify(candidate);
  }
  const queue: OriginCandidate[] = [...rootCandidates];
  const expanded = new Set<string>();
  while (queue.length > 0) {
    const candidate = queue.shift()!;
    const winner = resolved.get(candidate.origin)!;
    // Expand an origin's own dependencies once, off its winning candidate.
    if (winner.candidate === candidate && !expanded.has(candidate.origin)) {
      expanded.add(candidate.origin);
      for (const reference of Object.values(candidate.extensions)) {
        const child = embeddedCandidate(reference, candidate.depth + 1, byRepoSegment);
        if (child === undefined) {
          continue;
        }
        winner.dependencies.push({ coordinate: child.origin });
        unify(child);
        queue.push(child);
      }
    }
  }

  detectCycle(directDependencies, resolved);

  const dependencyMounts: DependencyMount[] = [];
  for (const { candidate, dependencies } of resolved.values()) {
    dependencyMounts.push({
      namespace: candidate.origin,
      files: candidate.files,
      dependencies,
    });
  }

  return { dependencies: directDependencies, dependencyMounts, warnings };
}

/** Build a version-conflict warning where `winner` was selected over `loser`. */
function versionConflict(winner: OriginCandidate, loser: OriginCandidate): ExtensionResolutionWarning {
  return {
    kind: "version-conflict",
    origin: winner.origin,
    selectedReference: winner.reference,
    rejectedReference: loser.reference,
    selectedVersion: winner.version,
    rejectedVersion: loser.version,
    message:
      `Extension "${winner.origin}" is required at ${winner.version} (via "${winner.reference}") ` +
      `and ${loser.version} (via "${loser.reference}"); selecting ${winner.version}.`,
  };
}

/** Build a reference tie-break warning where `winner` was selected over `loser` at an equal version. */
function referenceTiebreak(winner: OriginCandidate, loser: OriginCandidate): ExtensionResolutionWarning {
  return {
    kind: "reference-tiebreak",
    origin: winner.origin,
    selectedReference: winner.reference,
    rejectedReference: loser.reference,
    message:
      `Extension "${winner.origin}" is required at ${winner.version} through two references ` +
      `("${winner.reference}" and "${loser.reference}"); selecting the one nearest the project ("${winner.reference}").`,
  };
}

/**
 * Reject a dependency cycle among the resolved origins. Walks the graph from the
 * project's direct dependencies; a back-edge to an origin already on the active
 * path is a cycle.
 */
function detectCycle(
  directDependencies: readonly ProjectDependency[],
  resolved: ReadonlyMap<string, ResolvedOrigin>
): void {
  const visited = new Set<string>();
  const onPath = new Set<string>();
  const path: string[] = [];

  const visit = (origin: string): void => {
    if (onPath.has(origin)) {
      const start = path.indexOf(origin);
      throw new ExtensionResolutionCycleError([...path.slice(start), origin]);
    }
    if (visited.has(origin)) {
      return;
    }
    visited.add(origin);
    onPath.add(origin);
    path.push(origin);
    for (const dependency of resolved.get(origin)?.dependencies ?? []) {
      visit(dependency.coordinate);
    }
    path.pop();
    onPath.delete(origin);
  };

  for (const dependency of directDependencies) {
    visit(dependency.coordinate);
  }
}
