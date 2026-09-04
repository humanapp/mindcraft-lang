import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createTargetAdapter } from "../testing/index.js";
import { executeToolCall } from "./dispatch.js";
import type { LibraryOffered } from "./offer-libraries.js";
import { LibraryOfferUnknownCode, LibraryOfferVerdict, offerLibraries } from "./offer-libraries.js";
import type { LibraryShelfEntry } from "./read-libraries.js";
import { maxOfferedLibraries, toolInputSchemas } from "./tool-schemas.js";
import type { AuthoringWorkspace } from "./workspace.js";
import { createAuthoringWorkspace } from "./workspace.js";

/** The libraries an app shelves, one installed and one not. */
const shelf: readonly LibraryShelfEntry[] = [
  {
    coordinate: "acme/lib-chassis",
    name: "Chassis",
    version: "0.2.4",
    description: "Drives the wheels: turn, pivot, and stop.",
    installed: true,
  },
  {
    coordinate: "acme/lib-gamepad",
    name: "Gamepad",
    version: "0.2.2",
    description: "Reads the thumb stick and the colored buttons.",
    installed: false,
  },
];

/** A workspace over the fake target, shelving whatever `libraries` reports when asked. */
function workspace(libraries?: () => readonly LibraryShelfEntry[]): AuthoringWorkspace {
  const opened = createAuthoringWorkspace(createTargetAdapter(), "fake brain");
  return libraries ? { ...opened, libraryShelf: libraries } : opened;
}

/** The verdict each of `offers` came back under, in order. */
function verdicts(offers: readonly LibraryOffered[]): string[] {
  return offers.map((offer) => offer.verdict);
}

describe("the libraries a session offers", () => {
  test("stands a coordinate the shelf holds as listed, carrying no code", () => {
    const view = offerLibraries(
      workspace(() => shelf),
      { coordinates: ["acme/lib-gamepad"] }
    );

    assert.deepEqual(view.offers, [{ coordinate: "acme/lib-gamepad", verdict: LibraryOfferVerdict.Listed }]);
  });

  test("answers one verdict per coordinate, in the order they were named", () => {
    const view = offerLibraries(
      workspace(() => shelf),
      { coordinates: ["acme/lib-gamepad", "acme/lib-absent", "acme/lib-chassis"] }
    );

    assert.deepEqual(
      view.offers.map((offer) => offer.coordinate),
      ["acme/lib-gamepad", "acme/lib-absent", "acme/lib-chassis"]
    );
    assert.deepEqual(verdicts(view.offers), [
      LibraryOfferVerdict.Listed,
      LibraryOfferVerdict.Unknown,
      LibraryOfferVerdict.Listed,
    ]);
  });

  test("stands a coordinate the shelf does not hold as unknown, under the code that says so", () => {
    const offered = offerLibraries(
      workspace(() => shelf),
      { coordinates: ["acme/lib-absent"] }
    ).offers[0];

    assert.equal(offered?.verdict, LibraryOfferVerdict.Unknown);
    assert.equal(offered?.code, LibraryOfferUnknownCode.NotShelved);
    assert.equal(typeof offered?.message, "string");
  });

  test("stands every coordinate unknown for a session carrying no shelf, under its own code", () => {
    const view = offerLibraries(workspace(), { coordinates: ["acme/lib-gamepad"] });

    assert.equal(view.offers[0]?.code, LibraryOfferUnknownCode.NoShelf);
  });

  test("answers a bare shelf the same as no shelf: nothing to offer, never a coordinate to correct", () => {
    const view = offerLibraries({ ...workspace(), libraryShelf: () => [] }, { coordinates: ["acme/lib-gamepad"] });

    assert.equal(view.offers[0]?.verdict, LibraryOfferVerdict.Unknown);
    assert.equal(view.offers[0]?.code, LibraryOfferUnknownCode.NoShelf);
  });

  test("answers a call whose every coordinate is unknown, carrying only unknown verdicts", () => {
    const view = offerLibraries(
      workspace(() => shelf),
      { coordinates: ["acme/lib-absent", "acme/lib-gone"] }
    );

    assert.deepEqual(verdicts(view.offers), [LibraryOfferVerdict.Unknown, LibraryOfferVerdict.Unknown]);
    assert.deepEqual(
      view.offers.map((offer) => offer.code),
      [LibraryOfferUnknownCode.NotShelved, LibraryOfferUnknownCode.NotShelved]
    );
  });

  test("reads the shelf as the call runs, so a project switched to is the one it judges against", () => {
    let current = shelf;
    const ws = workspace(() => current);

    const opened = offerLibraries(ws, { coordinates: ["acme/lib-gamepad"] });
    current = [];
    const switched = offerLibraries(ws, { coordinates: ["acme/lib-gamepad"] });

    assert.deepEqual(verdicts(opened.offers), [LibraryOfferVerdict.Listed]);
    assert.deepEqual(verdicts(switched.offers), [LibraryOfferVerdict.Unknown]);
  });

  test("judges each session against its own shelf, however the calls interleave", () => {
    const first = workspace(() => shelf);
    const second = workspace(() => [shelf[1]!]);
    const bare = workspace();
    const both = { coordinates: ["acme/lib-chassis", "acme/lib-gamepad"] };

    assert.deepEqual(verdicts(offerLibraries(first, both).offers), [
      LibraryOfferVerdict.Listed,
      LibraryOfferVerdict.Listed,
    ]);
    assert.deepEqual(verdicts(offerLibraries(second, both).offers), [
      LibraryOfferVerdict.Unknown,
      LibraryOfferVerdict.Listed,
    ]);
    assert.deepEqual(verdicts(offerLibraries(bare, both).offers), [
      LibraryOfferVerdict.Unknown,
      LibraryOfferVerdict.Unknown,
    ]);
    assert.deepEqual(verdicts(offerLibraries(first, both).offers), [
      LibraryOfferVerdict.Listed,
      LibraryOfferVerdict.Listed,
    ]);
  });
});

