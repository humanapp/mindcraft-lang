/**
 * Pins how the workspaces a host serves tool calls through carry its featuring:
 * read as each workspace is handed out, so the project the person switched to
 * is the one the next tool call reads by. Also pins that they carry the
 * assistant sections the target documents its tiles with.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CatalogFeaturing, TargetAdapter } from "@wendoo/assistant-bridge";
import { createAuthoringWorkspace } from "@wendoo/assistant-bridge";
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

/** Workspaces standing one editor's working copy, featuring what `featuring` reports when asked. */
function standing(
  featuring?: () => CatalogFeaturing,
  target?: TargetAdapter
): { workspaces: EditedBrainWorkspaces; brainId: string } {
  const adapter: TargetAdapter = target ?? createTargetAdapter();
  const seed = createAuthoringWorkspace(adapter, "fake brain");
  const workspaces = createEditedBrainWorkspaces({
    environment: seed.environment,
    adapter,
    ...(featuring ? { featuring } : {}),
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
