/**
 * Key mints for symbols derived from user-project content. Every symbol a
 * project contributes to the shared registries is keyed under the project's
 * namespace:
 *
 * - Binding-keyed symbols (types, Systems): `<namespace>:<file>::<binding>`,
 *   where `<file>` is the project-relative compiler path (always starting
 *   with `/`).
 * - Id-keyed symbols (actions, private arg tiles): `<namespace>:user.<...>`.
 * - Public (entry-published) symbols: `<namespace>::<name>`, where `<name>`
 *   is the name the project's entry module exports the declaration under.
 *   A public key is an added alias: it resolves to the same registration as
 *   the declaration's binding-keyed private key.
 *
 * The namespace is the owning project's identity: a host project's store id,
 * or an extension's `<owner>/<repo>` coordinate. A namespace may itself
 * contain `:`; keys stay parseable because a namespace never contains
 * `:/`, and the id-keyed local part always starts with `user.`: the
 * namespace ends at the first `:/` for binding-keyed symbols and at the last
 * `:user.` for id-keyed symbols. Platform symbols (core types, host tiles,
 * operator tiles) keep their unprefixed well-known ids and never contain
 * these markers.
 */

import { type ActionKind, mkPrivateArgId, mkScopedOutputName, mkUserActionKey } from "@mindcraft-lang/core/runtime";

/**
 * Registry name of a user-declared type or System: the project namespace, the
 * declaring file, and the binding name.
 */
export function qualifiedClassName(projectNamespace: string, fileName: string, className: string): string {
  return `${projectNamespace}:${fileName}::${className}`;
}

/**
 * Public registry key of an entry-published symbol: the publishing project's
 * namespace and the name its entry module exports the declaration under.
 */
export function publicSymbolKey(projectNamespace: string, exportedName: string): string {
  return `${projectNamespace}::${exportedName}`;
}

/** Parsed parts of a binding-keyed private symbol key. */
export interface QualifiedClassNameParts {
  /** The owning project's namespace. */
  namespace: string;
  /** Project-relative compiler path of the declaring file (starts with `/`). */
  fileName: string;
  /** The declared binding name. */
  binding: string;
}

/**
 * Parse a registry name of the `<namespace>:<file>::<binding>` form, or
 * return undefined for any other name (platform names, public keys, and
 * derived structural names such as unions, instantiations, and anonymous
 * structs, which carry delimiter characters a key never contains).
 */
export function parseQualifiedClassName(name: string): QualifiedClassNameParts | undefined {
  if (/[<>{},&|()?\s]/.test(name)) return undefined;
  const fileStart = name.indexOf(":/");
  if (fileStart < 0) return undefined;
  const bindingStart = name.lastIndexOf("::");
  if (bindingStart <= fileStart + 1) return undefined;
  return {
    namespace: name.slice(0, fileStart),
    fileName: name.slice(fileStart + 1, bindingStart),
    binding: name.slice(bindingStart + 2),
  };
}

/** Action key of a compiled user tile or conversion. */
export function userActionKey(projectNamespace: string, kind: ActionKind, id: string): string {
  return mkUserActionKey(projectNamespace, kind, id);
}

/**
 * Tile id of a private (bare-named) parameter or modifier arg, scoped by the
 * declaring action's stable id under the project namespace.
 */
export function privateArgTileId(projectNamespace: string, actionId: string, argName: string): string {
  return mkPrivateArgId(projectNamespace, actionId, argName);
}

/**
 * Identity name of a user-declared sensor output: the declared output name
 * scoped by the declaring project's namespace. The scoped name is the name
 * half of the `(typeId, name)` output identity, so same-named outputs from
 * different projects never share a tile or a backing rule variable. Call
 * only for user-declared outputs.
 */
export function scopedOutputName(projectNamespace: string, outputName: string): string {
  return mkScopedOutputName(projectNamespace, outputName);
}
