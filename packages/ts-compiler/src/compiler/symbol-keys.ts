/**
 * Key mints for symbols derived from user-project content. Every symbol a
 * project contributes to the shared registries is keyed under the project's
 * namespace:
 *
 * - Binding-keyed symbols (types, Systems): `<namespace>:<file>::<binding>`,
 *   where `<file>` is the project-relative compiler path (always starting
 *   with `/`).
 * - Id-keyed symbols (actions, private arg tiles): `<namespace>:user.<...>`.
 *
 * The namespace is the owning project's identity: a host project's store id,
 * or an extension's origin (for example `gh:<owner>/<repo>`). A namespace may
 * itself contain `:`; keys stay parseable because a namespace never contains
 * `:/`, and the id-keyed local part always starts with `user.`: the
 * namespace ends at the first `:/` for binding-keyed symbols and at the last
 * `:user.` for id-keyed symbols. Platform symbols (core types, host tiles,
 * operator tiles) keep their unprefixed well-known ids and never contain
 * these markers.
 */

/**
 * Registry name of a user-declared type or System: the project namespace, the
 * declaring file, and the binding name.
 */
export function qualifiedClassName(projectNamespace: string, fileName: string, className: string): string {
  return `${projectNamespace}:${fileName}::${className}`;
}

/** Action key of a compiled user tile or conversion. */
export function userActionKey(
  projectNamespace: string,
  kind: "sensor" | "actuator" | "conversion",
  id: string
): string {
  return `${projectNamespace}:user.${kind}.${id}`;
}

/**
 * Tile id of a private (bare-named) parameter or modifier arg, scoped by the
 * declaring action's stable id under the project namespace.
 */
export function privateArgTileId(projectNamespace: string, actionId: string, argName: string): string {
  return `${projectNamespace}:user.${actionId}.${argName}`;
}
