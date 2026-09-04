import type { CompiledRoot } from "@wendoo/core";
import type { TileProvenance } from "@wendoo/core/brain";

/**
 * Which libraries a session may show the model the long-form documentation of,
 * as the host configures it.
 */
export interface CatalogFeaturing {
  /**
   * Namespaces of the featured libraries, each an `<owner>/<repo>` coordinate.
   * An empty set features none.
   */
  readonly featured: ReadonlySet<string>;
  /**
   * Namespace of the host project's own compilation root, whose tiles the
   * session always reads in full. Absent while the session authors no project
   * of its own.
   */
  readonly hostNamespace?: string;
}

/**
 * Namespaces whose tiles may show their long-form documentation: the host
 * project's own, every featured namespace, and every member of a featured
 * root's closure. The host's root admits only itself, never the libraries it
 * depends on.
 */
function admissibleNamespaces(roots: readonly CompiledRoot[], featuring: CatalogFeaturing): Set<string> {
  const admissible = new Set(featuring.featured);
  if (featuring.hostNamespace !== undefined) admissible.add(featuring.hostNamespace);
  for (const root of roots) {
    if (!featuring.featured.has(root.namespace)) continue;
    for (const member of root.closure) admissible.add(member);
  }
  return admissible;
}

/**
 * Whether a tile owned by `provenance` may show the model its long-form
 * documentation: true when every owning namespace is the host project's own, is
 * featured, or is in the closure of a featured root. A tile carrying no
 * provenance came from a module the environment installed, and is always
 * admitted. Absent `featuring` features none and names no host, so every
 * bundle tile is withheld.
 *
 * @param roots Compilation roots of the bundle the environment holds.
 */
export function admitsLongFormDocs(
  provenance: TileProvenance | undefined,
  roots: readonly CompiledRoot[],
  featuring: CatalogFeaturing | undefined
): boolean {
  if (provenance === undefined) return true;
  if (featuring === undefined) return false;
  const admissible = admissibleNamespaces(roots, featuring);
  return provenance.owners.every((owner) => admissible.has(owner));
}
