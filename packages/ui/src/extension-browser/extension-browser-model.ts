/**
 * One extension shown in {@link ExtensionBrowserDialog}. The host application
 * adapts its own catalog entry into this platform-agnostic view model, deriving
 * `docsUrl` from the coordinate.
 */
export interface ExtensionBrowserEntry {
  /** The extension's `<owner>/<repo>` coordinate: its stable key in the list. */
  readonly coordinate: string;
  /** Display name shown as the card title. */
  readonly name: string;
  /** Semantic version shown on the card. */
  readonly version: string;
  /** Thumbnail URL or data URI; the bundled default thumbnail is shown when absent. */
  readonly thumbnailUrl?: string;
  /** True when the extension is part of the project. */
  readonly installed: boolean;
  /** True when the extension is a required platform layer library the user cannot install or uninstall. */
  readonly locked: boolean;
  /** Documentation URL opened by the card's View Docs action; the action is omitted when absent. */
  readonly docsUrl?: string;
  /** True for a fetched dependency with installed content; the card offers an on-request update check. */
  readonly updatable?: boolean;
  /** Present when a declared remote dependency has no installed content; the card renders the reason and offers Retry. */
  readonly broken?: {
    /** Stable failure code of the most recent recorded install attempt; absent when none is recorded. */
    readonly code?: string;
    /** Human-readable description of the broken state. */
    readonly message: string;
  };
  /** Present when the installed content publishes under a different identity than the entry coordinate. */
  readonly identityMismatch?: {
    /** The `<owner>/<repo>` identity the installed content's manifest declares. */
    readonly declaredIdentity: string;
  };
}

/**
 * An affordance a card can trigger: install a not-installed add-on, uninstall
 * an installed one, check an installed fetched dependency for an update, retry
 * a broken dependency's install, or open its docs.
 */
export type ExtensionCardActionKind = "install" | "uninstall" | "check-update" | "retry" | "docs";

/** One item in a card's kebab menu: its stable action kind and its display label. */
export interface ExtensionCardMenuItem {
  readonly action: Exclude<ExtensionCardActionKind, "install" | "retry">;
  readonly label: string;
}

/** Callbacks a card invokes when one of its affordances is triggered. */
export interface ExtensionCardCallbacks {
  /** Install the add-on named by the coordinate. */
  onInstall: (coordinate: string) => void;
  /** Uninstall the add-on named by the coordinate. */
  onUninstall: (coordinate: string) => void;
  /** Check the fetched dependency named by the coordinate for an update. Absent when the host offers no update checks. */
  onCheckUpdate?: (coordinate: string) => void;
  /** Re-run the install transaction for the broken dependency named by the coordinate. Absent when the host offers no retry. */
  onRetry?: (coordinate: string) => void;
  /** Open the given documentation URL. Absent when the host does not handle docs navigation. */
  openDocs?: (url: string) => void;
}

/**
 * One catalog entry offered in the browser's catalog section, rendered from
 * the catalog document's display metadata alone.
 */
export interface ExtensionCatalogOffer {
  /** The extension's `<owner>/<repo>` coordinate: its stable key in the section. */
  readonly coordinate: string;
  /** Display name shown as the card title. */
  readonly name: string;
  /** Published version shown on the card. */
  readonly version: string;
  /** Description shown on the card. */
  readonly description: string;
  /** Thumbnail URL or data URI; the bundled default thumbnail is shown when absent. */
  readonly thumbnailUrl?: string;
  /** The pinned `gh:` reference installing this offer writes. */
  readonly ref: string;
  /** True when the project's extensions map already carries the coordinate. */
  readonly installed: boolean;
}

const svgThumbnail = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#e2e8f0"/><path d="M24 24h16v16H24z" fill="#94a3b8"/><path d="M40 20a6 6 0 0 1 0 12M20 32a6 6 0 0 1 12 0" fill="none" stroke="#94a3b8" stroke-width="4"/></svg>`;

/**
 * Bundled default thumbnail, a self-contained SVG data URI shown on cards whose
 * {@link ExtensionBrowserEntry.thumbnailUrl} is absent.
 */
export const DEFAULT_EXTENSION_THUMBNAIL = `data:image/svg+xml,${encodeURIComponent(svgThumbnail)}`;

/**
 * Filter entries by a search query, matching case-insensitively against each
 * entry's name and coordinate. A blank query returns the entries unchanged.
 *
 * @param entries - The entries to filter.
 * @param query - The search text.
 */
export function filterExtensionEntries(
  entries: readonly ExtensionBrowserEntry[],
  query: string
): ExtensionBrowserEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [...entries];
  }
  return entries.filter(
    (entry) => entry.name.toLowerCase().includes(needle) || entry.coordinate.toLowerCase().includes(needle)
  );
}

/**
 * The kebab-menu items a card offers for an entry. A locked layer library
 * offers only View Docs (and only when it declares a `docsUrl`); a broken
 * dependency offers Uninstall; an installed updatable dependency offers Check
 * for Update and Uninstall; any other installed add-on offers Uninstall; a
 * not-installed add-on offers no menu items and shows the inline Add
 * affordance from {@link extensionCardShowsInstall}.
 *
 * @param entry - The entry whose menu items to compute.
 */
export function extensionCardMenuItems(entry: ExtensionBrowserEntry): ExtensionCardMenuItem[] {
  if (entry.locked) {
    return entry.docsUrl !== undefined ? [{ action: "docs", label: "View Docs" }] : [];
  }
  if (entry.broken !== undefined) {
    return [{ action: "uninstall", label: "Uninstall" }];
  }
  if (entry.installed) {
    return [
      ...(entry.updatable === true ? [{ action: "check-update", label: "Check for Update" } as const] : []),
      { action: "uninstall", label: "Uninstall" },
    ];
  }
  return [];
}

/**
 * Report whether a card shows the inline Add affordance: true for a not-installed
 * add-on, false for a locked layer library, an already-installed extension, or a
 * broken dependency (which shows Retry instead).
 *
 * @param entry - The entry to test.
 */
export function extensionCardShowsInstall(entry: ExtensionBrowserEntry): boolean {
  return !entry.locked && !entry.installed && entry.broken === undefined;
}

/**
 * Report whether a card shows the inline Retry affordance: true for a broken
 * dependency that is not a locked layer library.
 *
 * @param entry - The entry to test.
 */
export function extensionCardShowsRetry(entry: ExtensionBrowserEntry): boolean {
  return !entry.locked && entry.broken !== undefined;
}

/**
 * Dispatch a card affordance to the matching callback: `install`, `uninstall`,
 * `check-update`, and `retry` call their callbacks with the entry's
 * coordinate; `docs` calls `openDocs` with the entry's `docsUrl`. An absent
 * optional callback or `docsUrl` makes the action do nothing.
 *
 * @param entry - The entry the action applies to.
 * @param action - The affordance triggered.
 * @param callbacks - The host callbacks to dispatch to.
 */
export function runExtensionCardAction(
  entry: ExtensionBrowserEntry,
  action: ExtensionCardActionKind,
  callbacks: ExtensionCardCallbacks
): void {
  switch (action) {
    case "install":
      callbacks.onInstall(entry.coordinate);
      return;
    case "uninstall":
      callbacks.onUninstall(entry.coordinate);
      return;
    case "check-update":
      callbacks.onCheckUpdate?.(entry.coordinate);
      return;
    case "retry":
      callbacks.onRetry?.(entry.coordinate);
      return;
    default:
      if (entry.docsUrl !== undefined) {
        callbacks.openDocs?.(entry.docsUrl);
      }
  }
}
