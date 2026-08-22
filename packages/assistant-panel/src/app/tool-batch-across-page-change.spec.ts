/**
 * Pins that a tool's edit batch replaying across a page change lands as one
 * entry: the page that stops rendering releases only its own held rule, and the
 * batch closes holding everything it built, taken back in one undo.
 *
 * Driven through real workspaces over a real command history.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AuthoringWorkspace, ProposeEditInput } from "@wendoo/assistant-bridge";
import { batchReplayStepMs, createAuthoringWorkspace, proposeEditBatch, readProject } from "@wendoo/assistant-bridge";
import { createTargetAdapter } from "@wendoo/assistant-bridge/testing";
import type { BrainEditOrigin } from "@wendoo/core/brain/model";
import { BrainCommandHistory, BrainEditOrigin as EditOrigin } from "@wendoo/core/brain/model";
import { releaseHeldRule } from "@wendoo/ui/brain-editor/rule-pickup-release";
import { createEditedBrainWorkspaces } from "./edited-brain-workspaces";

/** Tiles the fake target's brains are authored from. */
const tiles = {
  sensor: "tile.sensor->sensor.fake.signal",
  actuator: "tile.actuator->actuator.fake.emit",
} as const;

/** The batch that adds a page and fills the rule it opens with. */
const kPageBuild: ProposeEditInput[] = [
  { op: "addPage", name: "Night" },
  { op: "placeTiles", ruleId: "#0", side: "when", tileIds: [tiles.sensor] },
  { op: "placeTiles", ruleId: "#0", side: "do", tileIds: [tiles.actuator] },
];

/** What one authoring session is driven over: the workspace tool calls run against, and the editor's own history. */
interface EditingSession {
  readonly workspace: AuthoringWorkspace;
  readonly history: BrainCommandHistory;
  /** The origins every change to the history was reported under, in order. */
  readonly origins: BrainEditOrigin[];
}

/** A session over the fake target, standing an editor's working copy and history. */
function editingSession(): EditingSession {
  const adapter = createTargetAdapter();
  const seed = createAuthoringWorkspace(adapter, "fake brain");
  const history = new BrainCommandHistory();
  const origins: BrainEditOrigin[] = [];
  history.onChange((origin) => origins.push(origin));
  const workspaces = createEditedBrainWorkspaces({ environment: seed.environment, adapter });
  workspaces.setEditedBrain({
    brainDef: seed.brainDef,
    history,
    reveal: () => {},
    takeKeyboard: () => true,
  });
  return { workspace: workspaces.workspaceFor(seed.brainDef.id()), history, origins };
}

/** Resolves after `ms`. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("a page that stops rendering while a tool's batch is replaying", () => {
  test("leaves the batch to land as one entry, holding everything it built", async () => {
    const session = editingSession();

    const run = proposeEditBatch(session.workspace, { op: "batch", commands: kPageBuild });
    await pause(batchReplayStepMs);
    releaseHeldRule(session.history, { pickup: null, setPickup: () => {} });
    const result = await run;

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(session.history.undoDepth(), 1);
    const pages = readProject(session.workspace).pages;
    assert.equal(pages.length, 2);
    const added = pages[1]?.rules[0];
    assert.deepEqual(
      added?.when.map((tile) => tile.tileId),
      [tiles.sensor]
    );
    assert.deepEqual(
      added?.do.map((tile) => tile.tileId),
      [tiles.actuator]
    );
  });

  test("takes the whole batch back in one undo", async () => {
    const session = editingSession();

    const run = proposeEditBatch(session.workspace, { op: "batch", commands: kPageBuild });
    await pause(batchReplayStepMs);
    releaseHeldRule(session.history, { pickup: null, setPickup: () => {} });
    await run;
    session.history.undo();

    assert.equal(readProject(session.workspace).pages.length, 1);
    assert.equal(session.history.undoDepth(), 0);
  });

  test("reports no change as the person's, so nothing reads as the person taking over", async () => {
    const session = editingSession();

    const run = proposeEditBatch(session.workspace, { op: "batch", commands: kPageBuild });
    await pause(batchReplayStepMs);
    releaseHeldRule(session.history, { pickup: null, setPickup: () => {} });
    await run;

    assert.equal(session.origins.length > 0, true);
    assert.deepEqual(
      session.origins.filter((origin) => origin !== EditOrigin.Tool),
      []
    );
  });
});
