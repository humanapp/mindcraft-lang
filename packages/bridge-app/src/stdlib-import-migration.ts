import { EXTENSION_IMPORT_PREFIX } from "@mindcraft-lang/ts-compiler";

/**
 * One redirect that carries a project onto an embedded extension's final
 * `<owner>/<repo>` coordinate, from either of two prior states: a legacy
 * workspace-path import (e.g. `stdlib/image`) or an interim `@ext/<repo>`
 * import that predates the coordinate form. Matching user-code import
 * specifiers are rewritten to the extension's `@ext/<owner>/<repo>` entry
 * surface, the coordinate dependency is backfilled into the manifest, and any
 * interim manifest key and interim saved-brain origin are rewritten to the
 * final coordinate and origin.
 */
export interface StdlibImportRedirect {
  /**
   * Import specifiers a user file may currently name the extension by, each
   * without a trailing slash. A specifier matches a value or any subpath of
   * it: `stdlib` matches `stdlib` and `stdlib/image`; `@ext/wodal-stdlib`
   * matches the interim entry import. The final `@ext/<owner>/<repo>` form is
   * excluded so an already-migrated import is a no-op.
   */
  fromSpecifiers: readonly string[];
  /** Coordinate `<owner>/<repo>` the rewritten specifier addresses via `@ext/<owner>/<repo>`. */
  toCoordinate: string;
  /** Extension reference string recorded in the manifest under {@link toCoordinate}. */
  toReference: string;
  /**
   * Manifest keys of prior states that this redirect supersedes (e.g. an
   * interim `wodal-stdlib` slug). Present keys are removed as {@link toCoordinate}
   * is backfilled, so the manifest carries exactly one entry for the extension.
   */
  interimManifestKeys: readonly string[];
  /**
   * Prior saved-brain symbol origins (e.g. `embedded:wodal-stdlib`) each
   * rewritten to {@link toOrigin}. Every prior form the extension's origin has
   * been persisted under is listed here so a brain on any of them migrates to
   * the final origin.
   */
  interimOrigins: readonly string[];
  /** Final saved-brain symbol origin (`<owner>/<repo>` coordinate) the interim origins are rewritten to. */
  toOrigin: string;
}

/** Result of migrating one project's user-code imports and manifest. */
export interface StdlibImportMigrationResult {
  /** Rewritten file content keyed by workspace path; only changed files appear. */
  changedFiles: ReadonlyMap<string, string>;
  /** Coordinate-keyed extensions to add to the manifest; empty when none are needed. */
  manifestBackfill: Readonly<Record<string, string>>;
  /** Interim manifest keys to remove; empty when none are present. */
  manifestRemovals: readonly string[];
  /** True when any file, backfill, or removal changed. */
  changed: boolean;
}

const IMPORT_FROM_PATTERN = /(\bfrom\s*|\bimport\s*)(["'])([^"']+)(["'])/g;

/** Whether `specifier` names, or is a subpath of, one of a redirect's `fromSpecifiers`. */
function matchesRedirect(specifier: string, redirect: StdlibImportRedirect): boolean {
  return redirect.fromSpecifiers.some((from) => specifier === from || specifier.startsWith(`${from}/`));
}

/**
 * The extension's published entry surface `@ext/<owner>/<repo>`. Every matched
 * legacy or interim specifier maps to this single entry, which re-exports the
 * extension's helpers; only the entry surface is importable from a consuming
 * project.
 */
function rewriteSpecifier(redirect: StdlibImportRedirect): string {
  return `${EXTENSION_IMPORT_PREFIX}${redirect.toCoordinate}`;
}

/** Rewrite every matched stdlib import specifier in one `.ts` source, or return undefined when unchanged. */
function rewriteSource(content: string, redirects: readonly StdlibImportRedirect[]): string | undefined {
  let changed = false;
  const next = content.replace(IMPORT_FROM_PATTERN, (match, keyword, openQuote, specifier, closeQuote) => {
    const redirect = redirects.find((candidate) => matchesRedirect(specifier, candidate));
    if (redirect === undefined) {
      return match;
    }
    changed = true;
    return `${keyword}${openQuote}${rewriteSpecifier(redirect)}${closeQuote}`;
  });
  return changed ? next : undefined;
}

function isUserTsFile(path: string): boolean {
  return path.endsWith(".ts") && !path.endsWith(".d.ts");
}

