/// <reference types="vite/client" />

declare module "virtual:wendoo-embedded-extensions" {
  import type { EmbeddedExtension } from "@wendoo-lang/bridge-app";
  /** Embedded-extension bundles assembled at build time from each extension's `wendoo.json` `files` list. */
  const embeddedExtensionBundles: readonly EmbeddedExtension[];
  export default embeddedExtensionBundles;
}
