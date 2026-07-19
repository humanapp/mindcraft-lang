import type { ExtensionCatalogMoves, ExtensionTarget } from "@mindcraft-lang/app-host";
import {
  applyCatalogMove,
  isAbbreviatedCommitPin,
  LOWEST_CONTENT_VERSION,
  MINDCRAFT_JSON_PATH,
  parseExtensionReference,
  parseProjectContentManifest,
} from "@mindcraft-lang/app-host";
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
   * under. An `embedded:<owner>/<repo>` manifest reference resolves to the embed
   * entry whose coordinate matches.
   */
  canonicalOrigin: string;
  /** The extension's source files, delivered as a read-only dependency mount. */
  files: readonly EmbeddedExtensionFile[];
}

/**
 * A conflict between two requesters of the same origin, resolved by selecting
 * one of them.
 */
export interface ExtensionResolutionConflictWarning {
  /**
   * `version-conflict` when the same origin was required at two different
   * versions and the higher was selected; `reference-tiebreak` when the
   * versions were equal and the reference nearest the host project was
   * selected.
   */
  readonly kind: "version-conflict" | "reference-tiebreak";
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
 * A non-fatal finding encountered while resolving a project's extension
 * dependency graph. Every resolved origin remains resolvable; warnings are
 * returned on the resolution result.
 */
export type ExtensionResolutionWarning =
  | ExtensionResolutionConflictWarning
  | {
      /** The origin resolved through a pin that is plausibly an abbreviated commit SHA, which the content CDN serves with mutable branch semantics. */
      readonly kind: "abbreviated-pin";
      /** The origin the warning is about. */
      readonly origin: string;
      /** The origin's winning reference string. */
      readonly reference: string;
      /** Human-readable summary. */
      readonly message: string;
    }
  | {
      /** The origin's installed content declares a manifest identity that differs from the coordinate its reference names. */
      readonly kind: "identity-mismatch";
      /** The coordinate the origin resolves under. */
      readonly origin: string;
      /** The origin's winning reference string. */
      readonly reference: string;
      /** The `<owner>/<repo>` identity the installed content's manifest declares. */
      readonly declaredIdentity: string;
      /** Human-readable summary. */
      readonly message: string;
    }
  | {
      /**
       * A declared compatibility target could not be resolved to any content: no
       * embed record carries its coordinate, no target registry pins it, or the
       * pinned content is not available. The target's platform stack does not
       * materialize.
       */
      readonly kind: "unresolved-target";
      /** The unresolved target's `<owner>/<repo>` coordinate. */
      readonly origin: string;
      /** Human-readable summary. */
      readonly message: string;
    };

/** The kind of finding a resolution warning reports. */
export type ExtensionResolutionWarningKind = ExtensionResolutionWarning["kind"];

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

/**
 * Fetched extension content available to resolution: each entry maps a `gh:`
 * reference string, as written in an extensions map, to the snapshot's
 * origin-relative text files (leading-slash paths).
 */
export type FetchedExtensionContentMap = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** The content sources a project's extension references resolve against. */
export interface ExtensionResolutionSources {
  /** Extensions bundled with the host application, resolving `embedded:` references. */
  readonly embedded: readonly EmbeddedExtension[];
  /** Fetched snapshot content keyed by reference, resolving `gh:` references. */
  readonly fetched?: FetchedExtensionContentMap;
  /**
   * Curated transport-flip moves, keyed by coordinate. A transitive dependency
   * reference whose coordinate a move targets resolves through the move's
   * target reference; absent when the host applies no moves.
   */
  readonly moves?: ExtensionCatalogMoves;
  /**
   * Registry pins resolving a target coordinate that no embed record carries to
   * a `gh:` reference, keyed by the target's `<owner>/<repo>` coordinate. A
   * declared target that matches no embed entry resolves through this map and
   * then through {@link fetched}; absent when the host pins no remote targets.
   */
  readonly targetRegistry?: ReadonlyMap<string, string>;
}

/** Provenance of one origin selected into the resolved closure. */
export interface ResolvedOriginProvenance {
  /** The `<owner>/<repo>` coordinate resolved. */
  readonly origin: string;
  /** The winning candidate's reference string. */
  readonly reference: string;
  /** The winning candidate's declared semantic version. */
  readonly version: string;
  /** The winning candidate's declared display name; the coordinate when it declares none. */
  readonly name: string;
}

/** Compiler inputs resolved from a project's extensions list and its content sources. */
export interface ResolvedExtensions {
  /** Each direct dependency's `<owner>/<repo>` coordinate, resolving its `@lib/<owner>/<repo>` imports. */
  dependencies: readonly ProjectDependency[];
  /**
   * Read-only content of every origin in the transitive dependency closure,
   * one mount per origin, each carrying its own extensions list so nested
   * `@lib/<owner>/<repo>` imports resolve against the correct origin.
   */
  dependencyMounts: readonly DependencyMount[];
  /** The winning reference and version of every origin in the closure. */
  origins: readonly ResolvedOriginProvenance[];
  /** Non-fatal conflicts encountered during resolution, in encounter order. */
  warnings: readonly ExtensionResolutionWarning[];
}

/**
 * A candidate for one origin in the transitive closure: its content, its own
 * extensions list, its declared version, the reference that reached it, and the
 * distance from the host project at which it was first reached.
 */
export interface OriginCandidate {
  /** The `<owner>/<repo>` coordinate this candidate resolves. */
  origin: string;
  /** The candidate's declared semantic version, or `0.0.0` when it has no manifest. */
  version: string;
  /** The candidate's declared display name, or its coordinate when it has no manifest. */
  name: string;
  /** The reference string that reached this candidate. */
  reference: string;
  /** The distance from the host project (0 for a direct dependency) at which this candidate was reached. */
  depth: number;
  /** The candidate's origin-relative file map, with leading-slash paths. */
  files: ReadonlyMap<string, string>;
  /** The candidate's own extensions list, resolving its `@lib/<owner>/<repo>` imports. */
  extensions: ExtensionsMap;
  /** The `<owner>/<repo>` coordinates of the candidate's declared compatibility targets, each recursed as a platform edge; empty when it declares none. */
  targets: readonly string[];
  /** The candidate's declared ambient `.d.ts` files, as namespace-relative paths; empty when it declares none. */
  ambient: readonly string[];
  /** The `<owner>/<repo>` identity the candidate's manifest declares; absent when it declares none. */
  identity?: string;
}

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
 * Read an extension's own display name, version, extensions list, declared
 * ambient `.d.ts` paths, and declared identity from the `mindcraft.json`
 * carried in its content. An extension without a manifest, or with an
 * unparseable one, contributes no dependencies and no ambient files, compares
 * as `0.0.0`, and displays as its coordinate.
 */
function readOwnManifest(
  origin: string,
  files: ReadonlyMap<string, string>
): {
  name: string;
  version: string;
  extensions: ExtensionsMap;
  targets: readonly string[];
  ambient: readonly string[];
  identity?: string;
} {
  const manifestContent = files.get(`/${MINDCRAFT_JSON_PATH}`) ?? files.get(MINDCRAFT_JSON_PATH);
  if (manifestContent === undefined) {
    return { name: origin, version: LOWEST_CONTENT_VERSION, extensions: {}, targets: [], ambient: [] };
  }
  const parsed = parseProjectContentManifest(manifestContent);
  if (!parsed.ok) {
    return { name: origin, version: LOWEST_CONTENT_VERSION, extensions: {}, targets: [], ambient: [] };
  }
  return {
    name: parsed.manifest.name,
    version: parsed.manifest.version,
    extensions: parsed.manifest.extensions,
    targets: Object.keys(parsed.manifest.targets ?? {}),
    ambient: parsed.manifest.ambient ?? [],
    ...(parsed.manifest.identity !== undefined ? { identity: parsed.manifest.identity } : {}),
  };
}

/** Build an origin candidate for `origin` from its content files at the given depth. */
function candidateFromFiles(
  origin: string,
  reference: string,
  depth: number,
  files: ReadonlyMap<string, string>
): OriginCandidate {
  const own = readOwnManifest(origin, files);
  return {
    origin,
    version: own.version,
    name: own.name,
    reference,
    depth,
    files,
    extensions: own.extensions,
    targets: own.targets,
    ambient: own.ambient,
    ...(own.identity !== undefined ? { identity: own.identity } : {}),
  };
}

/**
 * Resolve one reference string against the content sources into an origin
 * candidate at the given depth. An `embedded:` reference resolves through the
 * embed record; a `gh:` reference resolves through the fetched content map.
 * A reference whose source has no content for it yields `undefined`.
 */
function candidateForReference(
  reference: string,
  depth: number,
  byCoordinate: ReadonlyMap<string, EmbeddedExtension>,
  fetched: FetchedExtensionContentMap | undefined
): OriginCandidate | undefined {
  const parsed = parseExtensionReference(reference);
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed.transport === "embedded") {
    const extension = byCoordinate.get(parsed.coordinate);
    if (extension === undefined) {
      return undefined;
    }
    return candidateFromFiles(extension.canonicalOrigin, reference, depth, embeddedFiles(extension));
  }
  if (parsed.transport === "gh") {
    const files = fetched?.get(reference);
    if (files === undefined) {
      return undefined;
    }
    return candidateFromFiles(`${parsed.owner}/${parsed.repo}`, reference, depth, files);
  }
  return undefined;
}

