import type { LibraryShelfEntry } from "@wendoo/assistant-bridge";
import { useState } from "react";
import { addOffer, LibraryAddPhase, LibraryOfferState, libraryOfferState, useLibraryOffers } from "./library-offers";

/** The surface an offer is drawn on, standing across the width the transcript gives it. */
const cardClasses = "my-1 flex w-full items-start gap-2 rounded-[14px] border border-border bg-brain-ink/5 px-3 py-2";

/** How the part of the card naming the library reads, and how it reads when it opens the library's page. */
const contentClasses = "flex min-w-0 grow flex-col gap-0.5 text-left text-sm no-underline text-card-foreground";

/** The control that adds the library. */
const addClasses =
  "shrink-0 rounded-md border border-border px-2 py-1 text-xs text-card-foreground disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:min-w-11";

/** The word standing where the control was, once the project holds the library. */
const restingClasses = "shrink-0 text-muted-foreground text-xs";

/** What the card says of the library: its name and version, and what it adds where the shelf says. */
function LibraryReading({ entry }: { entry: LibraryShelfEntry }) {
  return (
    <>
      <span className="flex items-baseline gap-1.5">
        <span data-assistant-library-name className="truncate font-semibold">
          {entry.name}
        </span>
        <span data-assistant-library-version className="shrink-0 text-muted-foreground text-xs">
          {entry.version}
        </span>
      </span>
      {entry.description !== undefined && (
        <span data-assistant-library-description className="text-muted-foreground text-xs">
          {entry.description}
        </span>
      )}
    </>
  );
}

/**
 * One library the assistant offered, drawn as the card standing for it: what it
 * is called, what it adds, the version the world approves, and the control that
 * adds it. Tapping the card's reading opens the library's own page in a new tab
 * where it is published at one; a library published nowhere of its own opens
 * nothing.
 *
 * The card is drawn for the shelf entry standing at `coordinate` as the
 * transcript draws: an offer whose entry the shelf no longer holds stands inert
 * with its coordinate alone, and so does every offer while the host stands no
 * shelf.
 */
export function LibraryCard({ coordinate }: { coordinate: string }) {
  const offers = useLibraryOffers();
  const [phase, setPhase] = useState<LibraryAddPhase>(LibraryAddPhase.Idle);
  const entry = offers?.entryFor(coordinate);
  const state = libraryOfferState(entry, phase);

  if (offers === undefined || entry === undefined) {
    return (
      <span data-assistant-library={coordinate} data-assistant-library-state={state} className={cardClasses}>
        <span className="min-w-0 grow truncate text-muted-foreground text-sm">{coordinate}</span>
      </span>
    );
  }

  const add = (): void => {
    void addOffer(offers.install, coordinate, setPhase);
  };

  return (
    <span data-assistant-library={coordinate} data-assistant-library-state={state} className={cardClasses}>
      {entry.sourceUrl === undefined ? (
        <span className={contentClasses}>
          <LibraryReading entry={entry} />
        </span>
      ) : (
        <a
          data-assistant-library-open
          href={entry.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className={contentClasses}
        >
          <LibraryReading entry={entry} />
        </a>
      )}
      {state === LibraryOfferState.Installed ? (
        <span className={restingClasses}>added</span>
      ) : (
        <button
          data-assistant-library-add
          type="button"
          onClick={add}
          disabled={state === LibraryOfferState.Installing}
          className={addClasses}
        >
          {state === LibraryOfferState.Installing ? "adding..." : "Add"}
        </button>
      )}
    </span>
  );
}
