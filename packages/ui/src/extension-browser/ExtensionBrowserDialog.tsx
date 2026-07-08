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
  extensionCardMenuItems,
  extensionCardShowsInstall,
  filterExtensionEntries,
  runExtensionCardAction,
} from "./extension-browser-model";

function openDocsInNewTab(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** A single extension card: thumbnail, title, version, an installed indicator, and state-dependent affordances. */
function ExtensionCard({ entry, onInstall, onUninstall }: { entry: ExtensionBrowserEntry } & ExtensionCardCallbacks) {
  const menuItems = extensionCardMenuItems(entry);
  const showInstall = extensionCardShowsInstall(entry);
  const callbacks: ExtensionCardCallbacks = { onInstall, onUninstall, openDocs: openDocsInNewTab };

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
            <span className="shrink-0 rounded border border-emerald-200 bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-100">
              Installed
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">v{entry.version}</span>
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
 * caller supplies the entries to show (already filtered) and the install and
 * uninstall callbacks.
 */
export function ExtensionBrowserList({ entries, onInstall, onUninstall }: ExtensionBrowserListProps) {
  return (
    <ul aria-label="Extensions" className="flex flex-col gap-2">
      {entries.map((entry) => (
        <ExtensionCard key={entry.coordinate} entry={entry} onInstall={onInstall} onUninstall={onUninstall} />
      ))}
    </ul>
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
}

/**
 * Modal that presents a searchable flat list of extension cards. A locked layer
 * library offers a View Docs menu; an installed add-on offers Uninstall; a
 * not-installed add-on offers an inline Add. Calls `onInstall` or `onUninstall`
 * with the chosen extension's coordinate.
 */
export function ExtensionBrowserDialog({
  open,
  onOpenChange,
  entries,
  onInstall,
  onUninstall,
}: ExtensionBrowserDialogProps) {
  const [filter, setFilter] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setFilter("");
    }
  }, [open]);

  const filtered = React.useMemo(() => filterExtensionEntries(entries, filter), [entries, filter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "left-0 top-0 h-dvh max-w-full translate-x-0 translate-y-0 gap-0 rounded-none p-0",
          "sm:left-[50%] sm:top-[50%] sm:h-150 sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg"
        )}
      >
        <DialogHeader className="flex-col space-y-0.5 border-b px-4 py-3 sm:px-6 sm:py-4">
          <DialogTitle>Extensions</DialogTitle>
          <DialogDescription>Add or remove extensions for this project.</DialogDescription>
          <Input
            type="text"
            placeholder="Search extensions..."
            aria-label="Search extensions"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="mt-2 w-full"
          />
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No extensions match your search.</p>
          ) : (
            <ExtensionBrowserList entries={filtered} onInstall={onInstall} onUninstall={onUninstall} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
