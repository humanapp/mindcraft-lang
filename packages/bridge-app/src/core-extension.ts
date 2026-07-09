/**
 * The core layer's `<owner>/<repo>` coordinate: its identity, its compiler
 * namespace, and the name it is imported and stored under
 * (`@ext/mindcraft-lang/core`). The single shared language base at the bottom of
 * every Mindcraft platform's stack.
 */
export const CORE_LIB_COORDINATE = "mindcraft-lang/core";

/** Manifest reference form delivering the core layer from a host application's embed record. */
export const CORE_LIB_REFERENCE = "embedded:mindcraft-lang/core";
