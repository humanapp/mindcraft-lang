import type {
  ExtensionCatalogMoves,
  ExtensionFetchError,
  ExtensionFetchResult,
  ExtensionVersionListResult,
} from "@mindcraft-lang/app-host";
import {
  applyCatalogMove,
  highestListedRelease,
  MINDCRAFT_JSON_PATH,
  parseCatalogMoveReference,
  parseExtensionReference,
  parseProjectContentManifest,
} from "@mindcraft-lang/app-host";
import type { IBrainDef } from "@mindcraft-lang/core/app";
import type { IBrainRuleDef } from "@mindcraft-lang/core/brain";
import { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import type { WorkspaceDiagnosticEntry } from "@mindcraft-lang/ts-compiler";
import type { EmbeddedExtension, ExtensionResolutionWarning } from "./embedded-extensions.js";
import { CatalogMoveWarningCode, createCatalogMoveVersionLookup } from "./embedded-extensions.js";
import type { InstalledExtensionSnapshot, InstalledExtensionSnapshots } from "./fetched-extension-snapshots.js";
import { decodeInstalledSnapshotFiles, installedSnapshotFromFetched } from "./fetched-extension-snapshots.js";

// ---------------------------------------------------------------------------
// Diagnostic state and outcome
// ---------------------------------------------------------------------------

/**
 * The diagnostic state of a project at one extension resolution: per-file
 * compiler diagnostics keyed by workspace path, and per-brain typecheck
 * problems keyed by brain key. Two states diff into an
 * {@link ExtensionInstallOutcome} regardless of what mutation produced them.
 */
export interface ProjectDiagnosticsState {
  /** Compiler diagnostics keyed by workspace path (host files and `.libraries/` files alike). */
  readonly files: ReadonlyMap<string, readonly WorkspaceDiagnosticEntry[]>;
  /** Brain typecheck problem renderings keyed by brain key. */
  readonly brains: ReadonlyMap<string, readonly string[]>;
}

/** How an install transaction's end state compares to its baseline. */
export type ExtensionInstallOutcomeKind = "improved" | "unchanged" | "worsened";

/** One problem named by an install outcome. */
export interface ExtensionInstallProblem {
  /** Workspace path of the file, or the brain key, the problem is located at. */
  readonly location: string;
  /** Rendering of the problem. */
  readonly description: string;
}

/** The outcome of one install transaction: the diagnostic difference against its baseline. */
export interface ExtensionInstallOutcome {
  /** `worsened` when new problems appeared; `improved` when none appeared and some resolved; `unchanged` otherwise. */
  readonly kind: ExtensionInstallOutcomeKind;
  /** Problems present after the transaction that were absent before. */
  readonly newProblems: readonly ExtensionInstallProblem[];
  /** Problems present before the transaction that are gone after. */
  readonly resolvedProblems: readonly ExtensionInstallProblem[];
}

/** Render a compiler diagnostic as a location-independent problem key. */
function diagnosticProblem(entry: WorkspaceDiagnosticEntry): string {
  return `${entry.severity} ${entry.code}: ${entry.message}`;
}

/** Count problem occurrences per location. */
function problemCounts(state: ProjectDiagnosticsState): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  const add = (location: string, problem: string): void => {
    let atLocation = counts.get(location);
    if (!atLocation) {
      atLocation = new Map();
      counts.set(location, atLocation);
    }
    atLocation.set(problem, (atLocation.get(problem) ?? 0) + 1);
  };
  for (const [path, entries] of state.files) {
    for (const entry of entries) {
      add(path, diagnosticProblem(entry));
    }
  }
  for (const [key, problems] of state.brains) {
    for (const problem of problems) {
      add(key, problem);
    }
  }
  return counts;
}

