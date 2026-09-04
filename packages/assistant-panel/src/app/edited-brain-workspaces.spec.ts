/**
 * Pins how the workspaces a host serves tool calls through carry its featuring
 * and its library shelf: both read as of the call, so the project the person
 * switched to is the one the next tool call reads by. Also pins that they carry
 * the assistant sections the target documents its tiles with.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CatalogFeaturing, LibraryShelfEntry, TargetAdapter } from "@wendoo/assistant-bridge";
import { createAuthoringWorkspace, readLibraries } from "@wendoo/assistant-bridge";
import { createTargetAdapter } from "@wendoo/assistant-bridge/testing";
import { BrainCommandHistory } from "@wendoo/core/brain/model";
import type { EditedBrainWorkspaces } from "./edited-brain-workspaces";
import { createEditedBrainWorkspaces } from "./edited-brain-workspaces";

/** The library an app's catalog lists. */
const chassis = "acme/lib-chassis";

/** A tile the target below documents. */
const documentedTile = "tile.sensor->sensor.fake.signal";

/** The teaching that tile's documentation reserves for the model. */
const teaching = "Read the signal once a think.";

/** The fake target, documenting {@link documentedTile} with an assistant section. */
function documentingTarget(): TargetAdapter {
  const docs = new Map([
    [documentedTile, `# Signal\n\nReads the fake signal.\n\n\`\`\`assistant\n${teaching}\n\`\`\`\n`],
  ]);
  return { ...createTargetAdapter(), tileDocs: () => docs };
}

/**
 * Workspaces standing one editor's working copy, featuring what `featuring`
 * reports when asked and shelving what `libraryShelf` reports.
 */
function standing(
  featuring?: () => CatalogFeaturing,
  target?: TargetAdapter,
  libraryShelf?: () => readonly LibraryShelfEntry[]
): { workspaces: EditedBrainWorkspaces; brainId: string } {
  const adapter: TargetAdapter = target ?? createTargetAdapter();
  const seed = createAuthoringWorkspace(adapter, "fake brain");
  const workspaces = createEditedBrainWorkspaces({
    environment: seed.environment,
    adapter,
    ...(featuring ? { featuring } : {}),
    ...(libraryShelf ? { libraryShelf } : {}),
  });
  workspaces.setEditedBrain({
    brainDef: seed.brainDef,
    history: new BrainCommandHistory(),
    reveal: () => {},
    takeKeyboard: () => true,
  });
  return { workspaces, brainId: seed.brainDef.id() };
}

describe("the featuring a served workspace carries", () => {
  test("reports the host's own project as of the call, not as of the app's start", () => {
    let hostNamespace = "acme/first-project";
    const { workspaces, brainId } = standing(() => ({ featured: new Set([chassis]), hostNamespace }));

    const opened = workspaces.workspaceFor(brainId).featuring;
    hostNamespace = "acme/second-project";
    const switched = workspaces.workspaceFor(brainId).featuring;

    assert.equal(opened?.hostNamespace, "acme/first-project");
    assert.equal(switched?.hostNamespace, "acme/second-project");
    assert.deepEqual([...(switched?.featured ?? [])], [chassis]);
  });

  test("carries none for a host that supplies none", () => {
    const { workspaces, brainId } = standing();

    assert.equal(workspaces.workspaceFor(brainId).featuring, undefined);
  });

  test("keeps each host's featuring its own across coexisting workspaces", () => {
    const first = standing(() => ({ featured: new Set([chassis]), hostNamespace: "acme/first-project" }));
    const second = standing(() => ({ featured: new Set<string>(), hostNamespace: "acme/second-project" }));
    const bare = standing();

    const fromFirst = first.workspaces.workspaceFor(first.brainId).featuring;
    const fromSecond = second.workspaces.workspaceFor(second.brainId).featuring;

    assert.deepEqual([...(fromFirst?.featured ?? [])], [chassis]);
    assert.equal(fromFirst?.hostNamespace, "acme/first-project");
    assert.deepEqual([...(fromSecond?.featured ?? [])], []);
    assert.equal(fromSecond?.hostNamespace, "acme/second-project");
    assert.equal(bare.workspaces.workspaceFor(bare.brainId).featuring, undefined);
  });
});

