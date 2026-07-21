/**
 * Installed-extension path conventions for multi-root compilation. A consuming
 * project's resolved extensions materialize as read-only source under the
 * `.libraries/<owner>/<repo>/` tree, so a declaration's compiler path
 * identifies the extension that owns it. Symbol keys minted from a declaration
 * always carry the OWNING extension's coordinate namespace and its
 * coordinate-relative path, never the install path, so a type imported through
 * `@lib/<owner>/<repo>` resolves to the declaring extension's registration.
 */

import { qualifiedClassName } from "./symbol-keys.js";

/**
 * One entry of a project's extensions list: the dependency's `<owner>/<repo>`
 * coordinate. The coordinate is the dependency's identity, its compiler
 * namespace, and its import name all at once: `@lib/<owner>/<repo>` names it
 * the same way in every project, and its symbols register under the same
 * `<owner>/<repo>` namespace.
 */
export interface ProjectDependency {
  /**
   * The dependency's `<owner>/<repo>` coordinate: its identity, its compiler
   * namespace, and the name `@lib/<owner>/<repo>` in the depending project's
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
  /** The mounted project's own extensions list, resolving `@lib/<owner>/<repo>` imports inside its files. */
  dependencies?: readonly ProjectDependency[];
  /**
   * Namespace-relative paths of the mount's `.d.ts` files that are ambient
   * declarations: included as compiler roots always in scope for the type
   * checker. Each names one entry of {@link files}. Present only when the mount
   * declares ambient files.
   */
  ambient?: readonly string[];
}

/** Import-specifier prefix for extension imports: `@lib/<owner>/<repo>` resolves to the dependency's entry module. */
export const EXTENSION_IMPORT_PREFIX = "@lib/";

/**
 * Split the part after `@lib/` into its coordinate `<owner>/<repo>` and any
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

/**
 * Workspace directory under which a project's resolved extensions materialize
 * as read-only source, one `<owner>/<repo>` subtree per extension. The tree is
 * compiler-controlled and reproducible: it is regenerated from the resolved
 * extension set on load and excluded from the project's saved bytes.
 */
export const EXTENSIONS_DIR = ".libraries";

const EXTENSIONS_COMPILER_PREFIX = `/${EXTENSIONS_DIR}/`;

/** Compiler-path root the source of the extension at `coordinate` materializes under. */
export function extensionRoot(coordinate: string): string {
  return `${EXTENSIONS_COMPILER_PREFIX}${coordinate}`;
}

/**
 * Compiler path of an extension file: the extension's `coordinate` root joined
 * with the file's coordinate-relative `filePath` (a leading slash is added when
 * absent).
 */
export function extensionFilePath(coordinate: string, filePath: string): string {
  const relative = filePath.startsWith("/") ? filePath : `/${filePath}`;
  return `${extensionRoot(coordinate)}${relative}`;
}

/**
 * Workspace-relative path (no leading slash) of an extension file, for the
 * project VFS and workspace snapshots.
 */
export function extensionWorkspacePath(coordinate: string, filePath: string): string {
  const relative = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  return `${EXTENSIONS_DIR}/${coordinate}/${relative}`;
}

/** True for a workspace path inside the installed-extensions tree. */
export function isExtensionWorkspacePath(path: string): boolean {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  return normalized === EXTENSIONS_DIR || normalized.startsWith(`${EXTENSIONS_DIR}/`);
}

/** An extension compiler path split into its owning coordinate and coordinate-relative path. */
export interface ExtensionPathParts {
  /** The `<owner>/<repo>` coordinate of the extension that owns the file: its namespace. */
  namespace: string;
  /** The file's path inside the extension (starts with `/`). */
  fileName: string;
}

/**
 * Parse a compiler path under the installed-extensions tree into the owning
 * `<owner>/<repo>` coordinate and the coordinate-relative path, or return
 * undefined for a project-local path. A coordinate is exactly two segments;
 * fewer names no extension.
 */
export function parseExtensionCompilerPath(fileName: string): ExtensionPathParts | undefined {
  if (!fileName.startsWith(EXTENSIONS_COMPILER_PREFIX)) return undefined;
  const rest = fileName.slice(EXTENSIONS_COMPILER_PREFIX.length);
  const firstSlash = rest.indexOf("/");
  if (firstSlash < 0) return undefined;
  const secondSlash = rest.indexOf("/", firstSlash + 1);
  if (secondSlash < 0) return undefined;
  return { namespace: rest.slice(0, secondSlash), fileName: rest.slice(secondSlash) };
}

/**
 * Registry name of the type or System declared as `binding` in the file at
 * compiler path `fileName`: the declaring project's namespace and its
 * project-relative path. A project-local file keys under `localNamespace`; a
 * file inside the installed-extensions tree keys under its extension's own
 * coordinate namespace, so every reference to the declaration -- from its own
 * project or from a consuming one -- resolves to one registration. A type
 * imported through `@lib/<owner>/<repo>` resolves to the declaring extension's
 * registration.
 */
export function qualifiedDeclarationName(localNamespace: string, fileName: string, binding: string): string {
  const extension = parseExtensionCompilerPath(fileName);
  if (extension) {
    return qualifiedClassName(extension.namespace, extension.fileName, binding);
  }
  return qualifiedClassName(localNamespace, fileName, binding);
}
