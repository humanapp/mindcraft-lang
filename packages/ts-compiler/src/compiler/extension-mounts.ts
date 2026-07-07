/**
 * Dependency-mount path conventions for multi-root compilation. A consuming
 * project's compiler file map mounts each dependency's source files under a
 * namespace-derived prefix, so a declaration's compiler path identifies the
 * project that owns it. Symbol keys minted from a declaration always carry
 * the OWNING project's namespace and its project-relative path, never the
 * mount path, so a type imported through `@ext/<slug>` resolves to the
 * declaring project's registration.
 */

import { qualifiedClassName } from "./symbol-keys.js";

/** One entry of a project's extensions list: a local import alias and the dependency's namespace. */
export interface ProjectDependency {
  /** Import alias: `@ext/<slug>` in the depending project's sources resolves to this dependency's entry module. */
  slug: string;
  /** The dependency project's namespace (its origin). */
  namespace: string;
}

/** A dependency project's content, mounted read-only into a consuming project's compilation. */
export interface DependencyMount {
  /** The mounted project's namespace. */
  namespace: string;
  /** The mounted project's source files, keyed by project-relative path. */
  files: ReadonlyMap<string, string>;
  /** The mounted project's own extensions list, resolving `@ext/<slug>` imports inside its files. */
  dependencies?: readonly ProjectDependency[];
}

/** Import-specifier prefix for extension imports: `@ext/<slug>` resolves to the dependency's entry module. */
export const EXTENSION_IMPORT_PREFIX = "@ext/";

const EXTENSION_MOUNT_PREFIX = "/__extensions__/";

/** Compiler-path root a dependency's files mount under in a consuming project. */
export function extensionMountRoot(namespace: string): string {
  return `${EXTENSION_MOUNT_PREFIX}${encodeURIComponent(namespace)}`;
}

/** Compiler path of a dependency file inside a consuming project's file map. */
export function mountedCompilerPath(namespace: string, filePath: string): string {
  const projectRelative = filePath.startsWith("/") ? filePath : `/${filePath}`;
  return `${extensionMountRoot(namespace)}${projectRelative}`;
}

/** A mounted compiler path split into its owning namespace and project-relative path. */
export interface MountedFileParts {
  /** Namespace of the project that owns the file. */
  namespace: string;
  /** The file's compiler path inside its own project (starts with `/`). */
  fileName: string;
}

/** Parse a compiler path under the dependency-mount prefix, or return undefined for a project-local path. */
export function parseMountedCompilerPath(fileName: string): MountedFileParts | undefined {
  if (!fileName.startsWith(EXTENSION_MOUNT_PREFIX)) return undefined;
  const rest = fileName.slice(EXTENSION_MOUNT_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return undefined;
  return {
    namespace: decodeURIComponent(rest.slice(0, slash)),
    fileName: rest.slice(slash),
  };
}

/**
 * Registry name of the type or System declared as `binding` in the file at
 * compiler path `fileName`: the declaring project's namespace and its
 * project-relative path. A project-local file keys under `localNamespace`;
 * a dependency-mounted file keys under the dependency's own namespace, so
 * every reference to the declaration -- from its own project or from a
 * consuming one -- resolves to one registration.
 */
export function qualifiedDeclarationName(localNamespace: string, fileName: string, binding: string): string {
  const mounted = parseMountedCompilerPath(fileName);
  if (mounted) {
    return qualifiedClassName(mounted.namespace, mounted.fileName, binding);
  }
  return qualifiedClassName(localNamespace, fileName, binding);
}
