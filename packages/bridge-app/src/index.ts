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
  ExtensionResolutionConflictWarning,
  ExtensionResolutionSources,
  ExtensionResolutionWarning,
  ExtensionResolutionWarningKind,
  FetchedExtensionContentMap,
  ResolvedExtensions,
  ResolvedOriginProvenance,
} from "./embedded-extensions.js";
export { ExtensionResolutionCycleError, resolveProjectExtensions } from "./embedded-extensions.js";
export type {
  ExtensionActionResult,
  ExtensionCatalogEntry,
  ExtensionCatalogOffer,
  ExtensionFetchFailures,
  PlatformStackLayer,
} from "./extension-catalog.js";
export {
  buildExtensionCatalog,
  buildExtensionCatalogOffers,
  deriveProjectPlatformStack,
  ExtensionActionResultCode,
  installEmbeddedExtension,
  installExtensionReference,
  isExtensionCompatible,
  satisfiesRange,
  uninstallExtension,
} from "./extension-catalog.js";
export type {
  ExtensionFetchClosureResult,
  ExtensionInstallOutcome,
  ExtensionInstallOutcomeKind,
  ExtensionInstallProblem,
  ExtensionInstallRefusal,
  ExtensionInstallReport,
  ProjectDiagnosticsState,
} from "./extension-install.js";
export {
  collectExtensionFetchClosure,
  diffProjectDiagnostics,
  typecheckBrainProblems,
} from "./extension-install.js";
export type { ExtensionInstallLogEvent } from "./extension-install-log.js";
export {
  appendExtensionInstallLog,
  EXTENSION_INSTALL_LOG_APP_DATA_KEY,
  parseExtensionInstallLog,
} from "./extension-install-log.js";
export type {
  InstalledExtensionSnapshot,
  InstalledExtensionSnapshots,
} from "./fetched-extension-snapshots.js";
export {
  base64ToBytes,
  bytesToBase64,
  decodeInstalledSnapshotFiles,
  fetchedContentFromSnapshots,
  INSTALLED_EXTENSIONS_APP_DATA_KEY,
  installedSnapshotFromFetched,
  parseInstalledExtensionSnapshots,
  serializeInstalledExtensionSnapshots,
} from "./fetched-extension-snapshots.js";

export type { UserTileApplyResult, UserTileMetadata } from "./user-tile-registration.js";
export { applyCompiledUserTiles, collectMetadataFromCompile } from "./user-tile-registration.js";

export type { VfsAssetUrlProvider, VfsAssetUrlProviderOptions } from "./vfs-asset-url-provider.js";
export { createVfsAssetUrlProvider } from "./vfs-asset-url-provider.js";