/** Problems whose per-location count grew from `from` to `to`, one entry per additional occurrence. */
function grownProblems(
  from: Map<string, Map<string, number>>,
  to: Map<string, Map<string, number>>
): ExtensionInstallProblem[] {
  const grown: ExtensionInstallProblem[] = [];
  for (const [location, toCounts] of to) {
    const fromCounts = from.get(location);
    for (const [problem, count] of toCounts) {
      const before = fromCounts?.get(problem) ?? 0;
      for (let i = before; i < count; i++) {
        grown.push({ location, description: problem });
      }
    }
  }
  return grown;
}

/**
 * Diff two diagnostic states into an install outcome. Problems are compared as
 * per-location multisets of severity, code, and message; a problem that only
 * moved within its file is unchanged.
 */
export function diffProjectDiagnostics(
  before: ProjectDiagnosticsState,
  after: ProjectDiagnosticsState
): ExtensionInstallOutcome {
  const beforeCounts = problemCounts(before);
  const afterCounts = problemCounts(after);
  const newProblems = grownProblems(beforeCounts, afterCounts);
  const resolvedProblems = grownProblems(afterCounts, beforeCounts);
  const kind: ExtensionInstallOutcomeKind =
    newProblems.length > 0 ? "worsened" : resolvedProblems.length > 0 ? "improved" : "unchanged";
  return { kind, newProblems, resolvedProblems };
}

// ---------------------------------------------------------------------------
// Brain typecheck problems
// ---------------------------------------------------------------------------

function collectRuleProblems(rule: IBrainRuleDef, problems: string[]): void {
  if (rule instanceof BrainRuleDef) {
    const result = rule.when().typecheckResult();
    if (result) {
      const path = rule.getLocationPath();
      result.whenParseResult.diags.forEach((diag) => {
        problems.push(`${path} when parse ${diag.code}: ${diag.message}`);
      });
      result.doParseResult.diags.forEach((diag) => {
        problems.push(`${path} do parse ${diag.code}: ${diag.message}`);
      });
      result.typeInfo.diags.forEach((diag) => {
        problems.push(`${path} type ${diag.code}: ${diag.message}`);
      });
    }
  }
  rule.children().forEach((child) => {
    collectRuleProblems(child, problems);
  });
}

/**
 * Re-typecheck a brain against the current catalogs and collect its problems,
 * one rendering per diagnostic. Every rule is marked dirty first, so the
 * typecheck recomputes each rule's result.
 */
export function typecheckBrainProblems(brain: IBrainDef): readonly string[] {
  brain.pages().forEach((page) => {
    page.children().forEach((rule) => {
      rule.markDirty();
    });
  });
  brain.typecheck();
  const problems: string[] = [];
  brain.pages().forEach((page) => {
    page.children().forEach((rule) => {
      collectRuleProblems(rule, problems);
    });
  });
  return problems;
}

// ---------------------------------------------------------------------------
// Refusal and report
// ---------------------------------------------------------------------------

/**
 * A mechanics failure that refuses an install transaction outright: no
 * coherent state exists to commit, and the project is left unchanged.
 */
export type ExtensionInstallRefusal =
  | {
      /** A dependency's content could not be fetched. */
      readonly kind: "fetch";
      /** The failure, carrying its {@link ExtensionFetchError.code} and the reference it was for. */
      readonly error: ExtensionFetchError;
    }
  | {
      /** The extension graph contains a dependency cycle. */
      readonly kind: "cycle";
      /** The origins on the cycle, in traversal order, with the first origin repeated at the end. */
      readonly cycle: readonly string[];
      /** Human-readable refusal message. */
      readonly message: string;
    };

/** The result of one install transaction. */
export type ExtensionInstallReport =
  | {
      /** True: the transaction committed (improved, unchanged, and worsened outcomes all commit). */
      readonly committed: true;
      /** The diagnostic difference against the pre-install baseline. */
      readonly outcome: ExtensionInstallOutcome;
      /** Non-fatal resolution conflicts encountered, in encounter order. */
      readonly warnings: readonly ExtensionResolutionWarning[];
      /**
       * One-step undo: reverts the manifest entries and the stored snapshots,
       * then re-resolves and re-materializes. Present when the outcome
       * worsened.
       */
      readonly undo?: () => Promise<void>;
    }
  | {
      /** False: a mechanics failure refused the transaction; nothing changed. */
      readonly committed: false;
      /** The refusal. */
      readonly refusal: ExtensionInstallRefusal;
    };

