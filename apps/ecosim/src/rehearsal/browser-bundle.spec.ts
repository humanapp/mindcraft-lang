import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Plugin, Rollup } from "vite";
import { build } from "vite";
import { rehearsalDefines } from "./source-content";

/** The app directory, from this module's own location. */
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The module the app imports to construct its target adapter in the browser. */
const BROWSER_ENTRY = join(APP_DIR, "src", "rehearsal", "adapter.ts");

/** Marker Vite resolves a Node builtin to when it builds for a browser. */
const BROWSER_EXTERNAL = "__vite-browser-external";

/** True when `source` names a Node builtin, with or without its `node:` prefix. */
function isNodeBuiltin(source: string): boolean {
  return source.startsWith("node:") || builtinModules.includes(source);
}

/**
 * Records every Node builtin the graph asks for, at the point the request is
 * made and before any bundler substitutes a stand-in for it.
 */
function recordNodeBuiltins(reached: string[]): Plugin {
  return {
    name: "record-node-builtins",
    enforce: "pre",
    resolveId(source, importer) {
      if (isNodeBuiltin(source)) reached.push(`${source} from ${importer ?? "the entry"}`);
      return undefined;
    },
  };
}

/** Bundle `BROWSER_ENTRY` for a browser, returning the reached builtins and the emitted code. */
async function bundleForBrowser(): Promise<{ reached: string[]; code: string }> {
  const reached: string[] = [];
  const built = (await build({
    configFile: false,
    logLevel: "silent",
    plugins: [recordNodeBuiltins(reached)],
    resolve: {
      alias: {
        "@": resolve(APP_DIR, "src"),
        "@mindcraft-lang/docs": resolve(APP_DIR, "../../packages/docs/src"),
        "@mindcraft-lang/ui": resolve(APP_DIR, "../../packages/ui/src"),
      },
    },
    define: rehearsalDefines(),
    publicDir: false,
    build: {
      write: false,
      minify: false,
      lib: { entry: BROWSER_ENTRY, formats: ["es"], fileName: () => "adapter.js" },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[];

  const code = (Array.isArray(built) ? built : [built])
    .flatMap((output) => output.output)
    .map((chunk) => (chunk.type === "chunk" ? chunk.code : String(chunk.source)))
    .join("\n");
  return { reached, code };
}

describe("the ecosim adapter bundled for a browser", () => {
  test("builds, and reaches no Node builtin on the way", async () => {
    const { reached, code } = await bundleForBrowser();

    assert.deepEqual(reached, [], "the browser module graph reaches Node builtins");
    assert.equal(code.includes(BROWSER_EXTERNAL), false, "the bundle carries a stand-in for a Node builtin");
    assert.ok(
      code.includes(rehearsalDefines().TARGET_IDENTITY ?? ""),
      "the bundle carries the target identity the build injected"
    );
  });
});
