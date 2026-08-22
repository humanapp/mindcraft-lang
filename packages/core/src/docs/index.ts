// ---------------------------------------------------------------------------
// Core documentation public API.
//
// - Manifest (metadata): always available, no locale dependency
// - Content (markdown strings): imported per locale from "./docs/{locale}"
//
// Typical usage:
//   import { coreTileDocs, coreConceptDocs } from "@wendoo-lang/core/docs";
//   import { tileContent, conceptContent } from "@wendoo-lang/core/docs/en";
// ---------------------------------------------------------------------------

export type { CoreConceptDocMeta, CoreTileDocMeta } from "./manifest";
export { coreConceptDocs, coreTileDocs } from "./manifest";
