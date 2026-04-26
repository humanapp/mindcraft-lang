/**
 * Folder name (relative to the workspace root) under which example projects are
 * channeled to the vscode extension.
 */
export const EXAMPLES_FOLDER = "__examples__";

/** A single file belonging to an {@link ExampleDefinition}. */
export interface ExampleFile {
  /** Path relative to the example's {@link ExampleDefinition.folder}. */
  path: string;
  /** UTF-8 file contents. */
  content: string;
}

/** A bundled example project that can be loaded into a workspace. */
export interface ExampleDefinition {
  /** Folder name (within {@link EXAMPLES_FOLDER}) into which the files are written. */
  folder: string;
  /** Files that make up the example. */
  files: ExampleFile[];
}
