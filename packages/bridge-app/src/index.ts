export type {
  ExampleDefinition,
  ExampleFile,
  InMemoryProjectFileSystemOptions,
} from "@mindcraft-lang/app-host";
export { createInMemoryProjectFileSystem, EXAMPLES_FOLDER, MINDCRAFT_JSON_PATH } from "@mindcraft-lang/app-host";
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

export type {
  EmbeddedExtension,
  EmbeddedExtensionFile,
  ExtensionResolutionWarning,
  ExtensionResolutionWarningKind,
  ResolvedExtensions,
} from "./embedded-extensions.js";
export { ExtensionResolutionCycleError, resolveEmbeddedExtensions } from "./embedded-extensions.js";

export type {
  StdlibBrainOriginMigrationReport,
  StdlibImportMigrationResult,
  StdlibImportRedirect,
} from "./stdlib-import-migration.js";
export { migrateStdlibBrainOrigins, migrateStdlibImports } from "./stdlib-import-migration.js";

export type { UserTileApplyResult, UserTileMetadata, UserTileRegistrationOptions } from "./user-tile-registration.js";
export {
  applyCompiledUserTiles,
  collectMetadataFromCompile,
  hydrateUserTilesFromCache,
} from "./user-tile-registration.js";

export type { VfsSwRegistrationOptions } from "./vfs-sw-registration.js";
export { registerVfsServiceWorker } from "./vfs-sw-registration.js";
