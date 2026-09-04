import type { LibraryShelfEntry } from "@wendoo/assistant-bridge";
import { createContext, type ReactNode, useContext } from "react";

/**
 * What the host tells the panel about the libraries the assistant may offer,
 * and how one gets added. Read as the transcript draws, so a project switched
 * to since answers from its own shelf.
 */
export interface LibraryOffers {
  /**
   * The shelf's entry for `coordinate` as the shelf stands right now;
   * `undefined` for a coordinate the shelf does not hold, which the offer for
   * it stands inert on.
   */
  readonly entryFor: (coordinate: string) => LibraryShelfEntry | undefined;
  /**
   * Add the library at `coordinate` to the project through the host's own
   * install, which reports the outcome itself. Answers whether this attempt put
   * the library in the project: `false` for a refusal, for a failure, and for a
   * library the project already held.
   */
  readonly install: (coordinate: string) => Promise<boolean>;
}

/** How an offer the transcript carries stands. */
export const LibraryOfferState = {
  /** The library can be added, and the offer stands the control that adds it. */
  Offerable: "offerable",
  /** The person's tap is being carried out. */
  Installing: "installing",
  /** The project holds the library, whether this offer put it there or something else did. */
  Installed: "installed",
  /** The offer no longer applies: the shelf standing now holds nothing at its coordinate. */
  Stale: "stale",
} as const;

/** How an offer the transcript carries stands. */
export type LibraryOfferState = (typeof LibraryOfferState)[keyof typeof LibraryOfferState];

/** How far the person's tap on an offer has got. */
export const LibraryAddPhase = {
  /** Nothing is being carried out; a tap starts one. */
  Idle: "idle",
  /** The host's install is running. */
  Adding: "adding",
  /** The install answered that the project holds the library. */
  Added: "added",
} as const;

/** How far the person's tap on an offer has got. */
export type LibraryAddPhase = (typeof LibraryAddPhase)[keyof typeof LibraryAddPhase];

/**
 * How an offer stands, given the shelf entry standing for it and how far a tap
 * on it has got. A shelf holding no entry stands stale whatever the tap did,
 * and an entry the shelf already marks installed stands added without one.
 *
 * @param entry - The shelf's entry for the offered coordinate; absent stands stale.
 * @param phase - How far the person's tap has got.
 */
export function libraryOfferState(entry: LibraryShelfEntry | undefined, phase: LibraryAddPhase): LibraryOfferState {
  if (entry === undefined) return LibraryOfferState.Stale;
  if (phase === LibraryAddPhase.Adding) return LibraryOfferState.Installing;
  if (phase === LibraryAddPhase.Added || entry.installed) return LibraryOfferState.Installed;
  return LibraryOfferState.Offerable;
}

/**
 * Run `install` for `coordinate`, reporting each phase the attempt passes
 * through to `report`: adding as it starts, then added once the install answers
 * that it put the library in the project, and idle when it answers that it did
 * not or fails outright, which stands the offer back on whatever the shelf says
 * of it. A library the project already held lands on idle and reads as added
 * from the shelf's own entry.
 *
 * @param install - The host's install, from {@link LibraryOffers}.
 * @param coordinate - The `<owner>/<repo>` coordinate the offer names.
 * @param report - Called with each phase the attempt reaches, in order.
 */
export async function addOffer(
  install: (coordinate: string) => Promise<boolean>,
  coordinate: string,
  report: (phase: LibraryAddPhase) => void
): Promise<void> {
  report(LibraryAddPhase.Adding);
  try {
    report((await install(coordinate)) ? LibraryAddPhase.Added : LibraryAddPhase.Idle);
  } catch {
    report(LibraryAddPhase.Idle);
  }
}

/**
 * `offers` with every install that put a library in the project telling
 * `onAdded` the coordinate it added, so whoever stands the session can carry the
 * news. An attempt that added nothing -- a refusal, a failure, or a library the
 * project already held -- tells nobody. Answers `undefined` for `undefined`,
 * which leaves every offer inert as it was.
 *
 * @param offers - The shelf and install the host stands, from {@link LibraryOffers}.
 * @param onAdded - Called with the coordinate of each library an install added.
 */
export function offersReporting(
  offers: LibraryOffers | undefined,
  onAdded: (coordinate: string) => void
): LibraryOffers | undefined {
  if (offers === undefined) return undefined;
  return {
    entryFor: offers.entryFor,
    install: async (coordinate: string) => {
      const added = await offers.install(coordinate);
      if (added) onAdded(coordinate);
      return added;
    },
  };
}

const LibraryOffersContext = createContext<LibraryOffers | undefined>(undefined);

/** Stands `value` as the shelf the transcript's offers are drawn against, over the tree it wraps. */
export function LibraryOffersProvider({ value, children }: { value: LibraryOffers | undefined; children?: ReactNode }) {
  return <LibraryOffersContext.Provider value={value}>{children}</LibraryOffersContext.Provider>;
}

/**
 * The shelf the transcript's offers are drawn against. Answers `undefined`
 * where the host stands none, which leaves every offer inert.
 */
export function useLibraryOffers(): LibraryOffers | undefined {
  return useContext(LibraryOffersContext);
}
