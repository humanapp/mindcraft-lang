/// <reference types="vite/client" />

declare module "virtual:mindcraft-embedded-extensions" {
  import type { EmbeddedExtension } from "@mindcraft-lang/bridge-app";
  /** Embedded-extension bundles assembled at build time from each extension's `mindcraft.json` `files` list. */
  const embeddedExtensionBundles: readonly EmbeddedExtension[];
  export default embeddedExtensionBundles;
}
