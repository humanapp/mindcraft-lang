import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core/app";
import { buildCoreAmbientDeclarations, buildPlatformAmbientDeclarations } from "@mindcraft-lang/ts-compiler";
import { createSimModule } from "../brain";

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function readPackageText(specifier: string): string {
  return readFileSync(fileURLToPath(import.meta.resolve(specifier)), "utf8");
}

test("checked-in ambient declarations match generated core and sim declarations", () => {
  const coreEnvironment = createMindcraftEnvironment({ modules: [coreModule()] });
  const simEnvironment = createMindcraftEnvironment({ modules: [coreModule(), createSimModule()] });

  const coreAmbient = buildCoreAmbientDeclarations(coreEnvironment.brainServices.runtime.types);
  const simAmbient = buildPlatformAmbientDeclarations(
    coreEnvironment.brainServices.runtime.types,
    simEnvironment.brainServices.runtime.types
  );

  assert.equal(readPackageText("@mindcraft-lang/core/lib/mindcraft.core.d.ts"), coreAmbient);
  assert.equal(readText("../../lib/mindcraft.sim.d.ts"), simAmbient);
});
