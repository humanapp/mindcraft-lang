/**
 * Information about the application that produced a `.mindcraft` export.
 *
 * Stamped into every export so an importer can verify compatibility before
 * loading the payload.
 */
export interface MindcraftExportHost {
  /** Application identifier (e.g. the host app's package name). */
  name: string;
  /** Semver version of the host application that produced the export. */
  version: string;
}

/**
 * A single workspace file carried inside a `.mindcraft` export.
 *
 * Paths are workspace-relative; binary content is not supported -- everything
 * is serialized as UTF-8 text.
 */
export interface MindcraftExportFile {
  /** Workspace-relative path. Must not be absolute and must not contain `..`. */
  path: string;
  /** UTF-8 text contents of the file. */
  content: string;
}

/**
 * Host-agnostic portion of a `.mindcraft` export.
 *
 * This is the subset every Mindcraft host writes and reads. Host-specific
 * data lives in `MindcraftExportDocument.app`.
 */
export interface MindcraftExportCommon {
  /** Producing application's identity and version. */
  host: MindcraftExportHost;
  /** Human-readable project name. */
  name: string;
  /** Human-readable project description. */
  description: string;
  /**
   * Optional URL of a thumbnail image representing the project. Treated as an
   * arbitrary string by the transport; the producing app is responsible for
   * any constraints on the URL form (e.g. https-only, hosted vs. data URL).
   */
  thumbnailUrl?: string;
  /** Workspace files captured at export time. */
  files: MindcraftExportFile[];
  /** Serialized brain definitions, keyed by brain id. Opaque to the transport. */
  brains: Record<string, unknown>;
}

/**
 * Canonical on-disk representation of a `.mindcraft` file.
 *
 * This is the source of truth for project content. Backend metadata (e.g.
 * `SharedProject`, `SharedProjectRevision`) references documents by storage
 * key rather than inlining them.
 */
export interface MindcraftExportDocument extends MindcraftExportCommon {
  /**
   * Optional host-specific payload. Shape is defined by the producing app and
   * validated by an import callback on the consuming side.
   */
  app?: unknown;
}
