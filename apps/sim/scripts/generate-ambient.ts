import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core/app";
import { buildPlatformAmbientDeclarations } from "@mindcraft-lang/ts-compiler";
import { createSimModule } from "@/brain";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ambientPath = resolve(appDir, "ambient/mindcraft.sim.d.ts");

const coreEnvironment = createMindcraftEnvironment({ modules: [coreModule()] });
const simEnvironment = createMindcraftEnvironment({ modules: [coreModule(), createSimModule()] });

const ambient = buildPlatformAmbientDeclarations(
  coreEnvironment.brainServices.runtime.types,
  simEnvironment.brainServices.runtime.types
);

writeFileSync(ambientPath, ambient, "utf8");

console.log(`ambient: generated ${ambientPath}`);
