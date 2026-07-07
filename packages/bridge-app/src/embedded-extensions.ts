import { parseExtensionReference } from "@mindcraft-lang/app-host";
import type { DependencyMount, ProjectDependency } from "@mindcraft-lang/ts-compiler";

/** One source file of an embedded extension, at its extension-relative path. */
export interface EmbeddedExtensionFile {
  /** Extension-relative path (e.g. `index.ts`). */
  path: string;
  /** Full file content. */
  content: string;
}

/**
 * One entry of a host application's embed record: an extension whose content is
 * bundled with the application, together with its canonical origin.
 */
export interface EmbeddedExtension {
  /** Import-alias segment: `@ext/<slug>` resolves to this extension's entry module. */
  slug: string;
  /**
   * Normalized origin string identifying this extension (its namespace),
   * matching the `embedded:<slug>` reference form the manifest records.
   */
  canonicalOrigin: string;
  /** The extension's source files, delivered as a read-only dependency mount. */
  files: readonly EmbeddedExtensionFile[];
}

/** Compiler inputs resolved from a project's extensions list and a host embed record. */
export interface ResolvedExtensions {
  /** Each project `@ext/<slug>` alias paired with its dependency namespace. */
  dependencies: readonly ProjectDependency[];
  /** Read-only content of every resolved dependency, mounted for `@ext/<slug>` resolution. */
  dependencyMounts: readonly DependencyMount[];
}

/**
 * Canonical `embedded:<slug>` origin for the extension with the given slug.
 * Embedded extensions carry this as their namespace.
 */
export function embeddedOrigin(slug: string): string {
  return `embedded:${slug}`;
}

function toDependencyMount(extension: EmbeddedExtension): DependencyMount {
  const files = new Map<string, string>();
  for (const file of extension.files) {
    files.set(file.path.startsWith("/") ? file.path : `/${file.path}`, file.content);
  }
  return { namespace: extension.canonicalOrigin, files };
}

/**
 * Resolve a project's extensions list against a host application's embed record
 * into the compiler dependency inputs. Only `embedded:<slug>` references whose
 * slug matches a bundled extension resolve; references of other transports and
 * unrecognized embedded slugs are skipped (an unresolved import surfaces later
 * as an ordinary compiler diagnostic).
 */
export function resolveEmbeddedExtensions(
  extensions: Readonly<Record<string, string>> | undefined,
  embedRecord: readonly EmbeddedExtension[]
): ResolvedExtensions {
  if (!extensions) {
    return { dependencies: [], dependencyMounts: [] };
  }
  const bySlug = new Map(embedRecord.map((extension) => [extension.slug, extension]));
  const dependencies: ProjectDependency[] = [];
  const dependencyMounts: DependencyMount[] = [];
  for (const [slug, reference] of Object.entries(extensions)) {
    const parsed = parseExtensionReference(reference);
    if (parsed === undefined || parsed.transport !== "embedded") {
      continue;
    }
    const extension = bySlug.get(parsed.slug);
    if (extension === undefined) {
      continue;
    }
    dependencies.push({ slug, namespace: extension.canonicalOrigin });
    dependencyMounts.push(toDependencyMount(extension));
  }
  return { dependencies, dependencyMounts };
}
