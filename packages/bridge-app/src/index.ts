export type { InMemoryProjectFileSystemOptions } from "@mindcraft-lang/app-host";
export { createInMemoryProjectFileSystem, MINDCRAFT_JSON_PATH } from "@mindcraft-lang/app-host";
export type {
  AppBridge,
  AppBridgeFeature,
  AppBridgeFeatureContext,
  AppBridgeFeatureStatus,
  AppBridgeOptions,
  AppBridgeSnapshot,
  AppBridgeState,
  DiagnosticEntry,
  ProjectFileChange,
  ProjectFileSnapshot,
  ProjectFileSystem,
} from "./app-bridge.js";
export { createAppBridge } from "./app-bridge.js";

export type { AppEnvironmentHostOptions } from "./app-environment-host.js";
export { AppEnvironmentHost } from "./app-environment-host.js";
export { CORE_LIB_COORDINATE, CORE_LIB_REFERENCE } from "./core-extension.js";
export type { EmbeddedExtensionIdViolation } from "./embedded-extension-id-gate.js";
export {
  findEmbeddedExtensionsMissingStableIds,
  formatEmbeddedExtensionIdViolations,
} from "./embedded-extension-id-gate.js";
export type {
  EmbeddedExtension,
  EmbeddedExtensionFile,
  ExtensionResolutionWarning,
  ExtensionResolutionWarningKind,
  ResolvedExtensions,
} from "./embedded-extensions.js";
export { ExtensionResolutionCycleError, resolveEmbeddedExtensions } from "./embedded-extensions.js";
export type {
  ExtensionActionResult,
  ExtensionCatalogEntry,
  PlatformStackLayer,
} from "./extension-catalog.js";
export {
  buildExtensionCatalog,
  deriveProjectPlatformStack,
  ExtensionActionResultCode,
  installEmbeddedExtension,
  isExtensionCompatible,
  satisfiesRange,
  uninstallEmbeddedExtension,
} from "./extension-catalog.js";

export type { UserTileApplyResult, UserTileMetadata } from "./user-tile-registration.js";
export { applyCompiledUserTiles, collectMetadataFromCompile } from "./user-tile-registration.js";

export type { VfsSwRegistrationOptions } from "./vfs-sw-registration.js";
export { registerVfsServiceWorker } from "./vfs-sw-registration.js";
