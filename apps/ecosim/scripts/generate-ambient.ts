import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coreModule, createWendooEnvironment } from "@wendoo-lang/core/app";
import { buildPlatformAmbientDeclarations } from "@wendoo-lang/ts-compiler";
import { createEcosimModule } from "@/brain";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ambientPath = resolve(appDir, "lib/wendoo.ecosim.d.ts");

const coreEnvironment = createWendooEnvironment({ modules: [coreModule()] });
const ecosimEnvironment = createWendooEnvironment({ modules: [coreModule(), createEcosimModule()] });

const ambient = buildPlatformAmbientDeclarations(
  coreEnvironment.brainServices.runtime.types,
  ecosimEnvironment.brainServices.runtime.types
);

writeFileSync(ambientPath, ambient, "utf8");

console.log(`ambient: generated ${ambientPath}`);
