import coreAmbientContent from "@mindcraft-lang/core/ambient/mindcraft.core.d.ts?raw";
import type { AmbientFile } from "@mindcraft-lang/ts-compiler";
import simAmbientContent from "../../ambient/mindcraft.sim.d.ts?raw";

/** Ambient declaration files exposed to the user-code compiler and remote VFS. */
export const simAmbientFiles: readonly AmbientFile[] = [
  { path: "mindcraft.core.d.ts", content: coreAmbientContent },
  { path: "mindcraft.sim.d.ts", content: simAmbientContent },
];