/**
 * Resolve a declared target coordinate to the reference string its content is
 * reached through: an `embedded:<coordinate>` reference when the embed record
 * carries it, otherwise the registry's pinned `gh:` reference for the
 * coordinate. Returns `undefined` when neither source names the coordinate.
 */
function referenceForTargetCoordinate(
  coordinate: string,
  byCoordinate: ReadonlyMap<string, EmbeddedExtension>,
  targetRegistry: ReadonlyMap<string, string> | undefined
): string | undefined {
  if (byCoordinate.has(coordinate)) {
    return `embedded:${coordinate}`;
  }
  return targetRegistry?.get(coordinate);
}

/** Build the warning for a declared target coordinate that resolves to no content. */
function unresolvedTargetWarning(coordinate: string): ExtensionResolutionWarning {
  return {
    kind: "unresolved-target",
    origin: coordinate,
    message:
      `Target "${coordinate}" resolves to no content: it is not in the host embed record, not pinned in the ` +
      "target registry, or its pinned content is not available. Its platform stack does not materialize.",
  };
}

/** A resolved origin: the winning candidate plus the coordinates its own imports resolve through. */
interface ResolvedOrigin {
  candidate: OriginCandidate;
  /** This origin's own dependency coordinates, resolving its `@lib/<owner>/<repo>` imports. */
  dependencies: ProjectDependency[];
}

