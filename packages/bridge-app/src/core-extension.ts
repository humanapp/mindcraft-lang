import type { EmbeddedExtension } from "./embedded-extensions.js";

/**
 * The core layer's `<owner>/<repo>` coordinate: its identity, its compiler
 * namespace, and the name it is imported and stored under
 * (`@ext/mindcraft-lang/core`). The single shared language base at the bottom of
 * every Mindcraft platform's stack.
 */
export const CORE_LIB_COORDINATE = "mindcraft-lang/core";

/** Manifest reference form delivering the core layer from a host application's embed record. */
export const CORE_LIB_REFERENCE = "embedded:mindcraft-lang/core";

/**
 * The raw source content of the core layer's bundled files, supplied by the host
 * application. Each field is the full file text; the host reads it however its
 * bundler requires (a Vite `?raw` import in a browser app, a filesystem read in
 * a test).
 */
export interface CoreStdlibExtensionSource {
  /** Content of the core layer's empty entry placeholder (`index.ts`). */
  entry: string;
  /** Content of the core ambient `.d.ts` declaring the language globals and base `"mindcraft"` types. */
  ambient: string;
  /** Content of the core layer's `mindcraft.json`, declaring its ambient file. */
  manifest: string;
}

/**
 * Build the shared core layer as an embedded extension from the host's raw file
 * content, identified by {@link CORE_LIB_COORDINATE} at the base of the stack
 * with no further dependencies. The core coordinate, manifest, and file layout
 * are defined here; each host supplies its own bundler-read content.
 */
export function buildCoreStdlibExtension(source: CoreStdlibExtensionSource): EmbeddedExtension {
  return {
    canonicalOrigin: CORE_LIB_COORDINATE,
    files: [
      { path: "index.ts", content: source.entry },
      { path: "mindcraft.core.d.ts", content: source.ambient },
      { path: "mindcraft.json", content: source.manifest },
    ],
  };
}
