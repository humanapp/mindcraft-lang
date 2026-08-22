import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { coreModule, createWendooEnvironment } from "@wendoo-lang/core/app";
import { buildCoreAmbientDeclarations, buildPlatformAmbientDeclarations } from "@wendoo-lang/ts-compiler";
import { createEcosimModule } from "../brain";

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function readPackageText(specifier: string): string {
  return readFileSync(fileURLToPath(import.meta.resolve(specifier)), "utf8");
}

test("checked-in ambient declarations match generated core and sim declarations", () => {
  const coreEnvironment = createWendooEnvironment({ modules: [coreModule()] });
  const ecosimEnvironment = createWendooEnvironment({ modules: [coreModule(), createEcosimModule()] });

  const coreAmbient = buildCoreAmbientDeclarations(coreEnvironment.brainServices.runtime.types);
  const ecosimAmbient = buildPlatformAmbientDeclarations(
    coreEnvironment.brainServices.runtime.types,
    ecosimEnvironment.brainServices.runtime.types
  );

  assert.equal(readPackageText("@wendoo-lang/core/lib/wendoo.core.d.ts"), coreAmbient);
  assert.equal(readText("../../lib/wendoo.ecosim.d.ts"), ecosimAmbient);
});