/** The outcome of unifying an incoming candidate against the incumbent already resolved for its origin. */
export interface OriginUnification {
  /** The candidate that wins the origin: higher version, or nearest-root at an equal version. */
  readonly winner: OriginCandidate;
  /** The conflict recorded when the two candidates disagree on version or reference; absent when they unify cleanly. */
  readonly warning: ExtensionResolutionConflictWarning | undefined;
}

/**
 * Unify an incoming candidate for an origin against the incumbent already
 * resolved for it, selecting the winner and reporting any conflict. The higher
 * semantic version wins and records a `version-conflict` warning; at an equal
 * version, a differing reference nearest the host project (smaller depth) wins
 * and records a `reference-tiebreak` warning; an identical version and
 * reference unify onto the incumbent with no warning.
 */
export function unifyOriginCandidate(incoming: OriginCandidate, incumbent: OriginCandidate): OriginUnification {
  const versionOrder = compareSemver(incoming.version, incumbent.version);
  if (versionOrder > 0) {
    return { winner: incoming, warning: versionConflict(incoming, incumbent) };
  }
  if (versionOrder < 0) {
    return { winner: incumbent, warning: versionConflict(incumbent, incoming) };
  }
  if (incoming.reference !== incumbent.reference) {
    // Equal versions, different references: the reference nearest the host
    // project wins. A strictly-shallower newcomer replaces the incumbent.
    const winner = incoming.depth < incumbent.depth ? incoming : incumbent;
    const loser = winner === incoming ? incumbent : incoming;
    return { winner, warning: referenceTiebreak(winner, loser) };
  }
  return { winner: incumbent, warning: undefined };
}

