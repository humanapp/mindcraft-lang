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
  type ExtensionBrowserItem,
  type ExtensionCardCallbacks,
  type ExtensionCatalogOffer,
  extensionBrowserItemCoordinate,
  extensionBrowserShowsCheckAllUpdates,
  extensionBrowserShowsNoMatch,
  extensionCardMenuItems,
  extensionCardShowsInstall,
  extensionCardShowsRetry,
  filterExtensionEntries,
  filterExtensionOffers,
  orderExtensionBrowserItems,
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
        {entry.description !== undefined && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{entry.description}</p>
        )}
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

/** A catalog offer card: display metadata from the catalog document and an Add affordance. */
function ExtensionOfferCard({
  offer,
  onInstallReference,
}: {
  offer: ExtensionCatalogOffer;
  onInstallReference?: (reference: string) => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card p-3 text-card-foreground">
      <img
        src={offer.thumbnailUrl ?? DEFAULT_EXTENSION_THUMBNAIL}
        alt=""
        className="h-12 w-12 shrink-0 rounded-md border bg-muted object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{offer.name}</span>
        </div>
        <span className="text-xs text-muted-foreground">v{offer.version}</span>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{offer.description}</p>
      </div>
      {onInstallReference !== undefined && (
        <Button type="button" variant="outline" size="sm" onClick={() => onInstallReference(offer.ref)}>
          Add
        </Button>
      )}
    </li>
  );
}

/** Props for {@link ExtensionBrowserList}. */
export interface ExtensionBrowserListProps extends ExtensionCardCallbacks {
  /** The items to render, already filtered and ordered by the caller. */
  items: readonly ExtensionBrowserItem[];
  /** Called with an offer's pinned reference when its Add affordance is triggered. */
  onInstallReference?: (reference: string) => void;
}

/**
 * The flat list of library cards, rendered without a surrounding modal: one
 * card per item, entry cards and catalog offer cards alike, in the caller's
 * order.
 */
export function ExtensionBrowserList({
  items,
  onInstall,
  onUninstall,
  onCheckUpdate,
  onRetry,
  onOpenRepo,
  onInstallReference,
}: ExtensionBrowserListProps) {
  return (
    <ul aria-label="Libraries" className="flex flex-col gap-2">
      {items.map((item) =>
        item.kind === "entry" ? (
          <ExtensionCard
            key={extensionBrowserItemCoordinate(item)}
            entry={item.entry}
            onInstall={onInstall}
            onUninstall={onUninstall}
            onCheckUpdate={onCheckUpdate}
            onRetry={onRetry}
            onOpenRepo={onOpenRepo}
          />
        ) : (
          <ExtensionOfferCard
            key={extensionBrowserItemCoordinate(item)}
            offer={item.offer}
            onInstallReference={onInstallReference}
          />
        )
      )}
    </ul>
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
  /** Catalog offers to render as installable cards in the list. */
  catalogOffers?: readonly ExtensionCatalogOffer[];
  /**
   * The catalog document's coordinates in document order; anchors every
   * catalog-listed card's position in the list regardless of install status.
   */
  catalogCoordinates?: readonly string[];
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
  catalogCoordinates,
}: ExtensionBrowserDialogProps) {
  const [filter, setFilter] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setFilter("");
    }
  }, [open]);

  const searchActive = filter.trim().length > 0;
  const items = React.useMemo(() => {
    const filteredEntries = filterExtensionEntries(entries, filter);
    const filteredOffers = onInstallReference !== undefined ? filterExtensionOffers(catalogOffers ?? [], filter) : [];
    return orderExtensionBrowserItems(filteredEntries, filteredOffers, catalogCoordinates ?? []);
  }, [entries, catalogOffers, catalogCoordinates, onInstallReference, filter]);
  const showNoMatch = extensionBrowserShowsNoMatch(items.length, searchActive);
  const showCheckAllUpdates = extensionBrowserShowsCheckAllUpdates(entries);

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
          {onCheckAllUpdates !== undefined && showCheckAllUpdates && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              data-testid="check-all-updates-button"
              onClick={onCheckAllUpdates}
            >
              Check for Updates
            </Button>
          )}
          {items.length > 0 && (
            <ExtensionBrowserList
              items={items}
              onInstall={onInstall}
              onUninstall={onUninstall}
              onCheckUpdate={onCheckUpdate}
              onRetry={onRetry}
              onOpenRepo={onOpenRepo}
              onInstallReference={onInstallReference}
            />
          )}
          {showNoMatch && (
            <p className="py-8 text-center text-sm text-muted-foreground">No libraries match your search.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
