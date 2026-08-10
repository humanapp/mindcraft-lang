/**
 * What a target adapter is built from and runs on: the seeded rehearsal
 * environment, the run loop over a world driver, and the tile-documentation
 * pairing.
 *
 * Every module this entry reaches is free of Node builtins, so an adapter that
 * imports only from here bundles for a browser as it stands.
 */

export type { RehearsalEnvironmentOptions } from "./environment.js";
export { createRehearsalEnvironment, createSeededRng } from "./environment.js";
export type {
  RehearsalAdapterOptions,
  RehearsalWorld,
  RunningSubject,
  WorldDriver,
  WorldStaging,
} from "./rehearsal-adapter.js";
export {
  createRehearsalAdapter,
  RehearsalRejection,
  RehearsalRejectionCode,
  ScenarioRejection,
  ScenarioRejectionCode,
} from "./rehearsal-adapter.js";
export type { TileDocContent, TileDocEntry } from "./tile-docs.js";
export { pairTileDocs } from "./tile-docs.js";
