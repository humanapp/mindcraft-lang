/**
 * Pins what an assistant's tool calls reach in this app: the working copy an
 * open editor stands, and nothing at all once the editor is gone. Serves a real
 * authoring batch over that workspace and reads the result out of the editor's
 * document and history.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AuthoringWorkspace, TargetAdapter } from "@wendoo/assistant-bridge";
import { serveToolCalls } from "@wendoo/assistant-bridge/relay";
import { ruleIdAt } from "@wendoo/assistant-bridge/testing";
import type { EditedBrainWorkspaces, PersonActivity } from "@wendoo/assistant-panel";
import {
  createEditedBrainWorkspaces,
  createPersonActivity,
  NoEditedBrain,
  NoEditedBrainCode,
  personInteractionWindowMs,
} from "@wendoo/assistant-panel";
import type { WendooEnvironment } from "@wendoo/core/app";
import { coreModule, createWendooEnvironment, List } from "@wendoo/core/app";
import type { BrainPageDef, BrainRuleDef } from "@wendoo/core/brain/model";
import { AddRuleCommand, BrainCommandHistory, BrainDef, BrainEditOrigin } from "@wendoo/core/brain/model";
import type { EditedBrain, EditedBrainPlace } from "@wendoo/ui";
import { createEcosimModule } from "@/brain/index";
import { TileIds } from "@/brain/tileids";
import { createTargetAdapter } from "@/rehearsal/adapter";
import { sourceRehearsalContent } from "@/rehearsal/source-content";

/** The app's own assets, read from the tree these specs run in. */
const CONTENT = sourceRehearsalContent();

/** Milliseconds a served request is given, as the service sets it. */
const CALL_TIMEOUT_MS = 15000;

/** The edits one authoring batch asks for: a rule that flees what it sees. */
const authoringCalls = [
  {
    op: "placeTiles",
    side: "when",
    tileIds: ["tile.sensor->sensor.see", `tile.modifier->${TileIds.Modifier.ActorKindCarnivore}`],
  },
  {
    op: "placeTiles",
    side: "do",
    tileIds: [
      "tile.actuator->actuator.move",
      `tile.modifier->${TileIds.Modifier.MovementAwayFrom}`,
      "tile.literal->struct:<ActorRef>->it",
    ],
  },
] as const;

/** One app, as far as the workspaces are concerned: its environment and its target. */
interface AppStand {
  readonly environment: WendooEnvironment;
  readonly adapter: TargetAdapter;
  readonly workspaces: EditedBrainWorkspaces;
  /** Where the person's own acting is recorded, over a clock the test moves itself. */
  readonly activity: PersonActivity;
  /** Move the clock the activity reads on by `ms`. */
  readonly pass: (ms: number) => void;
}

/** Stand an environment carrying this app's module, with the target adapter it authors for. */
function appStand(): AppStand {
  const environment = createWendooEnvironment({ modules: [coreModule(), createEcosimModule()] });
  const adapter = createTargetAdapter(CONTENT);
  let at = 0;
  const activity = createPersonActivity({ now: () => at });
  return {
    environment,
    adapter,
    activity,
    pass: (ms: number) => {
      at += ms;
    },
    workspaces: createEditedBrainWorkspaces({ environment, adapter, activity }),
  };
}

/** A brain of this app's, as the project holds it. */
function projectBrain(stand: AppStand, name: string): BrainDef {
  return BrainDef.emptyBrainDef(stand.environment.brainServices, name);
}

/** What an editor opened on `source` stands: its working copy, history, reveal, and keyboard handoff. */
function editorOpenedOn(stand: AppStand, source: BrainDef, reveal: EditedBrain["reveal"] = () => {}): EditedBrain {
  return {
    brainDef: source.workingCopy(List.from(stand.environment.tileCatalogs())),
    history: new BrainCommandHistory(),
    reveal,
    takeKeyboard: () => false,
  };
}

/** The tile ids on `side` of the document's first rule. */
function ruleSideTileIds(brainDef: BrainDef, side: "when" | "do"): string[] {
  const page = brainDef.pages().get(0) as BrainPageDef;
  const rule = page.children().get(0) as BrainRuleDef;
  return (side === "when" ? rule.when() : rule.do())
    .tiles()
    .toArray()
    .map((tile) => tile.tileId);
}

/** Serve `calls` as one relay batch over `workspace`. */
function serveAuthoring(workspace: AuthoringWorkspace) {
  return serveToolCalls(workspace, {
    type: "turn:toolCalls",
    requests: authoringCalls.map((input, at) => ({
      requestId: `call-${at}`,
      name: "propose_edit",
      input: { ...input, ruleId: ruleIdAt(workspace.brainDef, "0/0") },
      timeoutMs: CALL_TIMEOUT_MS,
    })),
  });
}

