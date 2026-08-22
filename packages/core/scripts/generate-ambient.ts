import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type CoreAppModule = {
  coreModule: () => unknown;
  createWendooEnvironment: (options: { modules: readonly unknown[] }) => {
    readonly brainServices: { readonly runtime: { readonly types: unknown } };
  };
};

type AmbientGeneratorModule = {
  buildCoreAmbientDeclarations: (registry: unknown) => string;
};

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ambientPath = resolve(packageDir, "lib/wendoo.core.d.ts");

async function main(): Promise<void> {
  const coreApp = (await import(
    pathToFileURL(resolve(packageDir, "dist/node/app/index.js")).toString()
  )) as CoreAppModule;
  const ambientGenerator = (await import(
    pathToFileURL(resolve(packageDir, "../ts-compiler/dist/index.js")).toString()
  )) as AmbientGeneratorModule;

  const environment = coreApp.createWendooEnvironment({ modules: [coreApp.coreModule()] });
  const ambient = ambientGenerator.buildCoreAmbientDeclarations(environment.brainServices.runtime.types);

  writeFileSync(ambientPath, ambient, "utf8");

  console.log(`ambient: generated ${ambientPath}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