// ---------------------------------------------------------------------------
// Fetch closure
// ---------------------------------------------------------------------------

/** Result of {@link collectExtensionFetchClosure}. */
export type ExtensionFetchClosureResult =
  | {
      /** True when content is available for every reachable, non-skipped `gh:` reference. */
      readonly ok: true;
      /** Snapshot record per reachable `gh:` reference: reused stored records and fresh fetches. */
      readonly snapshotsByReference: ReadonlyMap<string, InstalledExtensionSnapshot>;
      /** Non-fatal catalog-move findings: edges skipped this walk, retried on the next load. */
      readonly warnings: readonly ExtensionResolutionWarning[];
      /**
       * Pinned `gh:` references for coordinates whose moves resolved through a
       * floating destination during this walk, keyed by lowercased coordinate.
       */
      readonly floatingPins: ReadonlyMap<string, string>;
    }
  | {
      /** False when a fetch of a reference as written failed; the transaction must refuse. */
      readonly ok: false;
      /** The failure. */
      readonly error: ExtensionFetchError;
    };

/** Read the extensions map an origin's own content manifest declares. */
function ownExtensions(files: ReadonlyMap<string, string>): Readonly<Record<string, string>> {
  const manifestContent = files.get(`/${MINDCRAFT_JSON_PATH}`) ?? files.get(MINDCRAFT_JSON_PATH);
  if (manifestContent === undefined) return {};
  const parsed = parseProjectContentManifest(manifestContent);
  return parsed.ok ? parsed.manifest.extensions : {};
}

/** Build the leading-slash text file map of an embedded extension. */
function embeddedContent(extension: EmbeddedExtension): Map<string, string> {
  const files = new Map<string, string>();
  for (const file of extension.files) {
    files.set(file.path.startsWith("/") ? file.path : `/${file.path}`, file.content);
  }
  return files;
}

/** One reference to walk, marked whether a catalog move rewrote it. */
interface WalkItem {
  readonly reference: string;
  /** True when the reference was produced by a move rewrite of a declared edge. */
  readonly movedByCatalog: boolean;
}

/** Options of the shared closure walk behind fetch and dry-run modes. */
interface ClosureWalkOptions {
  readonly extensions: Readonly<Record<string, string>>;
  readonly embedded: readonly EmbeddedExtension[];
  readonly stored: InstalledExtensionSnapshots;
  readonly refetch?: ReadonlySet<string>;
  readonly moves?: ExtensionCatalogMoves;
  /** Fetches a snapshot for a `gh:` reference; absent in dry-run mode, where nothing is fetched. */
  readonly fetchSnapshot?: (reference: string) => Promise<ExtensionFetchResult>;
  /** Lists a repository's published version strings, for resolving a floating move destination. */
  readonly listVersions?: (owner: string, repo: string) => Promise<ExtensionVersionListResult>;
}

/** Outcome of the shared closure walk. */
type ClosureWalkOutcome =
  | {
      readonly ok: true;
      readonly snapshotsByReference: Map<string, InstalledExtensionSnapshot>;
      readonly warnings: ExtensionResolutionWarning[];
      readonly floatingPins: Map<string, string>;
      /** True when the walk reached a `gh:` reference with no available content (dry-run mode only). */
      readonly missingContent: boolean;
    }
  | { readonly ok: false; readonly error: ExtensionFetchError };

/**
 * The stored snapshot records' pinned `gh:` references, keyed by lowercased
 * coordinate. A floating catalog-move destination resolves through this map
 * before any network lookup, so an already-migrated coordinate keeps its pin.
 *
 * @param stored - The project's stored snapshot records, keyed by coordinate.
 */