/**
 * Resolve a project's extensions list against its content sources into
 * compiler dependency inputs. Resolution is transitive: an extension's own
 * `mindcraft.json` extensions resolve recursively. Each origin appears once in
 * the closure regardless of how many dependents reference it, so references to
 * an origin's published types across a diamond unify on one registration.
 *
 * When the same origin is required at two different versions, the higher
 * semantic version is selected and a `version-conflict` warning names both
 * requesters; when the versions are equal but the references differ, the
 * reference nearest the host project wins and a `reference-tiebreak` warning is
 * emitted. A fetched origin whose winning pin is plausibly an abbreviated
 * commit SHA raises an `abbreviated-pin` warning, and one whose content
 * declares a manifest identity differing from its coordinate raises an
 * `identity-mismatch` warning. A reference whose source carries no content for
 * it is skipped; an unresolved import surfaces later as an ordinary compiler
 * diagnostic.
 *
 * A project's declared compatibility targets are additional closure roots, and
 * at every node the union of its `extensions` and `targets` edges is recursed.
 * A target coordinate resolves to `embedded:<coordinate>` when the
 * embed record carries it, otherwise to the target registry's pinned `gh:`
 * reference; a target that resolves to no content raises an `unresolved-target`
 * warning. A coordinate reached through both an extension edge and a target
 * edge unifies onto one resolved origin.
 *
 * @param extensions - The project's extensions map, keyed by coordinate; each value is a reference string.
 * @param sources - The content sources references resolve against.
 * @param projectTargets - The project's declared compatibility targets, keyed by target coordinate; each is recursed as a closure root.
 * @throws {ExtensionResolutionCycleError} when the extension graph contains a
 *   dependency cycle.
 */
