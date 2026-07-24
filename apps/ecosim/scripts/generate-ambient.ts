import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core/app";
import { buildPlatformAmbientDeclarations } from "@mindcraft-lang/ts-compiler";
import { createEcosimModule } from "@/brain";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ambientPath = resolve(appDir, "lib/mindcraft.ecosim.d.ts");

const coreEnvironment = createMindcraftEnvironment({ modules: [coreModule()] });
const ecosimEnvironment = createMindcraftEnvironment({ modules: [coreModule(), createEcosimModule()] });

const ambient = buildPlatformAmbientDeclarations(
  coreEnvironment.brainServices.runtime.types,
  ecosimEnvironment.brainServices.runtime.types
);

writeFileSync(ambientPath, ambient, "utf8");

console.log(`ambient: generated ${ambientPath}`);
