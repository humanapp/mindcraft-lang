/**
 * Dependency-mount path conventions for multi-root compilation. A consuming
 * project's compiler file map mounts each dependency's source files under a
 * namespace-derived prefix, so a declaration's compiler path identifies the
 * project that owns it. Symbol keys minted from a declaration always carry
 * the OWNING project's namespace and its project-relative path, never the
 * mount path, so a type imported through `@ext/<owner>/<repo>` resolves to the
 * declaring project's registration.
 */

import { qualifiedClassName } from "./symbol-keys.js";

/**
 * One entry of a project's extensions list: the dependency's `<owner>/<repo>`
 * coordinate. The coordinate is the dependency's identity, its compiler
 * namespace, and its import name all at once: `@ext/<owner>/<repo>` names it
 * the same way in every project, and its symbols register under the same
 * `<owner>/<repo>` namespace.
 */
export interface ProjectDependency {
  /**
   * The dependency's `<owner>/<repo>` coordinate: its identity, its compiler
   * namespace, and the name `@ext/<owner>/<repo>` in the depending project's
   * sources resolves to its entry module.
   */
  coordinate: string;
}

/** A dependency project's content, mounted read-only into a consuming project's compilation. */
export interface DependencyMount {
  /** The mounted project's namespace. */
  namespace: string;
  /** The mounted project's source files, keyed by project-relative path. */
  files: ReadonlyMap<string, string>;
  /** The mounted project's own extensions list, resolving `@ext/<owner>/<repo>` imports inside its files. */
  dependencies?: readonly ProjectDependency[];
}

/** Import-specifier prefix for extension imports: `@ext/<owner>/<repo>` resolves to the dependency's entry module. */
export const EXTENSION_IMPORT_PREFIX = "@ext/";

/**
 * Split the part after `@ext/` into its coordinate `<owner>/<repo>` and any
 * deep-import remainder. A valid extension specifier names exactly the two
 * coordinate segments; a third segment or beyond is a deep import into the
 * extension's internals.
 *
 * Returns the two-segment `coordinate` and, when present, the `deepPath`
 * (leading slash, e.g. `/internal`). Fewer than two segments yields an
 * `undefined` coordinate: the specifier names no extension.
 */
export function splitExtensionSpecifier(rest: string): { coordinate?: string; deepPath?: string } {
  const firstSlash = rest.indexOf("/");
  if (firstSlash < 0) {
    return {};
  }
  const secondSlash = rest.indexOf("/", firstSlash + 1);
  if (secondSlash < 0) {
    return { coordinate: rest };
  }
  return { coordinate: rest.slice(0, secondSlash), deepPath: rest.slice(secondSlash) };
}

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
 * consuming one -- resolves to one registration. A type imported through
 * `@ext/<owner>/<repo>` resolves to the declaring project's registration.
 */
export function qualifiedDeclarationName(localNamespace: string, fileName: string, binding: string): string {
  const mounted = parseMountedCompilerPath(fileName);
  if (mounted) {
    return qualifiedClassName(mounted.namespace, mounted.fileName, binding);
  }
  return qualifiedClassName(localNamespace, fileName, binding);
}
