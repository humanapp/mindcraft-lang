import { buildCoreStdlibExtension, type EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import coreLibAmbient from "@mindcraft-lang/core/ambient/mindcraft.core.d.ts?raw";
import coreLibEntry from "@mindcraft-lang/core/lib/index.ts?raw";
import coreLibManifest from "@mindcraft-lang/core/lib/mindcraft.json?raw";
import simLibAmbient from "../../ambient/mindcraft.sim.d.ts?raw";
import detectExtDocs from "../../extensions/ecosim-detect-ext/detect.md?raw";
import detectExtIcon from "../../extensions/ecosim-detect-ext/detect.svg?raw";
import detectExtDef from "../../extensions/ecosim-detect-ext/detect.ts?raw";
import detectExtManifest from "../../extensions/ecosim-detect-ext/mindcraft.json?raw";
import teleportExtManifest from "../../extensions/ecosim-teleport-ext/mindcraft.json?raw";
import teleportExtDocs from "../../extensions/ecosim-teleport-ext/teleport.md?raw";
import teleportExtIcon from "../../extensions/ecosim-teleport-ext/teleport.svg?raw";
import teleportExtDef from "../../extensions/ecosim-teleport-ext/teleport.ts?raw";
import simLibEntry from "../../lib/index.ts?raw";
import simLibManifest from "../../lib/mindcraft.json?raw";
import {
  ECOSIM_DETECT_EXT_COORDINATE,
  ECOSIM_TELEPORT_EXT_COORDINATE,
  SIM_LIB_COORDINATE,
} from "./sim-extension-coordinates";

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
 * The shared core layer as an embedded extension, built from the app's bundled
 * `?raw` content through the shared core-extension builder, at the base of the
 * stack with no further dependencies. Its bundled `mindcraft.json` declares the
 * ambient file.
 */
export const coreStdlibExtension: EmbeddedExtension = buildCoreStdlibExtension({
  entry: coreLibEntry,
  ambient: coreLibAmbient,
  manifest: coreLibManifest,
});

/**
 * The sim platform layer as an embedded extension: the ecosystem simulation's
 * `"mindcraft"` ambient `.d.ts` (`Vector2`, `ActorRef`, `Context`) over an empty
 * entry placeholder, identified by the canonical `mindcraft-lang/sim`
 * coordinate. Its bundled `mindcraft.json` declares the ambient file and the
 * edge down to the core layer.
 */
export const simStdlibExtension: EmbeddedExtension = {
  canonicalOrigin: SIM_LIB_COORDINATE,
  files: [
    { path: "index.ts", content: simLibEntry },
    { path: "mindcraft.sim.d.ts", content: simLibAmbient },
    { path: "mindcraft.json", content: simLibManifest },
  ],
};

/**
 * The Teleport add-on as an embedded extension: the `teleport` actuator def with
 * its bundled icon and docs assets, over the `mindcraft.json` declaring its name,
 * version, and sim-platform compatibility target. Installable on a sim project;
 * excluded from platforms whose stack lacks the sim layer.
 */
export const teleportAddonExtension: EmbeddedExtension = {
  canonicalOrigin: ECOSIM_TELEPORT_EXT_COORDINATE,
  files: [
    { path: "teleport.ts", content: teleportExtDef },
    { path: "teleport.svg", content: teleportExtIcon },
    { path: "teleport.md", content: teleportExtDocs },
    { path: "mindcraft.json", content: teleportExtManifest },
  ],
};

/**
 * The Detect add-on as an embedded extension: the `detect` sensor def with its
 * bundled icon and docs assets, over the `mindcraft.json` declaring its name,
 * version, and sim-platform compatibility target. Installable on a sim project;
 * excluded from platforms whose stack lacks the sim layer.
 */
export const detectAddonExtension: EmbeddedExtension = {
  canonicalOrigin: ECOSIM_DETECT_EXT_COORDINATE,
  files: [
    { path: "detect.ts", content: detectExtDef },
    { path: "detect.svg", content: detectExtIcon },
    { path: "detect.md", content: detectExtDocs },
    { path: "mindcraft.json", content: detectExtManifest },
  ],
};

/**
 * Extensions bundled with apps/sim, resolved from `embedded:<owner>/<repo>`
 * references. The layer stack is core <- sim; seeding the sim layer alone
 * resolves both layers transitively through the sim layer's bundled
 * `mindcraft.json` edge. The Teleport and Detect add-ons are in the embed record
 * as installable-on-demand entries; they are not seeded by default.
 */
export const simEmbeddedExtensions: readonly EmbeddedExtension[] = [
  simStdlibExtension,
  coreStdlibExtension,
  teleportAddonExtension,
  detectAddonExtension,
];
