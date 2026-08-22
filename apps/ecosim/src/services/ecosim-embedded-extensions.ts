import embeddedExtensionBundles from "virtual:wendoo-embedded-extensions";
import type { EmbeddedExtension } from "@wendoo/bridge-app";

export {
  CORE_LIB_COORDINATE,
  CORE_LIB_REFERENCE,
  ECOSIM_DETECT_EXT_COORDINATE,
  ECOSIM_LIB_COORDINATE,
  ECOSIM_LIB_REFERENCE,
  ECOSIM_TELEPORT_EXT_COORDINATE,
  ecosimDefaultExtensions,
} from "./ecosim-extension-coordinates";

/**
 * Extensions bundled with apps/ecosim, resolved from `embedded:<owner>/<repo>`
 * references. Each bundle is assembled at build time from its own extension's
 * `wendoo.json` `files` list; the app registers coordinates in its Vite
 * config and never enumerates an extension's files. The layer stack is
 * core <- sim; seeding the sim layer alone resolves both layers transitively
 * through the sim layer's bundled `wendoo.json` edge. The Teleport and Detect
 * add-ons are installable-on-demand entries and are not seeded by default.
 */
export const ecosimEmbeddedExtensions: readonly EmbeddedExtension[] = embeddedExtensionBundles;
