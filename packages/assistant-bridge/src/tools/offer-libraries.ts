import type { ToolInput } from "./tool-schemas.js";
import type { AuthoringWorkspace } from "./workspace.js";

/** How one coordinate an offer named stands against the shelf. */
export const LibraryOfferVerdict = {
  /** The shelf holds a library at the coordinate, and its card is presented. */
  Listed: "listed",
  /** The shelf holds no library at the coordinate, and nothing is presented for it. */
  Unknown: "unknown",
} as const;

/** How one coordinate an offer named stands against the shelf. */
export type LibraryOfferVerdict = (typeof LibraryOfferVerdict)[keyof typeof LibraryOfferVerdict];

/** Why a coordinate came back {@link LibraryOfferVerdict.Unknown}. */
export const LibraryOfferUnknownCode = {
  /** A non-empty shelf holds nothing at that coordinate; another of its coordinates may fit. */
  NotShelved: "not_shelved",
  /** The shelf offers nothing at all -- absent or bare -- so no coordinate can be offered. */
  NoShelf: "no_shelf",
} as const;

/** Why a coordinate came back {@link LibraryOfferVerdict.Unknown}. */
export type LibraryOfferUnknownCode = (typeof LibraryOfferUnknownCode)[keyof typeof LibraryOfferUnknownCode];

/** One coordinate an `offer_libraries` call named, and what came of it. */
export interface LibraryOffered {
  /** The `<owner>/<repo>` coordinate the call named, as it named it. */
  readonly coordinate: string;
  readonly verdict: LibraryOfferVerdict;
  /** Why nothing is presented for the coordinate; present only on an unknown verdict. */
  readonly code?: LibraryOfferUnknownCode;
  /** Human-readable context for {@link LibraryOffered.code}; present only on an unknown verdict. */
  readonly message?: string;
}

/** What one `offer_libraries` call presented, as the tool returns it. */
export interface LibraryOfferView {
  /** One verdict per coordinate the call named, in the order it named them. */
  readonly offers: readonly LibraryOffered[];
}

/** The wording an unknown verdict carries alongside its code. */
const unknownMessages: Record<LibraryOfferUnknownCode, (coordinate: string) => string> = {
  [LibraryOfferUnknownCode.NotShelved]: (coordinate) =>
    `The shelf holds no library at "${coordinate}"; read_libraries lists what it does hold.`,
  [LibraryOfferUnknownCode.NoShelf]: () =>
    "This session's shelf offers no library at all, so there is nothing to offer.",
};

/** How `coordinate` stands against a shelf holding `held`, which `shelved` says holds anything at all. */
function verdictFor(coordinate: string, shelved: boolean, held: ReadonlySet<string>): LibraryOffered {
  if (shelved && held.has(coordinate)) return { coordinate, verdict: LibraryOfferVerdict.Listed };
  const code = shelved ? LibraryOfferUnknownCode.NotShelved : LibraryOfferUnknownCode.NoShelf;
  return { coordinate, verdict: LibraryOfferVerdict.Unknown, code, message: unknownMessages[code](coordinate) };
}

/**
 * Present the libraries at `input.coordinates` as the cards the person adds them
 * from, answering one verdict per coordinate in the order they were named: a
 * coordinate the shelf holds comes back listed and its card is drawn, and one it
 * does not comes back unknown under the code saying why, presenting nothing. The
 * shelf is read from the workspace as the call runs, so a project switched to
 * since the last call is the one the offer is judged against. A call whose every
 * coordinate is unknown is answered the same way, carrying only unknown
 * verdicts.
 */
export function offerLibraries(workspace: AuthoringWorkspace, input: ToolInput<"offer_libraries">): LibraryOfferView {
  const held = new Set((workspace.libraryShelf?.() ?? []).map((entry) => entry.coordinate));
  return { offers: input.coordinates.map((coordinate) => verdictFor(coordinate, held.size > 0, held)) };
}
