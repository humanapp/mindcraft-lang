import { MoreHorizontal } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import {
  DEFAULT_EXTENSION_THUMBNAIL,
  type ExtensionBrowserEntry,
  type ExtensionCardCallbacks,
  type ExtensionCatalogOffer,
  extensionBrowserSections,
  extensionCardMenuItems,
  extensionCardShowsInstall,
  extensionCardShowsRetry,
  filterExtensionEntries,
  filterExtensionOffers,
  runExtensionCardAction,
} from "./extension-browser-model";

/**
 * A single extension card: thumbnail, title, version, an installed indicator,
 * broken-state and identity-mismatch annotations, and state-dependent
 * affordances.
 */
function ExtensionCard({
  entry,
  onInstall,
  onUninstall,
  onCheckUpdate,
  onRetry,
  onOpenRepo,
}: { entry: ExtensionBrowserEntry } & ExtensionCardCallbacks) {
  const showInstall = extensionCardShowsInstall(entry);
  const showRetry = extensionCardShowsRetry(entry);
  const callbacks: ExtensionCardCallbacks = {
    onInstall,
    onUninstall,
    onCheckUpdate,
    onRetry,
    onOpenRepo,
  };
  const menuItems = extensionCardMenuItems(entry).filter(
    (item) =>
      (item.action !== "check-update" || onCheckUpdate !== undefined) &&
      (item.action !== "open-repo" || onOpenRepo !== undefined)
  );

  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card p-3 text-card-foreground">
      <img
        src={entry.thumbnailUrl ?? DEFAULT_EXTENSION_THUMBNAIL}
        alt=""
        className="h-12 w-12 shrink-0 rounded-md border bg-muted object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{entry.name}</span>
          {entry.installed && (
            <span className="shrink-0 rounded border border-success/40 bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
              Installed
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">v{entry.version}</span>
        {entry.broken !== undefined && (
          <p className="mt-0.5 text-xs text-destructive">
            {entry.broken.code !== undefined ? `${entry.broken.code}: ` : ""}
            {entry.broken.message}
          </p>
        )}
        {entry.identityMismatch !== undefined && (
          <p className="mt-0.5 text-xs text-warning">Publishes as {entry.identityMismatch.declaredIdentity}</p>
        )}
      </div>
      {showInstall && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => runExtensionCardAction(entry, "install", callbacks)}
        >
          Add
        </Button>
      )}
      {showRetry && onRetry !== undefined && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => runExtensionCardAction(entry, "retry", callbacks)}
        >
          Retry
        </Button>
      )}
      {menuItems.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              aria-label={`${entry.name} actions`}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menuItems.map((item) => (
              <DropdownMenuItem key={item.action} onClick={() => runExtensionCardAction(entry, item.action, callbacks)}>
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

/** Props for {@link ExtensionBrowserList}. */
export interface ExtensionBrowserListProps extends ExtensionCardCallbacks {
  /** The entries to render, already filtered by the caller. */
  entries: readonly ExtensionBrowserEntry[];
}

/**
 * The flat list of extension cards, rendered without a surrounding modal. The
 * caller supplies the entries to show (already filtered) and the card
 * callbacks.
 */
export function ExtensionBrowserList({
  entries,
  onInstall,
  onUninstall,
  onCheckUpdate,
  onRetry,
  onOpenRepo,
}: ExtensionBrowserListProps) {
  return (
    <ul aria-label="Libraries" className="flex flex-col gap-2">
      {entries.map((entry) => (
        <ExtensionCard
          key={entry.coordinate}
          entry={entry}
          onInstall={onInstall}
          onUninstall={onUninstall}
          onCheckUpdate={onCheckUpdate}
          onRetry={onRetry}
          onOpenRepo={onOpenRepo}
        />
      ))}
    </ul>
  );
}

/** Props for {@link ExtensionCatalogSection}. */
export interface ExtensionCatalogSectionProps {
  /** The catalog offers to render. */
  offers: readonly ExtensionCatalogOffer[];
  /** Called with an offer's pinned reference when its Add affordance is triggered. */
  onInstallReference: (reference: string) => void;
}

/**
 * The catalog section of the browser: one card per offer, rendered from the
 * catalog document's display metadata alone. Adding an offer writes its pinned
 * reference through `onInstallReference`.
 */
export function ExtensionCatalogSection({ offers, onInstallReference }: ExtensionCatalogSectionProps) {
  return (
    <section aria-label="Catalog" className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Catalog</h3>
      <ul className="flex flex-col gap-2">
        {offers.map((offer) => (
          <li
            key={offer.coordinate}
            className="flex items-center gap-3 rounded-lg border bg-card p-3 text-card-foreground"
          >
            <img
              src={offer.thumbnailUrl ?? DEFAULT_EXTENSION_THUMBNAIL}
              alt=""
              className="h-12 w-12 shrink-0 rounded-md border bg-muted object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{offer.name}</span>
                {offer.installed && (
                  <span className="shrink-0 rounded border border-success/40 bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                    Installed
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">v{offer.version}</span>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{offer.description}</p>
            </div>
            {!offer.installed && (
              <Button type="button" variant="outline" size="sm" onClick={() => onInstallReference(offer.ref)}>
                Add
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Props for {@link ExtensionReferenceInstallRow}. */
export interface ExtensionReferenceInstallRowProps {
  /** Called with the entered reference string when the Add affordance is triggered. */
  onInstallReference: (reference: string) => void;
}

/**
 * Input row for adding a remote extension from pasted text: a reference
 * (`gh:<owner>/<repo>@<pin>` or `gh:<owner>/<repo>#<branch>`), an
 * `<owner>/<repo>` coordinate, or a GitHub repository URL. Submits the
 * entered text through `onInstallReference` and clears the field.
 */
export function ExtensionReferenceInstallRow({ onInstallReference }: ExtensionReferenceInstallRowProps) {
  const [reference, setReference] = React.useState("");

  const submit = () => {
    const trimmed = reference.trim();
    if (trimmed.length === 0) {
      return;
    }
    onInstallReference(trimmed);
    setReference("");
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        type="text"
        placeholder="Paste GitHub URL"
        aria-label="Add from GitHub"
        value={reference}
        onChange={(event) => setReference(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            submit();
          }
        }}
        className="flex-1"
      />
      <Button type="button" variant="outline" size="sm" disabled={reference.trim().length === 0} onClick={submit}>
        Add
      </Button>
    </div>
  );
}

/** Props for {@link ExtensionBrowserDialog}. */
export interface ExtensionBrowserDialogProps extends ExtensionCardCallbacks {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when the dialog requests an open-state change. */
  onOpenChange: (open: boolean) => void;
  /** The extensions to browse. */
  entries: readonly ExtensionBrowserEntry[];
  /**
   * Install a remote extension from a reference string. The Add-from-GitHub
   * row and the catalog section appear only when present.
   */
  onInstallReference?: (reference: string) => void;
  /**
   * Check every updatable dependency for updates. The Check for Updates
   * affordance appears when present and at least two entries are updatable.
   */
  onCheckAllUpdates?: () => void;
  /** Catalog offers to render as an installable section; the section appears only when non-empty. */
  catalogOffers?: readonly ExtensionCatalogOffer[];
}

/**
 * Modal that presents a searchable flat list of extension cards, an optional
 * add-by-reference row, and an optional catalog section. An installed add-on
 * offers Uninstall; an updatable dependency offers Check for Update; a broken
 * dependency shows its reason with a Retry affordance; a not-installed add-on
 * offers an inline Add.
 */
export function ExtensionBrowserDialog({
  open,
  onOpenChange,
  entries,
  onInstall,
  onUninstall,
  onCheckUpdate,
  onRetry,
  onOpenRepo,
  onInstallReference,
  onCheckAllUpdates,
  catalogOffers,
}: ExtensionBrowserDialogProps) {
  const [filter, setFilter] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setFilter("");
    }
  }, [open]);

  const searchActive = filter.trim().length > 0;
  const filteredEntries = React.useMemo(() => filterExtensionEntries(entries, filter), [entries, filter]);
  const filteredOffers = React.useMemo(
    () => (onInstallReference !== undefined ? filterExtensionOffers(catalogOffers ?? [], filter) : []),
    [catalogOffers, onInstallReference, filter]
  );
  const sections = extensionBrowserSections(filteredOffers.length, filteredEntries.length, searchActive);
  const updatableCount = React.useMemo(() => entries.filter((entry) => entry.updatable === true).length, [entries]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "left-0 top-0 h-dvh max-w-full translate-x-0 translate-y-0 gap-0 rounded-none p-0",
          "sm:left-[50%] sm:top-[50%] sm:h-150 sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg"
        )}
      >
        <DialogHeader className="flex-col space-y-0.5 border-b px-4 py-3 sm:px-6 sm:py-4">
          <DialogTitle>Libraries</DialogTitle>
          <DialogDescription>Add or remove libraries for this project.</DialogDescription>
          <Input
            type="text"
            placeholder="Search libraries..."
            aria-label="Search libraries"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="mt-2 w-full"
          />
        </DialogHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6">
          {onInstallReference !== undefined && <ExtensionReferenceInstallRow onInstallReference={onInstallReference} />}
          {onCheckAllUpdates !== undefined && updatableCount >= 2 && (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={onCheckAllUpdates}>
              Check for Updates
            </Button>
          )}
          {onInstallReference !== undefined && sections.showOffers && (
            <ExtensionCatalogSection offers={filteredOffers} onInstallReference={onInstallReference} />
          )}
          {sections.showEntries && (
            <ExtensionBrowserList
              entries={filteredEntries}
              onInstall={onInstall}
              onUninstall={onUninstall}
              onCheckUpdate={onCheckUpdate}
              onRetry={onRetry}
              onOpenRepo={onOpenRepo}
            />
          )}
          {sections.showNoMatch && (
            <p className="py-8 text-center text-sm text-muted-foreground">No libraries match your search.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