describe("the workspace a brain's tool calls run against", () => {
  test("is refused while no editor stands a working copy", () => {
    const stand = appStand();

    assert.throws(
      () => stand.workspaces.workspaceFor("brain-a"),
      (error: unknown) => error instanceof NoEditedBrain && error.code === NoEditedBrainCode.NoEditorOpen
    );
  });

  test("is refused while the editor stands another brain's working copy", () => {
    const stand = appStand();
    stand.workspaces.setEditedBrain(editorOpenedOn(stand, projectBrain(stand, "herbivore")));

    assert.throws(
      () => stand.workspaces.workspaceFor("some other brain"),
      (error: unknown) => error instanceof NoEditedBrain && error.code === NoEditedBrainCode.AnotherBrainEdited
    );
  });

  test("carries the working copy and history the editor stands, and the app's own target", () => {
    const stand = appStand();
    const source = projectBrain(stand, "herbivore");
    const edited = editorOpenedOn(stand, source);
    stand.workspaces.setEditedBrain(edited);

    const workspace = stand.workspaces.workspaceFor(source.id());

    assert.equal(workspace.brainDef, edited.brainDef);
    assert.equal(workspace.environment, stand.environment);
    assert.equal(workspace.adapter, stand.adapter);

    const page = edited.brainDef.pages().get(0) as BrainPageDef;
    workspace.history.executeCommand(new AddRuleCommand(page));
    assert.equal(edited.history.undoDepth(), 1, "the workspace runs commands through the editor's own history");
  });

  test("follows the editor from one brain to the next", () => {
    const stand = appStand();
    const herbivore = projectBrain(stand, "herbivore");
    const carnivore = projectBrain(stand, "carnivore");
    const workspaceFor = stand.workspaces.workspaceFor;

    stand.workspaces.setEditedBrain(editorOpenedOn(stand, herbivore));
    assert.equal(workspaceFor(herbivore.id()).brainDef.id(), herbivore.id());

    stand.workspaces.setEditedBrain(editorOpenedOn(stand, carnivore));
    assert.equal(workspaceFor(carnivore.id()).brainDef.id(), carnivore.id());
    assert.throws(() => workspaceFor(herbivore.id()), NoEditedBrain);
  });
});

describe("a turn's edits served over the standing working copy", () => {
  test("land in the editor's document as entries its own undo takes back", async () => {
    const stand = appStand();
    const source = projectBrain(stand, "herbivore");
    const edited = editorOpenedOn(stand, source);
    stand.workspaces.setEditedBrain(edited);
    // The editor's own undo/redo listener, and a second one standing beside it.
    const notified = [0, 0];
    edited.history.onChange(() => {
      notified[0]++;
    });
    edited.history.onChange(() => {
      notified[1]++;
    });

    const served = await serveAuthoring(stand.workspaces.workspaceFor(source.id()));

    assert.deepEqual(
      served.results.map((result) => result.outcome.kind),
      ["ok", "ok"]
    );
    assert.deepEqual(
      served.results.map((result) => result.outcome.kind === "ok" && result.outcome.isError === undefined),
      [true, true]
    );
    assert.deepEqual(ruleSideTileIds(edited.brainDef, "when"), [...authoringCalls[0].tileIds]);
    assert.deepEqual(ruleSideTileIds(edited.brainDef, "do"), [...authoringCalls[1].tileIds]);
    assert.equal(edited.history.undoDepth(), authoringCalls.length);
    assert.ok(notified[0]! > 0);
    assert.equal(notified[0], notified[1]);

    edited.history.undo();
    assert.deepEqual(ruleSideTileIds(edited.brainDef, "do"), []);
    edited.history.undo();
    assert.deepEqual(ruleSideTileIds(edited.brainDef, "when"), []);
    assert.equal(edited.history.canUndo(), false);
    assert.deepEqual(ruleSideTileIds(source, "when"), [], "the project's own brain takes no edit of the turn's");
  });

  test("tell the editor's reveal the page and rule each of them landed on", async () => {
    const stand = appStand();
    const source = projectBrain(stand, "herbivore");
    const revealed: EditedBrainPlace[] = [];
    const edited = editorOpenedOn(stand, source, (place) => revealed.push(place));
    stand.workspaces.setEditedBrain(edited);

    await serveAuthoring(stand.workspaces.workspaceFor(source.id()));

    const page = edited.brainDef.pages().get(0) as BrainPageDef;
    const rule = page.children().get(0) as BrainRuleDef;
    const place = { pageId: page.pageId(), ruleId: rule.ruleId() };
    assert.deepEqual(revealed, [place, place]);
  });

  test("stop landing anywhere once the editor is gone", async () => {
    const stand = appStand();
    const source = projectBrain(stand, "herbivore");
    stand.workspaces.setEditedBrain(editorOpenedOn(stand, source));
    await serveAuthoring(stand.workspaces.workspaceFor(source.id()));

    stand.workspaces.setEditedBrain(undefined);

    assert.throws(
      () => stand.workspaces.workspaceFor(source.id()),
      (error: unknown) => error instanceof NoEditedBrain && error.code === NoEditedBrainCode.NoEditorOpen
    );
  });
});