/** Report of a saved-brain origin rename. */
export interface StdlibBrainOriginMigrationReport {
  /** True when at least one symbol reference's origin was rewritten. */
  changed: boolean;
}

/** The three separators that immediately follow a namespace in a symbol key: binding, public, and id-keyed. */
const ORIGIN_BOUNDARIES = [":/", "::", ":user."] as const;

/**
 * Rewrite occurrences of any interim origin token in one string to the final
 * origin, only where the token is immediately followed by a symbol-key
 * boundary (`:/`, `::`, or `:user.`), so a coincidental substring elsewhere is
 * never touched. Idempotent: the final origin is not itself an interim origin
 * before a boundary, so a re-run is a no-op.
 */
function rewriteOriginInString(value: string, redirects: readonly StdlibImportRedirect[]): string {
  let next = value;
  for (const redirect of redirects) {
    for (const interimOrigin of redirect.interimOrigins) {
      for (const boundary of ORIGIN_BOUNDARIES) {
        next = next.split(`${interimOrigin}${boundary}`).join(`${redirect.toOrigin}${boundary}`);
      }
    }
  }
  return next;
}

/** Recursively rewrite interim origins in every string of a plain (JSON.parse'd) value, mutating in place. */
function rewriteOrigins(node: unknown, redirects: readonly StdlibImportRedirect[], report: { changed: boolean }): void {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const child = node[i];
      if (typeof child === "string") {
        const rewritten = rewriteOriginInString(child, redirects);
        if (rewritten !== child) {
          node[i] = rewritten;
          report.changed = true;
        }
      } else {
        rewriteOrigins(child, redirects, report);
      }
    }
    return;
  }
  if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const child = record[key];
      if (typeof child === "string") {
        const rewritten = rewriteOriginInString(child, redirects);
        if (rewritten !== child) {
          record[key] = rewritten;
          report.changed = true;
        }
      } else {
        rewriteOrigins(child, redirects, report);
      }
    }
  }
}

/**
 * Rewrite any prior stdlib origin (e.g. `embedded:wodal-stdlib`) to its final
 * `<owner>/<repo>` coordinate origin in every saved-brain symbol reference,
 * mutating the plain (JSON.parse'd) brain document in place. Only origin tokens
 * immediately preceding a symbol-key boundary are rewritten, so unrelated
 * strings are untouched. Idempotent: a brain already on the final origin is a
 * no-op.
 */
export function migrateStdlibBrainOrigins(
  json: unknown,
  redirects: readonly StdlibImportRedirect[]
): StdlibBrainOriginMigrationReport {
  const report = { changed: false };
  rewriteOrigins(json, redirects, report);
  return report;
}

/**
 * Migrate one project's user-code imports and manifest extensions onto an
 * embedded extension's final `<owner>/<repo>` coordinate. Rewrites every `.ts`
 * file whose imports name a legacy path or the interim entry surface, reports
 * the coordinate-keyed extensions to backfill, and reports the interim manifest
 * keys to remove.
 *
 * The result is non-destructive input to a caller that persists only after a
 * clean load: a project already on the final `@ext/<owner>/<repo>` coordinate
 * produces no file change, and a manifest already carrying the coordinate key
 * with no interim key produces no manifest change, so re-running is a no-op. A
 * project that never imported the stdlib still receives the coordinate backfill
 * for consistency.
 */
export function migrateStdlibImports(
  files: ReadonlyMap<string, string>,
  extensions: Readonly<Record<string, string>> | undefined,
  redirects: readonly StdlibImportRedirect[]
): StdlibImportMigrationResult {
  const changedFiles = new Map<string, string>();
  for (const [path, content] of files) {
    if (!isUserTsFile(path)) {
      continue;
    }
    const rewritten = rewriteSource(content, redirects);
    if (rewritten !== undefined) {
      changedFiles.set(path, rewritten);
    }
  }

  const manifestBackfill: Record<string, string> = {};
  const manifestRemovals: string[] = [];
  for (const redirect of redirects) {
    if (extensions?.[redirect.toCoordinate] === undefined) {
      manifestBackfill[redirect.toCoordinate] = redirect.toReference;
    }
    for (const interimKey of redirect.interimManifestKeys) {
      if (extensions?.[interimKey] !== undefined) {
        manifestRemovals.push(interimKey);
      }
    }
  }

  return {
    changedFiles,
    manifestBackfill,
    manifestRemovals,
    changed: changedFiles.size > 0 || Object.keys(manifestBackfill).length > 0 || manifestRemovals.length > 0,
  };
}
