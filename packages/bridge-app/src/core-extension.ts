/**
 * The core layer's `<owner>/<repo>` coordinate: its identity, its compiler
 * namespace, and the name it is imported and stored under
 * (`@lib/wendoo-lang/lib-core`). The single shared language base at the bottom of
 * every Wendoo platform's stack.
 */
export const CORE_LIB_COORDINATE = "wendoo-lang/lib-core";

/** Manifest reference form delivering the core layer from a host application's embed record. */
export const CORE_LIB_REFERENCE = "embedded:wendoo-lang/lib-core";