describe("what the person's own hands are recorded as", () => {
  test("a turn's edits record nothing, whatever they do to the document", async () => {
    const stand = appStand();
    const source = projectBrain(stand, "herbivore");
    const edited = editorOpenedOn(stand, source);
    stand.workspaces.setEditedBrain(edited);

    const served = await serveAuthoring(stand.workspaces.workspaceFor(source.id()));

    assert.deepEqual(
      served.results.map((result) => result.outcome.kind),
      ["ok", "ok"],
      "the edits really ran"
    );
    assert.ok(edited.history.undoDepth() > 0, "the edits really reached the history");
    assert.equal(stand.activity.mutations(source.id()), 0);
  });

  test("a command the editor runs outside a turn is the person's", () => {
    const stand = appStand();
    const source = projectBrain(stand, "herbivore");
    const edited = editorOpenedOn(stand, source);
    stand.workspaces.setEditedBrain(edited);

    edited.history.executeCommand(new AddRuleCommand(edited.brainDef.pages().get(0) as BrainPageDef));

    assert.equal(stand.activity.mutations(source.id()), 1);
  });

  test("taking a turn's edit back is the person's", async () => {
    const stand = appStand();
    const source = projectBrain(stand, "herbivore");
    const edited = editorOpenedOn(stand, source);
    stand.workspaces.setEditedBrain(edited);
    await serveAuthoring(stand.workspaces.workspaceFor(source.id()));
    assert.equal(stand.activity.mutations(source.id()), 0);

    edited.history.undo();

    assert.equal(stand.activity.mutations(source.id()), 1);
  });

  test("a change the editor marks as its own records nothing", () => {
    const stand = appStand();
    const source = projectBrain(stand, "herbivore");
    const edited = editorOpenedOn(stand, source);
    stand.workspaces.setEditedBrain(edited);

    edited.history.runAs(BrainEditOrigin.Editor, () => {
      edited.history.executeCommand(new AddRuleCommand(edited.brainDef.pages().get(0) as BrainPageDef));
      edited.history.clear();
    });

    assert.equal(stand.activity.mutations(source.id()), 0);
  });

  test("stops recording the brain the editor has moved off", () => {
    const stand = appStand();
    const herbivore = projectBrain(stand, "herbivore");
    const edited = editorOpenedOn(stand, herbivore);
    stand.workspaces.setEditedBrain(edited);
    stand.workspaces.setEditedBrain(undefined);

    edited.history.executeCommand(new AddRuleCommand(edited.brainDef.pages().get(0) as BrainPageDef));

    assert.equal(stand.activity.mutations(herbivore.id()), 0);
  });
});

describe("bringing a landed edit into view while the person is working", () => {
  /** The places a turn's edits over `stand` were brought into view at. */
  async function revealedBy(stand: AppStand, source: BrainDef): Promise<EditedBrainPlace[]> {
    const revealed: EditedBrainPlace[] = [];
    stand.workspaces.setEditedBrain(editorOpenedOn(stand, source, (place) => revealed.push(place)));
    await serveAuthoring(stand.workspaces.workspaceFor(source.id()));
    return revealed;
  }

  test("leaves the view alone while the person has just touched the rules", async () => {
    const stand = appStand();
    const source = projectBrain(stand, "herbivore");
    stand.activity.noteInteraction(source.id());

    assert.deepEqual(await revealedBy(stand, source), []);
  });

  test("brings the rule into view again once the window has run out", async () => {
    const stand = appStand();
    const source = projectBrain(stand, "herbivore");
    stand.activity.noteInteraction(source.id());
    stand.pass(personInteractionWindowMs);

    assert.equal((await revealedBy(stand, source)).length, authoringCalls.length);
  });

  test("brings the rule into view when the person has touched nothing", async () => {
    const stand = appStand();
    const source = projectBrain(stand, "herbivore");

    assert.equal((await revealedBy(stand, source)).length, authoringCalls.length);
  });
});
