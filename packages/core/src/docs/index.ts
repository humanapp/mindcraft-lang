// ---------------------------------------------------------------------------
// Core documentation public API.
//
// - Manifest (metadata): always available, no locale dependency
// - Content (markdown strings): imported per locale from _generated/
//
// Typical usage:
//   import { coreTileDocs, coreConceptDocs } from "@mindcraft-lang/core/docs";
//   import { tileContent, conceptContent } from "@mindcraft-lang/core/docs/en";
// ---------------------------------------------------------------------------

export type { CoreConceptDocMeta, CoreTileDocMeta } from "./manifest";
export { coreConceptDocs, coreTileDocs } from "./manifest";
