import embeddedExtensionBundles from "virtual:mindcraft-embedded-extensions";
import type { EmbeddedExtension } from "@mindcraft-lang/bridge-app";

export {
  CORE_LIB_COORDINATE,
  CORE_LIB_REFERENCE,
  ECOSIM_DETECT_EXT_COORDINATE,
  ECOSIM_TELEPORT_EXT_COORDINATE,
  SIM_LIB_COORDINATE,
  SIM_LIB_REFERENCE,
  simDefaultExtensions,
} from "./sim-extension-coordinates";

/**
 * Extensions bundled with apps/sim, resolved from `embedded:<owner>/<repo>`
 * references. Each bundle is assembled at build time from its own extension's
 * `mindcraft.json` `files` list; the app registers coordinates in its Vite
 * config and never enumerates an extension's files. The layer stack is
 * core <- sim; seeding the sim layer alone resolves both layers transitively
 * through the sim layer's bundled `mindcraft.json` edge. The Teleport and Detect
 * add-ons are installable-on-demand entries and are not seeded by default.
 */
export const simEmbeddedExtensions: readonly EmbeddedExtension[] = embeddedExtensionBundles;
