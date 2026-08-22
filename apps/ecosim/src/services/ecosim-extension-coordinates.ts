export { CORE_LIB_COORDINATE, CORE_LIB_REFERENCE } from "@wendoo-lang/bridge-app";

/**
 * The sim layer's `<owner>/<repo>` coordinate: its identity, its compiler
 * namespace, and the name it is imported and stored under
 * (`@lib/wendoo-lang/lib-ecosim`). The top of apps/ecosim's platform stack, carrying
 * the ecosystem simulation's `"wendoo"` types; depends on the shared core
 * layer.
 */
export const ECOSIM_LIB_COORDINATE = "wendoo-lang/lib-ecosim";

/** Manifest reference form delivering the sim layer from the app bundle. */
export const ECOSIM_LIB_REFERENCE = "embedded:wendoo-lang/lib-ecosim";

/**
 * The ecosim editor/hostApp target's `<owner>/<repo>` coordinate: the runnable
 * platform a project references. It carries no standard-library code; its
 * manifest declares an embedded dependency on {@link ECOSIM_LIB_COORDINATE}, so
 * the sim layer resolves transitively into a project's stack.
 */
export const ECOSIM_TARGET_COORDINATE = "wendoo-lang/trg-ecosim";

/** Manifest reference form delivering the ecosim target from the app bundle. */
export const ECOSIM_TARGET_REFERENCE = "embedded:wendoo-lang/trg-ecosim";

/**
 * Coordinate of the Teleport add-on: an installable capability extension
 * publishing the `teleport` actuator for the sim platform. Opaque `<owner>/<repo>`
 * identity; the repo segment is human-readable and never parsed by code.
 */
export const ECOSIM_TELEPORT_EXT_COORDINATE = "wendoo-lang/lib-ecosim-teleport";

/**
 * Coordinate of the Detect add-on: an installable capability extension publishing
 * the `detect` sensor for the sim platform. Opaque `<owner>/<repo>` identity; the
 * repo segment is human-readable and never parsed by code.
 */
export const ECOSIM_DETECT_EXT_COORDINATE = "wendoo-lang/lib-ecosim-detect";

/**
 * Extensions seeded into every new apps/ecosim project's manifest, keyed by
 * coordinate. Seeding the ecosim target alone is enough: its bundled
 * `wendoo.json` declares the edge to the sim layer, which declares the edge to
 * the core layer, so transitive resolution pulls the target and both layers into
 * the project.
 */
export const ecosimDefaultExtensions: Readonly<Record<string, string>> = {
  [ECOSIM_TARGET_COORDINATE]: ECOSIM_TARGET_REFERENCE,
};
