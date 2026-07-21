import type { ReactNode } from "react";
import { useDocsSidebar } from "./DocsSidebarContext";

const CARD_CLASS =
  "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-card hover:bg-accent border border-border transition-colors text-left";

/** Props for {@link DocsEntryLink}. */
export interface DocsEntryLinkProps {
  /** Path of the entry's standalone docs page, e.g. "/docs/tiles/<tileId>". */
  href: string;
  /** Opens the entry's detail view inside the panel. */
  onOpen: () => void;
  children: ReactNode;
}

/**
 * Card-shaped clickable wrapper for a docs panel entry. A plain click opens
 * the entry's detail view inside the panel via `onOpen`. When the provider's
 * `showDocsPageLinks` is true, the card is an anchor to the entry's
 * standalone docs page and modified clicks (ctrl/cmd/shift) follow it; when
 * false, the card is a button with no navigation surface.
 */
export function DocsEntryLink({ href, onOpen, children }: DocsEntryLinkProps) {
  const { showDocsPageLinks } = useDocsSidebar();

  if (!showDocsPageLinks) {
    return (
      <button type="button" onClick={onOpen} className={CARD_CLASS}>
        {children}
      </button>
    );
  }

  return (
    <a
      href={href}
      onClick={(e) => {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
          e.preventDefault();
          onOpen();
        }
      }}
      className={CARD_CLASS}
    >
      {children}
    </a>
  );
}
