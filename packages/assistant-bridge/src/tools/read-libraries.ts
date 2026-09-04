import { CATALOG_TEXT_LIMITS, sanitizeCatalogText } from "../catalog/sanitize.js";
import type { ToolInput } from "./tool-schemas.js";
import type { AuthoringWorkspace } from "./workspace.js";

/** One approved library, as `read_libraries` describes it. */
export interface LibraryShelfEntry {
  /** The library's `<owner>/<repo>` coordinate, which the app installs it by. */
  readonly coordinate: string;
  /** The name the library reads by. */
  readonly name: string;
  /** The version of the library the app approves. */
  readonly version: string;
  /** What the library adds, in the words of the app's catalog entry for it; absent when the entry carries none. */
  readonly description?: string;
  /** `true` when the project already holds the library. */
  readonly installed: boolean;
  /**
   * Address of the page the library is published at, for a surface that offers
   * to open it; absent for a library that is published nowhere of its own, such
   * as one bundled with the app. Host-side only: `read_libraries` never serves
   * it.
   */
  readonly sourceUrl?: string;
}

/** The shelf as `read_libraries` returns it. */
export interface LibraryShelfView {
  /** The libraries matching the request, in the order the host shelves them. */
  readonly libraries: readonly LibraryShelfEntry[];
  /** Libraries the shelf holds across the whole app, before `filter` narrowed them. */
  readonly total: number;
}

/** True when any of the entry's searchable text contains `needle`. */
function matches(entry: LibraryShelfEntry, needle: string): boolean {
  return (
    entry.coordinate.toLowerCase().includes(needle) ||
    entry.name.toLowerCase().includes(needle) ||
    (entry.description?.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * One shelf entry as the tool serves it: the fields {@link LibraryShelfEntry}
 * declares and nothing else the host may have carried on the object, with the
 * text the entry's author wrote cut to its {@link CATALOG_TEXT_LIMITS} entry.
 */
function servedEntry(entry: LibraryShelfEntry): LibraryShelfEntry {
  return {
    coordinate: entry.coordinate,
    name: sanitizeCatalogText(entry.name, CATALOG_TEXT_LIMITS.label),
    version: entry.version,
    ...(entry.description === undefined
      ? {}
      : { description: sanitizeCatalogText(entry.description, CATALOG_TEXT_LIMITS.description) }),
    installed: entry.installed,
  };
}

/**
 * List the libraries the host approves for this project, each with what it adds
 * and whether the project already holds it. The shelf is read from the
 * workspace as the call runs, so a project switched to since the last call is
 * the one this answer describes; a workspace carrying no shelf lists none.
 * `input.filter` narrows the list and leaves `total` counting the whole shelf.
 */
export function readLibraries(workspace: AuthoringWorkspace, input: ToolInput<"read_libraries">): LibraryShelfView {
  const shelf = (workspace.libraryShelf?.() ?? []).map(servedEntry);
  const needle = input.filter?.trim().toLowerCase();
  return { libraries: needle ? shelf.filter((entry) => matches(entry, needle)) : shelf, total: shelf.length };
}
