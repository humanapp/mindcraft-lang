import type { ExtensionFetchError, ExtensionFetchResult } from "@mindcraft-lang/app-host";
import { MINDCRAFT_JSON_PATH, parseExtensionReference, parseProjectContentManifest } from "@mindcraft-lang/app-host";
import type { IBrainDef } from "@mindcraft-lang/core/app";
import type { IBrainRuleDef } from "@mindcraft-lang/core/brain";
import { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import type { WorkspaceDiagnosticEntry } from "@mindcraft-lang/ts-compiler";
import type { EmbeddedExtension, ExtensionResolutionWarning } from "./embedded-extensions.js";
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
  /** Compiler diagnostics keyed by workspace path (host files and `.extensions/` files alike). */
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
      /** True when content is available for every reachable `gh:` reference. */
      readonly ok: true;
      /** Snapshot record per reachable `gh:` reference: reused stored records and fresh fetches. */
      readonly snapshotsByReference: ReadonlyMap<string, InstalledExtensionSnapshot>;
    }
  | {
      /** False when a fetch failed; the transaction must refuse. */
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

/**
 * Walk every reference reachable from an extensions map -- through embedded
 * extensions' own manifests and through fetched snapshots' manifests alike --
 * and ensure content is available for each reachable `gh:` reference: a
 * stored record whose reference matches is reused, and anything else is
 * fetched. A dependency set thus fetches as one unit before one resolution.
 *
 * @param options.extensions - The extensions map to walk.
 * @param options.embedded - The host application's bundled embedded extensions.
 * @param options.stored - The project's stored snapshot records, reused by matching reference.
 * @param options.refetch - References fetched fresh even when a stored record matches.
 * @param options.fetchSnapshot - Fetches a snapshot for a `gh:` reference.
 */
export async function collectExtensionFetchClosure(options: {
  extensions: Readonly<Record<string, string>>;
  embedded: readonly EmbeddedExtension[];
  stored: InstalledExtensionSnapshots;
  refetch?: ReadonlySet<string>;
  fetchSnapshot: (reference: string) => Promise<ExtensionFetchResult>;
}): Promise<ExtensionFetchClosureResult> {
  const embeddedByCoordinate = new Map(options.embedded.map((extension) => [extension.canonicalOrigin, extension]));
  const storedByReference = new Map<string, InstalledExtensionSnapshot>();
  for (const record of Object.values(options.stored)) {
    if (options.refetch?.has(record.reference)) continue;
    storedByReference.set(record.reference, record);
  }

  const snapshotsByReference = new Map<string, InstalledExtensionSnapshot>();
  const visited = new Set<string>();
  const queue: string[] = [...Object.values(options.extensions)];

  while (queue.length > 0) {
    const reference = queue.shift()!;
    if (visited.has(reference)) continue;
    visited.add(reference);

    const parsed = parseExtensionReference(reference);
    if (parsed === undefined) continue;

    if (parsed.transport === "embedded") {
      const extension = embeddedByCoordinate.get(parsed.coordinate);
      if (extension === undefined) continue;
      queue.push(...Object.values(ownExtensions(embeddedContent(extension))));
      continue;
    }

    if (parsed.transport === "gh") {
      let record = storedByReference.get(reference);
      if (record === undefined) {
        const fetched = await options.fetchSnapshot(reference);
        if (!fetched.ok) {
          return { ok: false, error: fetched.error };
        }
        record = installedSnapshotFromFetched(fetched.snapshot);
      }
      snapshotsByReference.set(reference, record);
      queue.push(...Object.values(ownExtensions(decodeInstalledSnapshotFiles(record))));
    }
  }

  return { ok: true, snapshotsByReference };
}
