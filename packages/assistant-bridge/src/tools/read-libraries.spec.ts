import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CATALOG_TEXT_LIMITS, TRUNCATION_MARKER } from "../catalog/sanitize.js";
import { createTargetAdapter } from "../testing/index.js";
import { executeToolCall } from "./dispatch.js";
import type { LibraryShelfEntry } from "./read-libraries.js";
import { readLibraries } from "./read-libraries.js";
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

describe("the libraries a session reads off the shelf", () => {
  test("serves every shelved library with its installed state", () => {
    const view = readLibraries(
      workspace(() => shelf),
      {}
    );

    assert.deepEqual(view.libraries, shelf);
    assert.equal(view.total, 2);
  });

  test("serves the fields the shelf declares and nothing else the host carried on the entry", () => {
    const carried = [{ ...shelf[1]!, ref: "gh:acme/lib-gamepad@0123456789", thumbnailUrl: "data:image/png;base64," }];

    const view = readLibraries(
      workspace(() => carried),
      {}
    );

    assert.deepEqual(Object.keys(view.libraries[0] ?? {}).sort(), [
      "coordinate",
      "description",
      "installed",
      "name",
      "version",
    ]);
  });

  test("never serves the page a library is published at, which the host alone opens", () => {
    const published = [{ ...shelf[1]!, sourceUrl: "https://github.com/acme/lib-gamepad" }];

    const view = readLibraries(
      workspace(() => published),
      {}
    );

    assert.equal("sourceUrl" in (view.libraries[0] ?? {}), false);
    assert.deepEqual(view.libraries, [shelf[1]]);
  });

  test("leaves an entry describing itself with nothing without a description", () => {
    const bare: LibraryShelfEntry = { coordinate: "acme/lib-bare", name: "Bare", version: "1.0.0", installed: false };

    const view = readLibraries(
      workspace(() => [bare]),
      {}
    );

    assert.deepEqual(view.libraries, [bare]);
    assert.equal("description" in (view.libraries[0] ?? {}), false);
  });

  test("lists none for a session carrying no shelf, and calls that no error", () => {
    const view = readLibraries(workspace(), {});

    assert.deepEqual(view.libraries, []);
    assert.equal(view.total, 0);
  });

  test("reads the shelf as the call runs, so a project switched to is the one it describes", () => {
    let current = shelf;
    const ws = workspace(() => current);

    const opened = readLibraries(ws, {});
    current = [];
    const switched = readLibraries(ws, {});

    assert.equal(opened.libraries.length, 2);
    assert.deepEqual(switched.libraries, []);
  });

  test("answers each session from its own shelf, however the calls interleave", () => {
    const first = workspace(() => shelf);
    const second = workspace(() => [shelf[1]!]);
    const bare = workspace();

    assert.deepEqual(
      readLibraries(first, {}).libraries.map((entry) => entry.coordinate),
      ["acme/lib-chassis", "acme/lib-gamepad"]
    );
    assert.deepEqual(
      readLibraries(second, {}).libraries.map((entry) => entry.coordinate),
      ["acme/lib-gamepad"]
    );
    assert.deepEqual(readLibraries(bare, {}).libraries, []);
    assert.equal(readLibraries(first, {}).total, 2);
  });

  test("cuts a name and a description that run past the catalog's limits", () => {
    const long: LibraryShelfEntry = {
      coordinate: "acme/lib-verbose",
      name: "n".repeat(CATALOG_TEXT_LIMITS.label + 40),
      version: "1.0.0",
      description: "d".repeat(CATALOG_TEXT_LIMITS.description + 40),
      installed: false,
    };

    const served = readLibraries(
      workspace(() => [long]),
      {}
    ).libraries[0];

    assert.equal(served?.name.length, CATALOG_TEXT_LIMITS.label);
    assert.equal(served?.name.endsWith(TRUNCATION_MARKER), true);
    assert.equal(served?.description?.length, CATALOG_TEXT_LIMITS.description);
    assert.equal(served?.description?.endsWith(TRUNCATION_MARKER), true);
  });
});

describe("narrowing the shelf with a filter", () => {
  /** The coordinates `filter` narrows the shelf to. */
  function narrowed(filter: string): string[] {
    return readLibraries(
      workspace(() => shelf),
      { filter }
    ).libraries.map((entry) => entry.coordinate);
  }

  test("matches the name, the coordinate, and the description, whatever the case", () => {
    assert.deepEqual(narrowed("GAMEPAD"), ["acme/lib-gamepad"]);
    assert.deepEqual(narrowed("lib-chassis"), ["acme/lib-chassis"]);
    assert.deepEqual(narrowed("thumb stick"), ["acme/lib-gamepad"]);
  });

  test("matches nothing else, and still reports the whole shelf as the total", () => {
    const view = readLibraries(
      workspace(() => shelf),
      { filter: "0.2.4" }
    );

    assert.deepEqual(view.libraries, []);
    assert.equal(view.total, 2, "the total says the shelf holds libraries the filter hid");
  });

  test("reads a filter of whitespace as no filter at all", () => {
    assert.equal(narrowed("   ").length, 2);
  });
});

describe("the shelf served through the tool dispatch", () => {
  test("answers a call by name over the workspace's own shelf", async () => {
    const served = await executeToolCall(
      workspace(() => shelf),
      "read_libraries",
      { filter: "chassis" }
    );

    assert.equal(served.isError, undefined);
    assert.deepEqual(served.payload, {
      libraries: [shelf[0]],
      total: 2,
    });
  });

  test("refuses a filter that is not text", async () => {
    const served = await executeToolCall(
      workspace(() => shelf),
      "read_libraries",
      { filter: 7 }
    );

    assert.equal(served.isError, true);
  });
});
