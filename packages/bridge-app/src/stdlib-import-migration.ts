import { EXTENSION_IMPORT_PREFIX } from "@mindcraft-lang/ts-compiler";

/**
 * One redirect from a legacy workspace-path import specifier (e.g.
 * `stdlib/image`) to an embedded extension: matching import specifiers are
 * rewritten to the extension's `@ext/<slug>` entry surface and the extension
 * dependency is backfilled into the manifest.
 */
export interface StdlibImportRedirect {
  /**
   * Legacy specifier prefix a user import began with, without a trailing
   * slash (e.g. `stdlib`). `stdlib` matches `stdlib` and `stdlib/image`.
   */
  fromPrefix: string;
  /** Extension slug the rewritten specifier addresses via `@ext/<slug>`. */
  toSlug: string;
  /** Dependency slug backfilled into the manifest extensions list. */
  backfillSlug: string;
  /** Extension reference string recorded for {@link backfillSlug}. */
  backfillReference: string;
}

/** Result of migrating one project's user-code imports and manifest. */
export interface StdlibImportMigrationResult {
  /** Rewritten file content keyed by workspace path; only changed files appear. */
  changedFiles: ReadonlyMap<string, string>;
  /** Extensions to add to the manifest, keyed by slug; empty when none are needed. */
  manifestBackfill: Readonly<Record<string, string>>;
  /** True when any file or the manifest changed. */
  changed: boolean;
}

const IMPORT_FROM_PATTERN = /(\bfrom\s*|\bimport\s*)(["'])([^"']+)(["'])/g;

/** Whether `specifier` addresses the legacy path named by `redirect`. */
function matchesRedirect(specifier: string, redirect: StdlibImportRedirect): boolean {
  return specifier === redirect.fromPrefix || specifier.startsWith(`${redirect.fromPrefix}/`);
}

/**
 * The extension's published entry surface `@ext/<slug>`. Every legacy subpath
 * maps to this single entry, which re-exports the extension's helpers; only the
 * entry surface is importable from a consuming project.
 */
function rewriteSpecifier(redirect: StdlibImportRedirect): string {
  return `${EXTENSION_IMPORT_PREFIX}${redirect.toSlug}`;
}

/** Rewrite every legacy stdlib import specifier in one `.ts` source, or return undefined when unchanged. */
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

/**
 * Migrate one project's user-code imports and manifest extensions from legacy
 * workspace-path stdlib imports to the embedded-extension form. Rewrites every
 * `.ts` file whose imports name a redirected legacy path, and reports the
 * manifest extensions to backfill.
 *
 * The result is non-destructive input to a caller that persists only after a
 * clean load: a project already on `@ext/<slug>` produces no file changes, and
 * a manifest already carrying the backfill slug produces no manifest change,
 * so re-running is a no-op. A project that never imported the stdlib still
 * receives the manifest backfill for consistency.
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
  for (const redirect of redirects) {
    if (extensions?.[redirect.backfillSlug] === undefined) {
      manifestBackfill[redirect.backfillSlug] = redirect.backfillReference;
    }
  }

  return {
    changedFiles,
    manifestBackfill,
    changed: changedFiles.size > 0 || Object.keys(manifestBackfill).length > 0,
  };
}
