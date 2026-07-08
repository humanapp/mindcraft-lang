import { buildCoreStdlibExtension, type EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import coreLibAmbient from "@mindcraft-lang/core/ambient/mindcraft.core.d.ts?raw";
import coreLibEntry from "@mindcraft-lang/core/lib/index.ts?raw";
import coreLibManifest from "@mindcraft-lang/core/lib/mindcraft.json?raw";
import simLibAmbient from "../../ambient/mindcraft.sim.d.ts?raw";
import simLibEntry from "../../lib/index.ts?raw";
import simLibManifest from "../../lib/mindcraft.json?raw";
import { SIM_LIB_COORDINATE } from "./sim-extension-coordinates";

export {
  CORE_LIB_COORDINATE,
  CORE_LIB_REFERENCE,
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
 * Extensions bundled with apps/sim, resolved from `embedded:<owner>/<repo>`
 * references. The stack is core <- sim; seeding the sim layer alone resolves
 * both transitively through the sim layer's bundled `mindcraft.json` edge.
 */
export const simEmbeddedExtensions: readonly EmbeddedExtension[] = [simStdlibExtension, coreStdlibExtension];
