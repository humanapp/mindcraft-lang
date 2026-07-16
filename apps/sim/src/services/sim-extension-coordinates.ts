export { CORE_LIB_COORDINATE, CORE_LIB_REFERENCE } from "@mindcraft-lang/bridge-app";

/**
 * The sim layer's `<owner>/<repo>` coordinate: its identity, its compiler
 * namespace, and the name it is imported and stored under
 * (`@lib/mindcraft-lang/sim`). The top of apps/sim's platform stack, carrying
 * the ecosystem simulation's `"mindcraft"` types; depends on the shared core
 * layer.
 */
export const SIM_LIB_COORDINATE = "mindcraft-lang/sim";

/** Manifest reference form delivering the sim layer from the app bundle. */
export const SIM_LIB_REFERENCE = "embedded:mindcraft-lang/sim";

/**
 * Coordinate of the Teleport add-on: an installable capability extension
 * publishing the `teleport` actuator for the sim platform. Opaque `<owner>/<repo>`
 * identity; the repo segment is human-readable and never parsed by code.
 */
export const ECOSIM_TELEPORT_EXT_COORDINATE = "mindcraft-lang/ecosim-teleport-ext";

/**
 * Coordinate of the Detect add-on: an installable capability extension publishing
 * the `detect` sensor for the sim platform. Opaque `<owner>/<repo>` identity; the
 * repo segment is human-readable and never parsed by code.
 */
export const ECOSIM_DETECT_EXT_COORDINATE = "mindcraft-lang/ecosim-detect-ext";

/**
 * Extensions seeded into every new apps/sim project's manifest, keyed by
 * coordinate. Seeding the sim layer alone is enough: its bundled `mindcraft.json`
 * declares the edge to the core layer, so transitive resolution pulls both into
 * the project.
 */
export const simDefaultExtensions: Readonly<Record<string, string>> = {
  [SIM_LIB_COORDINATE]: SIM_LIB_REFERENCE,
};
