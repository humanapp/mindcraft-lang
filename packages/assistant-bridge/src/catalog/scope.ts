/** Which of an authoring workspace's catalogs a tile came from. */
export const CatalogScope = {
  /** The vocabulary the environment installs: core, the target's modules, and the project's libraries. */
  Environment: "environment",
  /** Tiles the brain document minted for itself: its page tiles, its variables, and the literals it minted. */
  Document: "document",
} as const;

/** Which of an authoring workspace's catalogs a tile came from. */
export type CatalogScope = (typeof CatalogScope)[keyof typeof CatalogScope];
