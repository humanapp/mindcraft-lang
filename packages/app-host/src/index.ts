export { AppHostError, AppHostErrorCode, appHostError } from "./app-host-error.js";
export type { ExampleDefinition, ExampleFile } from "./examples.js";
export { EXAMPLES_FOLDER } from "./examples.js";
export { createIdbProjectStore } from "./idb-project-store.js";
export type { InMemoryProjectFileSystemOptions } from "./in-memory-project-file-system.js";
export { createInMemoryProjectFileSystem } from "./in-memory-project-file-system.js";
export type { MindcraftJson } from "./mindcraft-json.js";
export { MINDCRAFT_JSON_PATH, parseMindcraftJson, serializeMindcraftJson } from "./mindcraft-json.js";
export type { MindcraftJsonHostInfo } from "./mindcraft-json-sync.js";
export { diffMindcraftJsonToManifest, syncManifestToMindcraftJson } from "./mindcraft-json-sync.js";
export type { ProjectCollection, ProjectCollectionPinVerifier } from "./project-collection.js";
export {
  DEFAULT_PROJECT_COLLECTION_ID,
  DEFAULT_PROJECT_COLLECTION_NAME,
  normalizeProjectCollectionName,
  PROJECT_COLLECTION_NAME_MAX_LENGTH,
} from "./project-collection.js";
export {
  createProjectCollectionPinVerifier,
  normalizeProjectCollectionPin,
  PIN_HASH_BYTES,
  PIN_PBKDF2_ITERATIONS,
  PIN_SALT_BYTES,
  PROJECT_COLLECTION_PIN_MAX_LENGTH,
  PROJECT_COLLECTION_PIN_MIN_LENGTH,
  verifyProjectCollectionPin,
} from "./project-collection-pin.js";
export type {
  ExtensionReference,
  ProjectContentManifest,
  ProjectContentManifestError,
  ProjectContentManifestParseResult,
} from "./project-content-manifest.js";
export {
  ProjectContentManifestErrorCode,
  parseExtensionReference,
  parseProjectContentManifest,
  serializeExtensionReference,
  serializeProjectContentManifest,
  validateProjectContentManifest,
  validateProjectExtensions,
} from "./project-content-manifest.js";
export type {
  ProjectDirectoryEntry,
  ProjectFileChange,
  ProjectFileEntry,
  ProjectFileSnapshot,
  ProjectFileSystemEntry,
} from "./project-file-snapshot.js";
export type { ProjectFileSystem } from "./project-file-system.js";
export type {
  ImportAppLayerCallback,
  ImportAppLayerResult,
  ImportDiagnostic,
  ImportProjectTargetsCallback,
  ImportProjectTargetsResult,
  ImportResult,
  MindcraftProjectDocument,
  MindcraftProjectFile,
  MindcraftProjectTargets,
} from "./project-io.js";
export {
  buildActiveProjectExportDocument,
  buildProjectExportDocument,
  DEFAULT_MAX_FILE_SIZE,
  ImportDiagnosticCode,
  importProjectDocument,
  PROJECT_TARGETS_APP_DATA_KEY,
} from "./project-io.js";
export type { ProjectLock, ProjectLockHandle } from "./project-lock.js";
export { createWebLocksProjectLock } from "./project-lock.js";
export type {
  ActiveProject,
  ProjectCollectionAccessState,
  ProjectCollectionEvent,
  ProjectCollectionProjectCommitResult,
  ProjectCollectionReloadUnlock,
  ProjectCollectionState,
  ProjectCollectionStateSubscription,
  ProjectCollectionSummary,
  ProjectCollectionSummaryChange,
  ProjectCollectionSummarySubscription,
  ProjectCollectionSwitchResult,
  ProjectCollectionUnlockResult,
  ProjectListSubscription,
  ProjectManagerOptions,
  ProjectPersistenceError,
  ProjectTransitionOptions,
} from "./project-manager.js";
export {
  DEFAULT_PROJECT_NAME,
  ProjectManager,
  RELOAD_UNLOCK_REFRESH_INTERVAL_MS,
  RELOAD_UNLOCK_TTL_MS,
} from "./project-manager.js";
export type { ProjectManifest } from "./project-manifest.js";
export type { ProjectCollectionTabSession, ProjectStore } from "./project-store.js";