export function floatingPinsFromSnapshots(stored: InstalledExtensionSnapshots): Map<string, string> {
  const pins = new Map<string, string>();
  for (const [coordinate, record] of Object.entries(stored)) {
    const parsed = parseExtensionReference(record.reference);
    if (parsed?.transport === "gh" && parsed.routing.kind === "pin") {
      pins.set(coordinate.toLowerCase(), record.reference);
    }
  }
  return pins;
}

/**
 * Walk every reference reachable from an extensions map -- through embedded
 * extensions' own manifests and through fetched snapshots' manifests alike --
 * applying catalog moves at every dependency edge. The walk iterates
 * apply/fetch/re-apply: content fetched during a pass can determine versions
 * that let a `packageVersion` selector capture on the next pass, until no edge
 * rewrite changes. Root references are walked as written.
 *
 * In fetch mode (a `fetchSnapshot` callback present), content missing for a
 * reference as written fails the walk; content missing for a move-rewritten
 * edge, an unresolvable floating destination, and a permanently undeterminable
 * version each surface a stable-coded `catalog-move-failed` warning, skipping
 * that edge for this walk. In dry-run mode nothing is fetched and the walk
 * reports whether any reachable content is missing.
 */
async function walkExtensionClosure(options: ClosureWalkOptions): Promise<ClosureWalkOutcome> {
  const moves = options.moves ?? {};
  const dryRun = options.fetchSnapshot === undefined;
  const embeddedByCoordinate = new Map(options.embedded.map((extension) => [extension.canonicalOrigin, extension]));
  const storedByReference = new Map<string, InstalledExtensionSnapshot>();
  for (const record of Object.values(options.stored)) {
    if (options.refetch?.has(record.reference)) continue;
    storedByReference.set(record.reference, record);
  }
  const fetchedRecords = new Map<string, InstalledExtensionSnapshot>();
  const floatingPins = floatingPinsFromSnapshots(options.stored);
  const unresolvableFloating = new Set<string>();

  const versionLookup = createCatalogMoveVersionLookup({
    embedded: options.embedded,
    contentForReference: (reference) => {
      const record = fetchedRecords.get(reference) ?? storedByReference.get(reference);
      return record !== undefined ? decodeInstalledSnapshotFiles(record) : undefined;
    },
  });

  const warnings: ExtensionResolutionWarning[] = [];
  const warned = new Set<string>();
  const warn = (reference: string, code: CatalogMoveWarningCode, message: string): void => {
    const key = `${reference} ${code}`;
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push({
      kind: "catalog-move-failed",
      origin: parseCatalogMoveReference(reference)?.coordinate ?? reference,
      reference,
      code,
      message,
    });
  };

  /** Resolve a floating reference to a pinned one: a known pin, else the highest stable published version. */
  const resolveFloating = async (coordinate: string): Promise<string | undefined> => {
    const key = coordinate.toLowerCase();
    const known = floatingPins.get(key);
    if (known !== undefined) {
      return known;
    }
    if (dryRun || options.listVersions === undefined || unresolvableFloating.has(key)) {
      return undefined;
    }
    const slash = coordinate.indexOf("/");
    const listed = await options.listVersions(coordinate.slice(0, slash), coordinate.slice(slash + 1));
    const version = listed.ok ? highestListedRelease(listed.versions) : undefined;
    if (version === undefined) {
      unresolvableFloating.add(key);
      return undefined;
    }
    const pin = `gh:${coordinate}@${version}`;
    floatingPins.set(key, pin);
    return pin;
  };

  /**
   * Redirect one declared edge through the moves with the versions known so
   * far. A floating result resolves to its pin, and the moves re-apply from
   * the pin, until the reference is concrete and uncaptured. Returns the walk
   * item, or `undefined` when the edge is skipped this walk. `pendingRefs`
   * collects declared references whose version-range evaluation is still
   * pending, and `outputs` records the edge's final reference for the fixpoint
   * comparison.
   */
  const redirectEdge = async (
    declaredReference: string,
    pendingRefs: Set<string>,
    outputs: Map<string, string>
  ): Promise<WalkItem | undefined> => {
    let reference = declaredReference;
    let movedByCatalog = false;
    const seenPins = new Set<string>();
    while (true) {
      const applied = applyCatalogMove(reference, moves, versionLookup);
      if (!applied.ok) {
        warn(declaredReference, applied.code, applied.message);
        outputs.set(declaredReference, declaredReference);
        return { reference: declaredReference, movedByCatalog: false };
      }
      if (applied.moved) {
        reference = applied.reference;
        movedByCatalog = true;
      }
      const parts = parseCatalogMoveReference(reference);
      if (!parts?.floating) {
        // Pending only counts at the edge's final concrete reference: a range
        // blocked at an intermediate floating hop is resolved by the pin
        // substitution and re-application.
        if (applied.pendingVersion) {
          pendingRefs.add(declaredReference);
        }
        outputs.set(declaredReference, reference);
        return { reference, movedByCatalog };
      }
      const pin = await resolveFloating(parts.coordinate);
      if (pin === undefined) {
        outputs.set(declaredReference, reference);
        if (dryRun) {
          // A floating destination with no stored pin needs a fetch
          // transaction to resolve and persist one.
          missingContent = true;
        } else {
          warn(
            declaredReference,
            CatalogMoveWarningCode.FLOATING_UNRESOLVED,
            `Catalog move for "${declaredReference}" resolves to the floating "${reference}" and no stable ` +
              "published version could be pinned; the move is skipped this load."
          );
        }
        return undefined;
      }
      if (seenPins.has(pin)) {
        warn(
          declaredReference,
          CatalogMoveWarningCode.CYCLE,
          `Catalog moves for "${declaredReference}" revisited the pinned "${pin}".`
        );
        outputs.set(declaredReference, declaredReference);
        return { reference: declaredReference, movedByCatalog: false };
      }
      seenPins.add(pin);
      reference = pin;
      movedByCatalog = true;
    }
  };

  let previousOutputs: Map<string, string> | undefined;
  let missingContent = false;

  while (true) {
    const outputs = new Map<string, string>();
    const pendingRefs = new Set<string>();
    const snapshotsByReference = new Map<string, InstalledExtensionSnapshot>();
    missingContent = false;

    const visited = new Set<string>();
    const queue: WalkItem[] = Object.values(options.extensions).map((reference) => ({
      reference,
      movedByCatalog: false,
    }));

    while (queue.length > 0) {
      const item = queue.shift()!;
      if (visited.has(item.reference)) continue;
      visited.add(item.reference);

      const parsed = parseExtensionReference(item.reference);
      if (parsed === undefined) continue;

      let files: ReadonlyMap<string, string> | undefined;
      if (parsed.transport === "embedded") {
        const extension = embeddedByCoordinate.get(parsed.coordinate);
        if (extension === undefined) continue;
        files = embeddedContent(extension);
      } else if (parsed.transport === "gh") {
        let record = fetchedRecords.get(item.reference) ?? storedByReference.get(item.reference);
        if (record === undefined) {
          if (dryRun) {
            missingContent = true;
            continue;
          }
          const fetched = await options.fetchSnapshot!(item.reference);
          if (!fetched.ok) {
            if (item.movedByCatalog) {
              warn(
                item.reference,
                CatalogMoveWarningCode.FETCH_FAILED,
                `Moved content "${item.reference}" could not be fetched (${fetched.error.code}); ` +
                  "the move is skipped this load."
              );
              continue;
            }
            return { ok: false, error: fetched.error };
          }
          record = installedSnapshotFromFetched(fetched.snapshot);
          fetchedRecords.set(item.reference, record);
        }
        snapshotsByReference.set(item.reference, record);
        files = decodeInstalledSnapshotFiles(record);
      }
      if (files === undefined) continue;

      for (const declaredReference of Object.values(ownExtensions(files))) {
        const child = await redirectEdge(declaredReference, pendingRefs, outputs);
        if (child !== undefined) {
          queue.push(child);
        }
      }
    }

    const stable =
      previousOutputs !== undefined &&
      outputs.size === previousOutputs.size &&
      [...outputs].every(([key, value]) => previousOutputs?.get(key) === value);
    if (stable) {
      if (!dryRun) {
        for (const declaredReference of pendingRefs) {
          warn(
            declaredReference,
            CatalogMoveWarningCode.VERSION_UNKNOWN,
            `The version of "${declaredReference}" could not be determined, so its version-scoped catalog move ` +
              "cannot be evaluated; the move is skipped this load."
          );
        }
      }
      return { ok: true, snapshotsByReference, warnings, floatingPins, missingContent };
    }
    previousOutputs = outputs;
  }
}