describe("the library shelf a served workspace carries", () => {
  /** The libraries an app shelves for the project it has open. */
  const shelved: readonly LibraryShelfEntry[] = [
    { coordinate: chassis, name: "Chassis", version: "0.2.4", description: "Drives the wheels.", installed: false },
  ];

  test("serves the shelf the app reports as of the call, not as of the app's start", () => {
    let libraries = shelved;
    const { workspaces, brainId } = standing(undefined, undefined, () => libraries);

    const opened = readLibraries(workspaces.workspaceFor(brainId), {});
    libraries = [{ ...shelved[0]!, installed: true }];
    const installed = readLibraries(workspaces.workspaceFor(brainId), {});

    assert.deepEqual(opened.libraries, shelved);
    assert.equal(installed.libraries[0]?.installed, true);
  });

  test("carries none for a host that supplies none, which reads as an empty shelf", () => {
    const { workspaces, brainId } = standing();

    assert.equal(workspaces.workspaceFor(brainId).libraryShelf, undefined);
    assert.deepEqual(readLibraries(workspaces.workspaceFor(brainId), {}).libraries, []);
  });

  test("keeps each host's shelf its own across coexisting workspaces", () => {
    const first = standing(undefined, undefined, () => shelved);
    const second = standing(undefined, undefined, () => []);

    assert.deepEqual(
      readLibraries(first.workspaces.workspaceFor(first.brainId), {}).libraries.map((entry) => entry.coordinate),
      [chassis]
    );
    assert.deepEqual(readLibraries(second.workspaces.workspaceFor(second.brainId), {}).libraries, []);
  });
});

describe("the library offers the workspaces carry", () => {
  /** The libraries an app shelves for the project it has open. */
  const shelved: readonly LibraryShelfEntry[] = [
    { coordinate: chassis, name: "Chassis", version: "0.2.4", description: "Drives the wheels.", installed: false },
  ];

  /** Workspaces shelving what `libraryShelf` reports and adding through `installLibrary`. */
  function offering(
    libraryShelf?: () => readonly LibraryShelfEntry[],
    installLibrary?: (coordinate: string) => Promise<boolean>
  ): EditedBrainWorkspaces {
    const adapter = createTargetAdapter();
    const seed = createAuthoringWorkspace(adapter, "fake brain");
    return createEditedBrainWorkspaces({
      environment: seed.environment,
      adapter,
      ...(libraryShelf ? { libraryShelf } : {}),
      ...(installLibrary ? { installLibrary } : {}),
    });
  }

  test("offers nothing while the app carries a shelf but no install", () => {
    assert.equal(offering(() => shelved).libraryOffers, undefined);
  });

  test("offers nothing while the app carries an install but no shelf", () => {
    assert.equal(offering(undefined, async () => true).libraryOffers, undefined);
  });

  test("reads the shelf as an offer is drawn, so a project switched to answers from its own", () => {
    let libraries = shelved;
    const offers = offering(
      () => libraries,
      async () => true
    );

    const opened = offers.libraryOffers?.entryFor(chassis);
    libraries = [];
    const switched = offers.libraryOffers?.entryFor(chassis);

    assert.equal(opened?.name, "Chassis");
    assert.equal(switched, undefined);
  });

  test("hands the coordinate the offer names to the app's own install", async () => {
    const asked: string[] = [];
    const offers = offering(
      () => shelved,
      async (coordinate) => {
        asked.push(coordinate);
        return true;
      }
    );

    assert.equal(await offers.libraryOffers?.install(chassis), true);
    assert.deepEqual(asked, [chassis]);
  });

  test("keeps each app's offers its own across coexisting workspaces", async () => {
    const added: string[] = [];
    const first = offering(
      () => shelved,
      async () => {
        added.push("first");
        return true;
      }
    );
    const second = offering(
      () => [],
      async () => {
        added.push("second");
        return false;
      }
    );

    assert.equal(first.libraryOffers?.entryFor(chassis)?.name, "Chassis");
    assert.equal(second.libraryOffers?.entryFor(chassis), undefined);
    assert.equal(await second.libraryOffers?.install(chassis), false);
    assert.deepEqual(added, ["second"]);
  });
});

describe("the tile documentation a served workspace carries", () => {
  test("carries the assistant section the target documents a tile with", () => {
    const { workspaces, brainId } = standing(undefined, documentingTarget());

    const served = workspaces.workspaceFor(brainId);

    assert.equal(served.assistantSections.get(documentedTile), teaching);
    assert.equal(served.descriptions.get(documentedTile), "Reads the fake signal.");
  });

  test("carries none for a target documenting no tile with one", () => {
    const { workspaces, brainId } = standing();

    assert.equal(workspaces.workspaceFor(brainId).assistantSections.get(documentedTile), undefined);
  });
});