export function resolveProjectExtensions(
  extensions: Readonly<Record<string, string>> | undefined,
  sources: ExtensionResolutionSources,
  projectTargets?: Readonly<Record<string, ExtensionTarget>>
): ResolvedExtensions {
  const targetCoordinates = Object.keys(projectTargets ?? {});
  if (!extensions && targetCoordinates.length === 0) {
    return { dependencies: [], dependencyMounts: [], origins: [], warnings: [] };
  }
  const byCoordinate = new Map(sources.embedded.map((extension) => [extension.canonicalOrigin, extension]));
  const fetched = sources.fetched;
  const moves = sources.moves ?? {};
  const targetRegistry = sources.targetRegistry;
  const warnings: ExtensionResolutionWarning[] = [];
  const warnedTargets = new Set<string>();

  // The project's direct dependencies: each dependency's `<owner>/<repo>`
  // coordinate, which its reference resolves to. The coordinate is derived
  // from identity, never from the manifest key. A coordinate reached through
  // both an extension and a target edge is listed once.
  const directDependencies: ProjectDependency[] = [];
  const seenDirect = new Set<string>();
  const addDirect = (coordinate: string): void => {
    if (!seenDirect.has(coordinate)) {
      seenDirect.add(coordinate);
      directDependencies.push({ coordinate });
    }
  };

  /**
   * Resolve one declared target coordinate at `depth` into a candidate,
   * recording an `unresolved-target` warning (once per coordinate) when it
   * resolves to no content.
   */
  const resolveTargetEdge = (coordinate: string, depth: number): OriginCandidate | undefined => {
    const reference = referenceForTargetCoordinate(coordinate, byCoordinate, targetRegistry);
    const child = reference !== undefined ? candidateForReference(reference, depth, byCoordinate, fetched) : undefined;
    if (child === undefined) {
      if (!warnedTargets.has(coordinate)) {
        warnedTargets.add(coordinate);
        warnings.push(unresolvedTargetWarning(coordinate));
      }
      return undefined;
    }
    return child;
  };

  const rootCandidates: OriginCandidate[] = [];
  for (const reference of Object.values(extensions ?? {})) {
    const candidate = candidateForReference(reference, 0, byCoordinate, fetched);
    if (candidate === undefined) {
      continue;
    }
    addDirect(candidate.origin);
    rootCandidates.push(candidate);
  }
  for (const coordinate of targetCoordinates) {
    const candidate = resolveTargetEdge(coordinate, 0);
    if (candidate === undefined) {
      continue;
    }
    addDirect(candidate.origin);
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
    const { winner, warning } = unifyOriginCandidate(candidate, existing.candidate);
    if (warning !== undefined) {
      warnings.push(warning);
    }
    if (winner !== existing.candidate) {
      resolved.set(candidate.origin, { candidate: winner, dependencies: existing.dependencies });
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
    // Expand an origin's own edges once, off its winning candidate: the union
    // of its extension edges and its target edges.
    if (winner.candidate === candidate && !expanded.has(candidate.origin)) {
      expanded.add(candidate.origin);
      for (const declaredReference of Object.values(candidate.extensions)) {
        const reference = applyCatalogMove(declaredReference, moves);
        const child = candidateForReference(reference, candidate.depth + 1, byCoordinate, fetched);
        if (child === undefined) {
          continue;
        }
        winner.dependencies.push({ coordinate: child.origin });
        unify(child);
        queue.push(child);
      }
      for (const targetCoordinate of candidate.targets) {
        const child = resolveTargetEdge(targetCoordinate, candidate.depth + 1);
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
  const origins: ResolvedOriginProvenance[] = [];
  for (const { candidate, dependencies } of resolved.values()) {
    dependencyMounts.push({
      namespace: candidate.origin,
      files: candidate.files,
      dependencies,
      ...(candidate.ambient.length > 0 ? { ambient: candidate.ambient } : {}),
    });
    origins.push({
      origin: candidate.origin,
      reference: candidate.reference,
      version: candidate.version,
      name: candidate.name,
    });
    warnings.push(...fetchedCandidateWarnings(candidate));
  }

  return { dependencies: directDependencies, dependencyMounts, origins, warnings };
}

/** The pin-form and identity warnings a fetched origin's winning candidate raises. */
function fetchedCandidateWarnings(candidate: OriginCandidate): ExtensionResolutionWarning[] {
  const parsed = parseExtensionReference(candidate.reference);
  if (parsed?.transport !== "gh") {
    return [];
  }
  const found: ExtensionResolutionWarning[] = [];
  if (parsed.routing.kind === "pin" && isAbbreviatedCommitPin(parsed.routing.pin)) {
    found.push({
      kind: "abbreviated-pin",
      origin: candidate.origin,
      reference: candidate.reference,
      message:
        `Extension "${candidate.origin}" is pinned at "${parsed.routing.pin}", which looks like an abbreviated ` +
        "commit SHA; the content CDN serves it with mutable branch semantics. " +
        "Only the full 40-character SHA is an immutable pin.",
    });
  }
  if (candidate.identity !== undefined && candidate.identity !== candidate.origin) {
    found.push({
      kind: "identity-mismatch",
      origin: candidate.origin,
      reference: candidate.reference,
      declaredIdentity: candidate.identity,
      message:
        `Extension "${candidate.origin}" (via "${candidate.reference}") declares the identity ` +
        `"${candidate.identity}"; the content may have been forked or renamed upstream. ` +
        `Resolution proceeds under "${candidate.origin}".`,
    });
  }
  return found;
}

/** Build a version-conflict warning where `winner` was selected over `loser`. */
function versionConflict(winner: OriginCandidate, loser: OriginCandidate): ExtensionResolutionConflictWarning {
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
function referenceTiebreak(winner: OriginCandidate, loser: OriginCandidate): ExtensionResolutionConflictWarning {
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