/**
 * Walk every reference reachable from an extensions map and ensure content is
 * available for each reachable `gh:` reference: a stored record whose
 * reference matches is reused, and anything else is fetched. Catalog moves
 * apply at every dependency edge through the apply/fetch/re-apply loop of the
 * shared walk; a moved edge that cannot complete this walk (fetch failure,
 * unresolvable floating destination, undeterminable version) surfaces a
 * stable-coded warning and is skipped, while a fetch failure for a reference
 * as written fails the whole walk. A dependency set thus fetches as one unit
 * before one resolution.
 *
 * @param options.extensions - The extensions map to walk; root references are walked as written.
 * @param options.embedded - The host application's bundled embedded extensions.
 * @param options.stored - The project's stored snapshot records, reused by matching reference.
 * @param options.refetch - References fetched fresh even when a stored record matches.
 * @param options.moves - Curated catalog moves applied at every dependency edge.
 * @param options.fetchSnapshot - Fetches a snapshot for a `gh:` reference.
 * @param options.listVersions - Lists a repository's published versions, resolving floating move destinations.
 */
export async function collectExtensionFetchClosure(options: {
  extensions: Readonly<Record<string, string>>;
  embedded: readonly EmbeddedExtension[];
  stored: InstalledExtensionSnapshots;
  refetch?: ReadonlySet<string>;
  moves?: ExtensionCatalogMoves;
  fetchSnapshot: (reference: string) => Promise<ExtensionFetchResult>;
  listVersions?: (owner: string, repo: string) => Promise<ExtensionVersionListResult>;
}): Promise<ExtensionFetchClosureResult> {
  const outcome = await walkExtensionClosure(options);
  if (!outcome.ok) {
    return outcome;
  }
  return {
    ok: true,
    snapshotsByReference: outcome.snapshotsByReference,
    warnings: outcome.warnings,
    floatingPins: outcome.floatingPins,
  };
}

/**
 * Report whether the moved closure of an extensions map reaches a `gh:`
 * reference whose content is not already available -- neither bundled as an
 * embedded extension nor held in the stored snapshot records. Runs the shared
 * closure walk in dry-run mode: moves apply at every edge with the versions
 * the stored content determines, a floating destination with no stored pin
 * counts as missing content, and nothing is fetched. It answers whether a
 * load must run a fetch transaction to heal a moved dependency whose content
 * the project never persisted.
 *
 * @param options.extensions - The extensions map to walk, with any top-level moves already applied.
 * @param options.embedded - The host application's bundled embedded extensions.
 * @param options.stored - The project's stored snapshot records, matched by reference.
 * @param options.moves - Curated catalog moves applied at every dependency edge.
 */
export async function movedClosureHasMissingContent(options: {
  extensions: Readonly<Record<string, string>>;
  embedded: readonly EmbeddedExtension[];
  stored: InstalledExtensionSnapshots;
  moves?: ExtensionCatalogMoves;
}): Promise<boolean> {
  const outcome = await walkExtensionClosure(options);
  return outcome.ok ? outcome.missingContent : true;
}