describe("how many libraries one offer may present", () => {
  /** Whether the schema takes an offer of `count` coordinates. */
  function takes(count: number): boolean {
    const coordinates = Array.from({ length: count }, (_, at) => `acme/lib-${at}`);
    return toolInputSchemas.offer_libraries.safeParse({ coordinates }).success;
  }

  test("refuses a call naming no library at all", () => {
    assert.equal(takes(0), false);
  });

  test("takes up to the libraries one offer presents, and refuses one more", () => {
    assert.equal(takes(maxOfferedLibraries), true);
    assert.equal(takes(maxOfferedLibraries + 1), false);
  });

  test("refuses a coordinate that is empty, and one that is not text", () => {
    assert.equal(toolInputSchemas.offer_libraries.safeParse({ coordinates: [""] }).success, false);
    assert.equal(toolInputSchemas.offer_libraries.safeParse({ coordinates: [7] }).success, false);
  });
});

describe("the offer served through the tool dispatch", () => {
  test("flags an empty-handed offer as an error, its verdicts intact, so churn can see repeats", async () => {
    const served = await executeToolCall(
      workspace(() => shelf),
      "offer_libraries",
      { coordinates: ["acme/lib-unknown"] }
    );

    assert.equal(served.isError, true);
    const view = served.payload as { offers: readonly LibraryOffered[] };
    assert.equal(view.offers[0]?.verdict, LibraryOfferVerdict.Unknown);
    assert.equal(view.offers[0]?.code, LibraryOfferUnknownCode.NotShelved);
  });

  test("keeps a partly listed offer an ordinary answer", async () => {
    const served = await executeToolCall(
      workspace(() => shelf),
      "offer_libraries",
      { coordinates: ["acme/lib-chassis", "acme/lib-unknown"] }
    );

    assert.equal(served.isError, undefined);
  });

  test("answers a call by name over the workspace's own shelf", async () => {
    const served = await executeToolCall(
      workspace(() => shelf),
      "offer_libraries",
      { coordinates: ["acme/lib-chassis"] }
    );

    assert.equal(served.isError, undefined);
    assert.deepEqual(served.payload, {
      offers: [{ coordinate: "acme/lib-chassis", verdict: LibraryOfferVerdict.Listed }],
    });
  });

  test("refuses a call over the count the schema takes, before any card is presented", async () => {
    const served = await executeToolCall(
      workspace(() => shelf),
      "offer_libraries",
      { coordinates: ["a/one", "a/two", "a/three", "a/four"] }
    );

    assert.equal(served.isError, true);
  });

  test("answers an empty-handed call with its verdicts, never a thrown or replaced payload", async () => {
    const served = await executeToolCall(
      workspace(() => shelf),
      "offer_libraries",
      { coordinates: ["acme/lib-absent"] }
    );

    assert.deepEqual(verdicts((served.payload as { offers: LibraryOffered[] }).offers), [LibraryOfferVerdict.Unknown]);
  });
});
