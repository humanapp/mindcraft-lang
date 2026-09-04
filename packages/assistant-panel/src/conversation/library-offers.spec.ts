/**
 * Pins how an offer of a library stands: what the shelf entry standing for it
 * and the person's tap together say it is, and which phases one tap passes
 * through as the host's install answers, fails, or refuses to answer at all.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LibraryShelfEntry } from "@wendoo/assistant-bridge";
import type { LibraryOffers } from "./library-offers";
import { addOffer, LibraryAddPhase, LibraryOfferState, libraryOfferState, offersReporting } from "./library-offers";

/** The coordinate every offer in this file names. */
const coordinate = "example-org/lib-position";

/** A shelf entry for {@link coordinate}, held or not held by the project. */
function shelved(installed: boolean): LibraryShelfEntry {
  return { coordinate, name: "Position", version: "1.3.0", description: "Position sensing.", installed };
}

/** The phases one run of {@link addOffer} reported, in order. */
async function phasesOf(install: (coordinate: string) => Promise<boolean>): Promise<LibraryAddPhase[]> {
  const reported: LibraryAddPhase[] = [];
  await addOffer(install, coordinate, (phase) => reported.push(phase));
  return reported;
}

describe("how an offer stands", () => {
  test("an entry the project does not hold, untapped, is one the person can add", () => {
    assert.equal(libraryOfferState(shelved(false), LibraryAddPhase.Idle), LibraryOfferState.Offerable);
  });

  test("a tap being carried out stands as installing, whatever the shelf says", () => {
    assert.equal(libraryOfferState(shelved(false), LibraryAddPhase.Adding), LibraryOfferState.Installing);
    assert.equal(libraryOfferState(shelved(true), LibraryAddPhase.Adding), LibraryOfferState.Installing);
  });

  test("an entry the project holds stands added, with no tap of its own", () => {
    assert.equal(libraryOfferState(shelved(true), LibraryAddPhase.Idle), LibraryOfferState.Installed);
  });

  test("an entry added by this offer stands added before the shelf says so", () => {
    assert.equal(libraryOfferState(shelved(false), LibraryAddPhase.Added), LibraryOfferState.Installed);
  });

  test("an offer the shelf holds no entry for stands stale, whatever the tap did", () => {
    for (const phase of Object.values(LibraryAddPhase)) {
      assert.equal(libraryOfferState(undefined, phase), LibraryOfferState.Stale);
    }
  });
});

describe("what one tap on an offer passes through", () => {
  test("reaches added once the host's install answers that the project holds it", async () => {
    assert.deepEqual(await phasesOf(async () => true), [LibraryAddPhase.Adding, LibraryAddPhase.Added]);
  });

  test("stands the offer back up when the install answers that it does not", async () => {
    assert.deepEqual(await phasesOf(async () => false), [LibraryAddPhase.Adding, LibraryAddPhase.Idle]);
  });

  test("stands the offer back up when the install fails outright", async () => {
    assert.deepEqual(
      await phasesOf(async () => {
        throw new Error("the install threw");
      }),
      [LibraryAddPhase.Adding, LibraryAddPhase.Idle]
    );
  });

  test("names the coordinate the offer carries to the host's install", async () => {
    const asked: string[] = [];
    await addOffer(
      async (named) => {
        asked.push(named);
        return true;
      },
      coordinate,
      () => {}
    );

    assert.deepEqual(asked, [coordinate]);
  });
});

describe("what an install reports to the session standing behind it", () => {
  /** Offers whose install answers `added` and shelves {@link coordinate} unheld. */
  function offers(added: boolean | (() => Promise<boolean>)): LibraryOffers {
    return {
      entryFor: () => shelved(false),
      install: typeof added === "boolean" ? async () => added : added,
    };
  }

  /** The coordinates one tap through `offers`, reporting to a recorder, told the session. */
  async function reported(offered: LibraryOffers): Promise<{ added: string[]; answered: boolean }> {
    const added: string[] = [];
    const reporting = offersReporting(offered, (named) => added.push(named));
    if (reporting === undefined) throw new Error("offers standing report through offers standing");
    return { added, answered: await reporting.install(coordinate) };
  }

  test("names the coordinate an install added, and answers what the install answered", async () => {
    assert.deepEqual(await reported(offers(true)), { added: [coordinate], answered: true });
  });

  test("names nothing for an install that added nothing, refusals and already-held alike", async () => {
    assert.deepEqual(await reported(offers(false)), { added: [], answered: false });
  });

  test("names nothing for an install that failed outright, and lets the failure through", async () => {
    const reporting = offersReporting(
      offers(async () => {
        throw new Error("the install threw");
      }),
      () => {
        throw new Error("an install that threw added nothing");
      }
    );

    await assert.rejects(() => reporting?.install(coordinate) ?? Promise.resolve(false));
  });

  test("leaves the shelf the host stands reachable, and stands nothing where the host stands nothing", () => {
    assert.equal(offersReporting(offers(true), () => {})?.entryFor(coordinate)?.coordinate, coordinate);
    assert.equal(
      offersReporting(undefined, () => {}),
      undefined
    );
  });
});
