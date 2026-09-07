/**
 * Characterization suite for the brain editing command layer.
 *
 * Pins, for every concrete command kind, that executing the command through
 * BrainCommandHistory round-trips the program document (execute -> undo
 * restores the prior document, redo reapplies the change) and that
 * canUndo()/canRedo() transition correctly. Fixtures are real BrainDef
 * documents built through the real model APIs.
 *
 * Also pins working-copy isolation: the editor edits a working copy of the saved
 * program and drops it on discard, so every command must leave the source
 * document untouched when it runs against the copy.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@wendoo/core";
import type { BrainServices, IBrainTileDef } from "@wendoo/core/brain";
import {
  CoreVariableFactoryId,
  isPageTileId,
  mkVariableFactoryTileId,
  RuleSide,
  RuleTriggerMode,
} from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { tileSentenceWord } from "@wendoo/core/brain/language-service";
import {
  AddPageCommand,
  AddRuleCommand,
  AddTileCommand,
  type BrainCommand,
  BrainCommandHistory,
  BrainDef,
  BrainEditOrigin,
  type BrainPageDef,
  BrainRuleDef,
  DeleteRuleCommand,
  EditLiteralCommand,
  IndentRuleCommand,
  InsertRuleCommand,
  InsertTileCommand,
  MoveRuleCommand,
  MoveRuleDownCommand,
  MoveRuleUpCommand,
  OutdentRuleCommand,
  PasteRulesCommand,
  PasteTileBeforeCommand,
  RemovePageCommand,
  RemoveTileCommand,
  RenameBrainCommand,
  RenamePageCommand,
  RenameVariableCommand,
  ReplaceBrainCommand,
  ReplaceLastPageCommand,
  ReplaceTileCommand,
  type RuleJson,
  SetRuleCommentCommand,
  SetRuleTriggerCommand,
} from "@wendoo/core/brain/model";
import { type BrainTileFactoryDef, BrainTileLiteralDef, type BrainTileVariableDef } from "@wendoo/core/brain/tiles";
import { createDefaultLocalizer } from "@wendoo/core/localization";
import { CoreHostActions, CoreTypeIds, mkActuatorTileId, mkSensorTileId } from "@wendoo/core/runtime";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

// ---- Fixture helpers -------------------------------------------------------

/** A fresh single-page brain with one blank rule, built through the real model API. */
function newBrain(): BrainDef {
  return BrainDef.emptyBrainDef(services);
}

function firstPage(brain: BrainDef): BrainPageDef {
  return brain.pages().get(0) as BrainPageDef;
}

function firstRule(brain: BrainDef): BrainRuleDef {
  return firstPage(brain).children().get(0) as BrainRuleDef;
}

/** Fetch a registered core tile def by id, failing loudly when absent. */
function coreTile(tileId: string): IBrainTileDef {
  const tileDef = services.edit.tiles.get(tileId);
  assert.ok(tileDef, `core tile not registered: ${tileId}`);
  return tileDef;
}

function actuatorTile(): IBrainTileDef {
  return coreTile(mkActuatorTileId(CoreHostActions.SwitchPage.key));
}

function sensorTile(): IBrainTileDef {
  return coreTile(mkSensorTileId(CoreHostActions.Timeout.key));
}

/** Manufacture a number literal tile through the real API and register it in the brain's catalog. */
function numberLiteralTile(brain: BrainDef, value: number): IBrainTileDef {
  const tileDef = new BrainTileLiteralDef(CoreTypeIds.Number, value, {}, services);
  const existing = brain.catalog().get(tileDef.tileId);
  if (existing) return existing;
  brain.catalog().registerTileDef(tileDef);
  return tileDef;
}

/** Build a number literal carrying its own identity and register it in the brain's catalog. */
function uniqueLiteralTile(brain: BrainDef, uniqueId: string, value: number, displayName: string): BrainTileLiteralDef {
  const tileDef = new BrainTileLiteralDef(CoreTypeIds.Number, value, { uniqueId, displayName }, services);
  brain.catalog().registerTileDef(tileDef);
  return tileDef;
}

/** Ids of the literal tiles the brain's own catalog holds, in sorted order. */
function literalTileIds(brain: BrainDef): string[] {
  const ids: string[] = [];
  brain
    .catalog()
    .getAll()
    .forEach((tileDef) => {
      if (tileDef.kind === "literal") ids.push(tileDef.tileId);
    });
  return ids.sort();
}

/** Manufacture a number variable tile through its factory and register it in the brain's catalog. */
function numberVariableTile(brain: BrainDef, varName: string): BrainTileVariableDef {
  const factory = coreTile(mkVariableFactoryTileId(CoreVariableFactoryId.Number)) as BrainTileFactoryDef;
  const tileDef = factory.manufacture(factory, { name: varName }) as BrainTileVariableDef;
  brain.catalog().registerTileDef(tileDef);
  return tileDef;
}

// ---- Document shape --------------------------------------------------------
// The round-trip oracle is a structural projection of the document: brain
// name plus, per page, the page id, the page name, and the serialized rule
// tree (tile-id lists, comments, trigger modes, children).

interface RuleShape {
  when: string[];
  doSide: string[];
  comment?: string;
  trigger?: RuleTriggerMode;
  children: RuleShape[];
}

function ruleShape(json: RuleJson): RuleShape {
  const shape: RuleShape = {
    when: json.when.toArray(),
    doSide: json.do.toArray(),
    children: json.children.toArray().map(ruleShape),
  };
  if (json.comment !== undefined) shape.comment = json.comment;
  if (json.trigger !== undefined) shape.trigger = json.trigger;
  return shape;
}

function documentShape(brain: BrainDef): {
  name: string;
  pages: { pageId: string; name: string; rules: RuleShape[] }[];
} {
  return {
    name: brain.name(),
    pages: brain
      .pages()
      .toArray()
      .map((page) => ({
        pageId: page.pageId(),
        name: page.name(),
        rules: (page as BrainPageDef).toJson().rules.toArray().map(ruleShape),
      })),
  };
}

/**
 * Execute `command` on a fresh history and pin the full round trip:
 * execute changes the document, undo restores it exactly, redo reapplies
 * the change, and canUndo/canRedo transition at every step.
 */
function assertCommandRoundTrip(brain: BrainDef, command: BrainCommand): void {
  const history = new BrainCommandHistory();
  const beforeShape = documentShape(brain);
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);

  history.executeCommand(command);
  const afterShape = documentShape(brain);
  assert.notDeepEqual(afterShape, beforeShape, "execute must change the document");
  assert.equal(history.canUndo(), true);
  assert.equal(history.canRedo(), false);

  history.undo();
  assert.deepEqual(documentShape(brain), beforeShape, "undo must restore the prior document");
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), true);

  history.redo();
  assert.deepEqual(documentShape(brain), afterShape, "redo must reapply the change");
  assert.equal(history.canUndo(), true);
  assert.equal(history.canRedo(), false);
}

// ---- History behavior ------------------------------------------------------

/** Test command mutating a counter, for history-level behavior tests. */
class CounterCommand implements BrainCommand {
  executions = 0;
  constructor(private readonly state: { value: number }) {}
  execute(): void {
    this.executions++;
    this.state.value++;
  }
  undo(): void {
    this.state.value--;
  }
  getDescription(): string {
    return "counter";
  }
}

describe("BrainCommandHistory", () => {
  test("starts with no undo or redo available; undo/redo on empty stacks are no-ops", () => {
    const history = new BrainCommandHistory();
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), false);
    assert.equal(history.getUndoDescription(), undefined);
    assert.equal(history.getRedoDescription(), undefined);
    history.undo();
    history.redo();
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), false);
  });

  test("executeCommand runs the command and enables undo; descriptions become available", () => {
    const state = { value: 0 };
    const history = new BrainCommandHistory();
    const command = new CounterCommand(state);
    history.executeCommand(command);
    assert.equal(command.executions, 1);
    assert.equal(state.value, 1);
    assert.equal(history.canUndo(), true);
    assert.notEqual(history.getUndoDescription(), undefined);
    history.undo();
    assert.equal(state.value, 0);
    assert.notEqual(history.getRedoDescription(), undefined);
  });

  test("recordCommand adds to the undo stack without executing", () => {
    const state = { value: 0 };
    const history = new BrainCommandHistory();
    const command = new CounterCommand(state);
    history.recordCommand(command);
    assert.equal(command.executions, 0);
    assert.equal(state.value, 0);
    assert.equal(history.canUndo(), true);
    history.undo();
    assert.equal(state.value, -1);
  });

  test("executing a new command clears the redo stack", () => {
    const state = { value: 0 };
    const history = new BrainCommandHistory();
    history.executeCommand(new CounterCommand(state));
    history.undo();
    assert.equal(history.canRedo(), true);
    history.executeCommand(new CounterCommand(state));
    assert.equal(history.canRedo(), false);
  });

  test("clear empties both stacks", () => {
    const state = { value: 0 };
    const history = new BrainCommandHistory();
    history.executeCommand(new CounterCommand(state));
    history.executeCommand(new CounterCommand(state));
    history.undo();
    history.clear();
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), false);
  });

  test("history is capped at maxHistorySize by dropping the oldest command", () => {
    const state = { value: 0 };
    const history = new BrainCommandHistory(2);
    history.executeCommand(new CounterCommand(state));
    history.executeCommand(new CounterCommand(state));
    history.executeCommand(new CounterCommand(state));
    assert.equal(state.value, 3);
    history.undo();
    history.undo();
    assert.equal(history.canUndo(), false, "the oldest command was dropped");
    assert.equal(state.value, 1);
  });

  test("a batch runs its commands live and takes ONE undo entry", () => {
    const state = { value: 0 };
    const history = new BrainCommandHistory();
    history.beginBatch("counting");
    history.executeCommand(new CounterCommand(state));
    assert.equal(state.value, 1, "a member applies as it joins");
    history.executeCommand(new CounterCommand(state));
    history.executeCommand(new CounterCommand(state));
    assert.equal(state.value, 3);
    assert.equal(history.canUndo(), false, "the entry is not there until the batch closes");
    history.endBatch();

    assert.equal(history.canUndo(), true);
    history.undo();
    assert.equal(state.value, 0, "one undo reverses every member");
    assert.equal(history.canUndo(), false, "the batch was a single entry");
  });

  test("a batch redoes as one entry, re-applying its members in order", () => {
    const applied: number[] = [];
    /** Records the order its executions land in, for pinning replay order. */
    class OrderedCommand implements BrainCommand {
      constructor(private readonly mark: number) {}
      execute(): void {
        applied.push(this.mark);
      }
      undo(): void {
        applied.pop();
      }
      getDescription(): string {
        return "ordered";
      }
    }

    const history = new BrainCommandHistory();
    history.beginBatch("ordering");
    history.executeCommand(new OrderedCommand(1));
    history.executeCommand(new OrderedCommand(2));
    history.executeCommand(new OrderedCommand(3));
    history.endBatch();
    assert.deepEqual(applied, [1, 2, 3]);

    history.undo();
    assert.deepEqual(applied, []);
    history.redo();
    assert.deepEqual(applied, [1, 2, 3], "redo re-applies the members in order");
    assert.equal(history.canRedo(), false, "the batch redid as a single entry");
  });

  test("aborting a batch reverses the members already applied and leaves no entry", () => {
    const state = { value: 0 };
    const history = new BrainCommandHistory();
    history.executeCommand(new CounterCommand(state));
    assert.equal(state.value, 1);

    history.beginBatch("counting");
    history.executeCommand(new CounterCommand(state));
    history.executeCommand(new CounterCommand(state));
    assert.equal(state.value, 3);
    history.abortBatch();

    assert.equal(state.value, 1, "abort reverses what the batch already applied");
    assert.equal(history.canUndo(), true, "the entry from before the batch survives");
    history.undo();
    assert.equal(state.value, 0);
    assert.equal(history.canUndo(), false, "the aborted batch left no entry of its own");
  });

  test("aborting reverses the members newest first", () => {
    const events: string[] = [];
    /** Records which of its two ends ran, for pinning the order abort takes. */
    class MarkingCommand implements BrainCommand {
      constructor(private readonly mark: string) {}
      execute(): void {
        events.push(`do ${this.mark}`);
      }
      undo(): void {
        events.push(`undo ${this.mark}`);
      }
      getDescription(): string {
        return "marking";
      }
    }

    const history = new BrainCommandHistory();
    history.beginBatch("marking");
    history.executeCommand(new MarkingCommand("a"));
    history.executeCommand(new MarkingCommand("b"));
    history.abortBatch();
    assert.deepEqual(events, ["do a", "do b", "undo b", "undo a"]);
  });

  test("a batch that gathered nothing leaves no entry and keeps the redo stack", () => {
    const state = { value: 0 };
    const history = new BrainCommandHistory();
    history.executeCommand(new CounterCommand(state));
    history.undo();
    assert.equal(history.canRedo(), true);

    history.beginBatch("counting");
    history.endBatch();
    assert.equal(history.canUndo(), false, "an empty batch adds no entry");
    assert.equal(history.canRedo(), true, "an empty batch leaves the redo stack alone");

    history.beginBatch("counting");
    history.abortBatch();
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), true);
  });

  test("batches do not nest", () => {
    const history = new BrainCommandHistory();
    history.beginBatch("outer");
    assert.throws(() => history.beginBatch("inner"));
    assert.equal(history.isBatchOpen(), true);
    history.endBatch();
    assert.equal(history.isBatchOpen(), false);
  });

  test("undo and redo do nothing while a batch is open", () => {
    const state = { value: 0 };
    const history = new BrainCommandHistory();
    history.executeCommand(new CounterCommand(state));
    history.undo();
    assert.equal(state.value, 0);

    history.beginBatch("counting");
    history.executeCommand(new CounterCommand(state));
    history.undo();
    assert.equal(state.value, 1, "undo must not tear the open batch");
    history.redo();
    assert.equal(state.value, 1, "redo must not reach past the open batch");
    history.endBatch();
  });

  test("recordCommand joins the open batch rather than taking its own entry", () => {
    const state = { value: 0 };
    const history = new BrainCommandHistory();
    history.beginBatch("counting");
    const recorded = new CounterCommand(state);
    history.recordCommand(recorded);
    assert.equal(recorded.executions, 0, "recordCommand still does not execute");
    assert.equal(history.canUndo(), false);
    history.endBatch();

    assert.equal(history.canUndo(), true);
    history.undo();
    assert.equal(state.value, -1);
    assert.equal(history.canUndo(), false, "the recorded command took no entry of its own");
  });

  test("onChange fires for executeCommand, recordCommand, undo, redo, and clear", () => {
    const state = { value: 0 };
    const history = new BrainCommandHistory();
    let notifications = 0;
    history.onChange(() => {
      notifications++;
    });
    history.executeCommand(new CounterCommand(state));
    assert.equal(notifications, 1);
    history.undo();
    assert.equal(notifications, 2);
    history.redo();
    assert.equal(notifications, 3);
    history.recordCommand(new CounterCommand(state));
    assert.equal(notifications, 4);
    history.clear();
    assert.equal(notifications, 5);
  });

  test("notifies every registered callback, in registration order", () => {
    const history = new BrainCommandHistory();
    const notified: string[] = [];
    history.onChange(() => {
      notified.push("first");
    });
    history.onChange(() => {
      notified.push("second");
    });

    history.executeCommand(new CounterCommand({ value: 0 }));

    assert.deepEqual(notified, ["first", "second"]);
  });

  test("unregisters only the callback whose registration was released", () => {
    const history = new BrainCommandHistory();
    const notified: string[] = [];
    const releaseFirst = history.onChange(() => {
      notified.push("first");
    });
    history.onChange(() => {
      notified.push("second");
    });

    releaseFirst();
    history.executeCommand(new CounterCommand({ value: 0 }));

    assert.deepEqual(notified, ["second"]);
  });

  test("releasing a registration twice unregisters nothing further", () => {
    const history = new BrainCommandHistory();
    const notified: string[] = [];
    const releaseFirst = history.onChange(() => {
      notified.push("first");
    });
    history.onChange(() => {
      notified.push("second");
    });

    releaseFirst();
    releaseFirst();
    history.executeCommand(new CounterCommand({ value: 0 }));

    assert.deepEqual(notified, ["second"]);
  });
});

// ---- Page commands ---------------------------------------------------------

describe("page commands round-trip the document", () => {
  test("AddPageCommand (append)", () => {
    const brain = newBrain();
    assertCommandRoundTrip(brain, new AddPageCommand(brain));
    assert.equal(brain.pages().size(), 2);
  });

  test("AddPageCommand (insert before current page)", () => {
    const brain = newBrain();
    firstPage(brain).setName("Original");
    assertCommandRoundTrip(brain, new AddPageCommand(brain, 0));
    assert.equal(brain.pages().get(1).name(), "Original");
  });

  test("RemovePageCommand restores the removed page with its rules on undo", () => {
    const brain = newBrain();
    firstRule(brain).do().appendTile(actuatorTile());
    brain.appendNewPage();
    assertCommandRoundTrip(brain, new RemovePageCommand(brain, 0));
    assert.equal(brain.pages().size(), 1);
  });

  test("ReplaceLastPageCommand swaps the only page for a blank page atomically", () => {
    const brain = newBrain();
    firstPage(brain).setName("Only Page");
    firstRule(brain).do().appendTile(actuatorTile());
    assertCommandRoundTrip(brain, new ReplaceLastPageCommand(brain, 0));
    assert.equal(brain.pages().size(), 1);
    assert.equal(firstRule(brain).do().tiles().size(), 0, "redo leaves a blank replacement page");
  });
});

describe("page commands keep the page they act on across undo and redo", () => {
  /** Page ids of `brain`, in document order. */
  function pageIds(brain: BrainDef): string[] {
    return brain
      .pages()
      .toArray()
      .map((page) => page.pageId());
  }

  /** Ids of every page tile the brain's own catalog holds, in sorted order. */
  function pageTileIds(brain: BrainDef): string[] {
    return catalogShape(brain)
      .map((entry) => entry.tileId)
      .filter((tileId) => isPageTileId(tileId));
  }

  test("AddPageCommand puts the same page back on redo", () => {
    const brain = newBrain();
    const history = new BrainCommandHistory();

    history.executeCommand(new AddPageCommand(brain));
    const added = pageIds(brain);
    history.undo();
    history.redo();

    assert.deepEqual(pageIds(brain), added, "redo restores the page the first execute made");
  });

  test("AddPageCommand leaves no orphan page tile behind after undo and redo", () => {
    const brain = newBrain();
    const history = new BrainCommandHistory();

    history.executeCommand(new AddPageCommand(brain));
    const afterExecute = pageTileIds(brain);
    history.undo();
    history.redo();

    assert.deepEqual(pageTileIds(brain), afterExecute, "no page tile of a discarded page accumulates");
    assert.equal(pageTileIds(brain).length, brain.pages().size(), "one page tile per living page");
  });

  test("AddPageCommand keeps the rule the new page opens with", () => {
    const brain = newBrain();
    const history = new BrainCommandHistory();

    history.executeCommand(new AddPageCommand(brain));
    const openingRuleId = (brain.pages().get(1).children().get(0) as BrainRuleDef).ruleId();
    history.undo();
    history.redo();

    assert.equal((brain.pages().get(1).children().get(0) as BrainRuleDef).ruleId(), openingRuleId);
  });

  test("RemovePageCommand takes out the page it first located, not whatever index now holds", () => {
    const brain = newBrain();
    const history = new BrainCommandHistory();
    brain.appendNewPage();
    brain.appendNewPage();
    const [first, second, third] = pageIds(brain);

    const remove = new RemovePageCommand(brain, 1);
    history.executeCommand(remove);
    assert.deepEqual(pageIds(brain), [first, third]);
    history.undo();
    assert.deepEqual(pageIds(brain), [first, second, third]);

    brain.removePageAtIndex(0);
    assert.deepEqual(pageIds(brain), [second, third], "the page the command holds now stands at another index");
    history.redo();

    assert.deepEqual(pageIds(brain), [third], "redo removes the same page from wherever it now stands");
  });

  test("ReplaceLastPageCommand keeps both the page it removed and the blank one it added", () => {
    const brain = newBrain();
    const history = new BrainCommandHistory();
    const original = pageIds(brain)[0];

    history.executeCommand(new ReplaceLastPageCommand(brain, 0));
    const replacement = pageIds(brain)[0];
    assert.notEqual(replacement, original);
    history.undo();
    assert.deepEqual(pageIds(brain), [original]);
    history.redo();

    assert.deepEqual(pageIds(brain), [replacement], "redo puts back the same blank page");
  });
});

// ---- Rename and comment commands -------------------------------------------

describe("rename and comment commands round-trip the document", () => {
  test("RenameBrainCommand", () => {
    const brain = newBrain();
    assertCommandRoundTrip(brain, new RenameBrainCommand(brain, "Renamed Brain"));
    assert.equal(brain.name(), "Renamed Brain");
  });

  test("RenamePageCommand", () => {
    const brain = newBrain();
    assertCommandRoundTrip(brain, new RenamePageCommand(firstPage(brain), "Renamed Page"));
    assert.equal(firstPage(brain).name(), "Renamed Page");
  });

  test("SetRuleCommentCommand sets a comment", () => {
    const brain = newBrain();
    assertCommandRoundTrip(brain, new SetRuleCommentCommand(firstRule(brain), "a comment"));
  });

  test("SetRuleCommentCommand clears a comment", () => {
    const brain = newBrain();
    firstRule(brain).setComment("existing comment");
    assertCommandRoundTrip(brain, new SetRuleCommentCommand(firstRule(brain), undefined));
    assert.equal(firstRule(brain).comment(), undefined);
  });

  test("RenameVariableCommand replaces the catalog entry and every rule reference, reversibly", () => {
    const brain = newBrain();
    const rule = firstRule(brain);
    const varTile = numberVariableTile(brain, "score");
    rule.do().appendTile(varTile);

    const history = new BrainCommandHistory();
    history.executeCommand(new RenameVariableCommand(brain, varTile, "points"));
    const renamed = brain.catalog().get(varTile.tileId) as BrainTileVariableDef;
    assert.equal(renamed.varName, "points");
    assert.equal(renamed.uniqueId, varTile.uniqueId);
    assert.equal((rule.do().tiles().get(0) as BrainTileVariableDef).varName, "points");
    assert.equal(history.canUndo(), true);

    history.undo();
    assert.equal((brain.catalog().get(varTile.tileId) as BrainTileVariableDef).varName, "score");
    assert.equal(rule.do().tiles().get(0), varTile);
    assert.equal(history.canRedo(), true);

    history.redo();
    assert.equal((brain.catalog().get(varTile.tileId) as BrainTileVariableDef).varName, "points");
    assert.equal((rule.do().tiles().get(0) as BrainTileVariableDef).varName, "points");
  });

  test("EditLiteralCommand propagates a new value to the catalog entry and every placement, reversibly", () => {
    const brain = newBrain();
    const rule = firstRule(brain);
    const literal = uniqueLiteralTile(brain, "litIdentityValue", 1, "rock");
    rule.do().appendTile(literal);
    rule.when().appendTile(literal);

    const history = new BrainCommandHistory();
    history.executeCommand(new EditLiteralCommand(brain, literal, { value: 2 }));

    const edited = brain.catalog().get(literal.tileId) as BrainTileLiteralDef;
    assert.equal(edited.tileId, literal.tileId, "the edit stays under the literal's own id");
    assert.equal(edited.value, 2);
    assert.deepEqual(literalTileIds(brain), [literal.tileId], "no superseded literal is left behind");
    assert.equal(rule.do().tiles().get(0), edited);
    assert.equal(rule.when().tiles().get(0), edited, "every placement reads the edit");

    history.undo();
    assert.equal(brain.catalog().get(literal.tileId), literal);
    assert.equal((brain.catalog().get(literal.tileId) as BrainTileLiteralDef).value, 1);
    assert.equal(rule.do().tiles().get(0), literal);
    assert.equal(rule.when().tiles().get(0), literal);

    history.redo();
    assert.equal((brain.catalog().get(literal.tileId) as BrainTileLiteralDef).value, 2);
    assert.equal(rule.do().tiles().get(0), edited);
  });

  test("EditLiteralCommand renames a literal under its own id, and undo restores value and name together", () => {
    const localizer = createDefaultLocalizer();
    const brain = newBrain();
    const rule = firstRule(brain);
    const literal = uniqueLiteralTile(brain, "litIdentityName", 1, "rock");
    rule.do().appendTile(literal);

    const history = new BrainCommandHistory();
    history.executeCommand(new EditLiteralCommand(brain, literal, { displayName: "stone" }));

    const renamed = brain.catalog().get(literal.tileId) as BrainTileLiteralDef;
    assert.equal(renamed.tileId, literal.tileId);
    assert.equal(renamed.value, 1, "a name-only edit leaves the value alone");
    assert.equal(tileSentenceWord(renamed, localizer), "stone");

    history.executeCommand(new EditLiteralCommand(brain, renamed, { value: 2, displayName: "pebble" }));
    const both = brain.catalog().get(literal.tileId) as BrainTileLiteralDef;
    assert.equal(both.value, 2);
    assert.equal(tileSentenceWord(both, localizer), "pebble");

    history.undo();
    const restored = brain.catalog().get(literal.tileId) as BrainTileLiteralDef;
    assert.equal(restored.value, 1, "undo restores the value");
    assert.equal(tileSentenceWord(restored, localizer), "stone", "undo restores the name");
    assert.equal(rule.do().tiles().get(0), restored);

    history.redo();
    assert.equal((brain.catalog().get(literal.tileId) as BrainTileLiteralDef).value, 2);
    assert.equal(tileSentenceWord(brain.catalog().get(literal.tileId) as BrainTileLiteralDef, localizer), "pebble");
  });

  test("EditLiteralCommand refuses a literal whose id follows its content", () => {
    const brain = newBrain();
    const literal = numberLiteralTile(brain, 1) as BrainTileLiteralDef;

    assert.throws(() => new EditLiteralCommand(brain, literal, { value: 2 }));
  });
});

// ---- Trigger mode command --------------------------------------------------

describe("SetRuleTriggerCommand round-trips the document", () => {
  test("sets a mode on a rule that carries none", () => {
    const brain = newBrain();
    assertCommandRoundTrip(brain, new SetRuleTriggerCommand(firstRule(brain), RuleTriggerMode.Otherwise));
    assert.equal(firstRule(brain).trigger(), RuleTriggerMode.Otherwise);
  });

  test("undo restores the mode the rule carried before", () => {
    const brain = newBrain();
    firstRule(brain).setTrigger(RuleTriggerMode.Then);

    const history = new BrainCommandHistory();
    history.executeCommand(new SetRuleTriggerCommand(firstRule(brain), RuleTriggerMode.When));
    assert.equal(firstRule(brain).trigger(), RuleTriggerMode.When);

    history.undo();
    assert.equal(firstRule(brain).trigger(), RuleTriggerMode.Then);

    history.redo();
    assert.equal(firstRule(brain).trigger(), RuleTriggerMode.When);
  });
});

// ---- Brain replacement -----------------------------------------------------

describe("ReplaceBrainCommand", () => {
  test("replaces the whole document and restores it on undo", () => {
    const brain = newBrain();
    firstRule(brain).do().appendTile(actuatorTile());

    const replacement = BrainDef.emptyBrainDef(services);
    replacement.setName("Replacement Brain");
    (replacement.pages().get(0).children().get(0) as BrainRuleDef).when().appendTile(sensorTile());

    assertCommandRoundTrip(brain, new ReplaceBrainCommand(brain, replacement.toJson()));
    assert.equal(brain.name(), "Replacement Brain");
  });
});

// ---- Rule commands ---------------------------------------------------------

/** A page with two root rules; the first carries a tile so ordering is visible in the shape. */
function brainWithTwoRules(): { brain: BrainDef; page: BrainPageDef; ruleA: BrainRuleDef; ruleB: BrainRuleDef } {
  const brain = newBrain();
  const page = firstPage(brain);
  const ruleA = page.children().get(0) as BrainRuleDef;
  ruleA.do().appendTile(actuatorTile());
  const ruleB = page.appendNewRule();
  return { brain, page, ruleA, ruleB };
}

describe("rule commands round-trip the document", () => {
  test("AddRuleCommand", () => {
    const brain = newBrain();
    assertCommandRoundTrip(brain, new AddRuleCommand(firstPage(brain)));
    assert.equal(firstPage(brain).children().size(), 2);
  });

  test("InsertRuleCommand inserts at the target's index", () => {
    const { brain, ruleA } = brainWithTwoRules();
    assertCommandRoundTrip(brain, new InsertRuleCommand(ruleA, "before"));
    assert.equal(firstPage(brain).children().size(), 3);
    assert.equal(firstPage(brain).children().get(1), ruleA);
  });

  test("InsertRuleCommand inserts past the target and past its children", () => {
    const { brain, ruleA } = brainWithTwoRules();
    const child = ruleA.appendNewRule();
    child.when().appendTile(sensorTile());
    const command = new InsertRuleCommand(ruleA, "after");
    assertCommandRoundTrip(brain, command);
    const page = firstPage(brain);
    assert.equal(page.children().size(), 3);
    assert.equal(page.children().get(0), ruleA);
    assert.equal(page.children().get(1), command.insertedRule());
    assert.equal(ruleA.children().get(0), child);
  });

  test("AddRuleCommand puts the same rule back on redo", () => {
    const brain = newBrain();
    const page = firstPage(brain);
    const history = new BrainCommandHistory();

    history.executeCommand(new AddRuleCommand(page));
    const added = page.children().get(1) as BrainRuleDef;
    added.do().appendTile(actuatorTile());
    const ruleId = added.ruleId();

    history.undo();
    history.redo();

    const again = page.children().get(1) as BrainRuleDef;
    assert.equal(again, added);
    assert.equal(again.ruleId(), ruleId);
    assert.equal(again.do().tiles().size(), 1);
  });

  test("InsertRuleCommand puts the same rule back on redo", () => {
    const { ruleA, page } = brainWithTwoRules();
    const history = new BrainCommandHistory();
    const command = new InsertRuleCommand(ruleA, "after");

    history.executeCommand(command);
    const inserted = command.insertedRule() as BrainRuleDef;
    inserted.when().appendTile(sensorTile());
    const ruleId = inserted.ruleId();

    history.undo();
    history.redo();

    assert.equal(page.children().get(1), inserted);
    assert.equal(command.insertedRule(), inserted);
    assert.equal(inserted.ruleId(), ruleId);
    assert.equal(inserted.when().tiles().size(), 1);
  });

  test("a rule put back by redo still reports its dirty state to its page", async () => {
    const brain = newBrain();
    const page = firstPage(brain);
    const history = new BrainCommandHistory();

    history.executeCommand(new AddRuleCommand(page));
    const added = page.children().get(1) as BrainRuleDef;
    history.undo();
    history.redo();

    const reported = new Promise<string>((resolve) => {
      page.events().on("page_changed", ({ what }) => {
        if (what === "rule_dirtyChanged") resolve(what);
      });
    });
    added.when().appendTile(sensorTile());

    assert.equal(await reported, "rule_dirtyChanged");
  });

  test("DeleteRuleCommand restores the rule subtree on undo", () => {
    const { brain, ruleA } = brainWithTwoRules();
    const child = ruleA.appendNewRule();
    child.when().appendTile(sensorTile());
    assertCommandRoundTrip(brain, new DeleteRuleCommand(ruleA));
    assert.equal(firstPage(brain).children().size(), 1);
  });

  test("DeleteRuleCommand restores the ids of the rule and its children", () => {
    const { brain, ruleA } = brainWithTwoRules();
    const child = ruleA.appendNewRule();
    child.when().appendTile(sensorTile());
    const ruleId = ruleA.ruleId();
    const childId = child.ruleId();

    const history = new BrainCommandHistory();
    history.executeCommand(new DeleteRuleCommand(ruleA));
    history.undo();

    const restored = firstPage(brain).children().get(0) as BrainRuleDef;
    assert.equal(restored.ruleId(), ruleId);
    assert.equal((restored.children().get(0) as BrainRuleDef).ruleId(), childId);

    history.redo();
    history.undo();
    const again = firstPage(brain).children().get(0) as BrainRuleDef;
    assert.equal(again.ruleId(), ruleId);
    assert.equal((again.children().get(0) as BrainRuleDef).ruleId(), childId);
  });

  test("MoveRuleUpCommand and MoveRuleDownCommand", () => {
    const { brain, ruleB } = brainWithTwoRules();
    assertCommandRoundTrip(brain, new MoveRuleUpCommand(ruleB));
    // The round trip ends in the executed state, so ruleB now sits at index 0.
    assert.equal(firstPage(brain).children().get(0), ruleB);
    assertCommandRoundTrip(brain, new MoveRuleDownCommand(ruleB));
    assert.equal(firstPage(brain).children().get(1), ruleB);
  });

  test("MoveRuleCommand moves between explicit locations", () => {
    const { brain, page, ruleA } = brainWithTwoRules();
    const command = new MoveRuleCommand(ruleA, { pageDef: page, index: 0 }, { pageDef: page, index: 1 });
    assertCommandRoundTrip(brain, command);
    assert.equal(page.children().get(1), ruleA);
  });

  test("IndentRuleCommand and OutdentRuleCommand", () => {
    const { brain, ruleA, ruleB } = brainWithTwoRules();
    ruleB.when().appendTile(sensorTile());
    assertCommandRoundTrip(brain, new IndentRuleCommand(ruleB));
    assert.equal(ruleA.children().get(0), ruleB);
    assertCommandRoundTrip(brain, new OutdentRuleCommand(ruleB));
    assert.equal(ruleB.ancestor(), undefined);
  });

  test("OutdentRuleCommand restores the rule's index among children that follow it", () => {
    const { brain, ruleA } = brainWithTwoRules();
    const first = ruleA.appendNewRule() as BrainRuleDef;
    first.when().appendTile(sensorTile());
    const second = ruleA.appendNewRule() as BrainRuleDef;
    second.do().appendTile(actuatorTile());

    assertCommandRoundTrip(brain, new OutdentRuleCommand(first));
    // The round trip ends executed, so `first` stands outside ruleA.
    assert.equal(ruleA.children().get(0), second);
  });

  test("IndentRuleCommand restores the rule's index among the siblings that follow it", () => {
    const { brain, page, ruleB } = brainWithTwoRules();
    // ruleB already holds a child.
    const held = ruleB.appendNewRule() as BrainRuleDef;
    held.when().appendTile(sensorTile());
    const middle = page.appendNewRule() as BrainRuleDef;
    middle.when().appendTile(sensorTile());
    const last = page.appendNewRule() as BrainRuleDef;
    last.do().appendTile(actuatorTile());

    assertCommandRoundTrip(brain, new IndentRuleCommand(middle));
    assert.equal(ruleB.children().get(0), held);
    assert.equal(ruleB.children().get(1), middle);
    assert.equal(page.children().get(2), last);
  });

  test("PasteRulesCommand inserts the produced rules above the target, re-producing on redo", () => {
    const { brain, ruleA, ruleB } = brainWithTwoRules();
    ruleA.when().appendTile(sensorTile());
    ruleA.do().appendTile(numberLiteralTile(brain, 42));
    // The producer mirrors the paste flow: it deserializes a captured rule
    // snapshot into the destination brain on every execute, so redo mints
    // fresh rule instances just like a clipboard paste does.
    const copiedRuleJson = ruleA.toJson();
    let producerCalls = 0;
    const command = new PasteRulesCommand(ruleB, "before", (destBrain) => {
      producerCalls++;
      const rule = new BrainRuleDef(destBrain.servicesRng());
      rule.deserializeJson(copiedRuleJson, destBrain.deserializationCatalogs());
      return List.from([rule]);
    });

    assertCommandRoundTrip(brain, command);
    assert.equal(producerCalls, 2, "execute and redo each invoke the producer");
    const pasted = firstPage(brain).children().get(1) as BrainRuleDef;
    assert.deepEqual(
      pasted
        .when()
        .tiles()
        .toArray()
        .map((t) => t.tileId),
      [sensorTile().tileId]
    );
  });

  test("PasteRulesCommand puts the produced rules past the target", () => {
    const { brain, ruleA, ruleB } = brainWithTwoRules();
    const copiedRuleJson = ruleA.toJson();
    const command = new PasteRulesCommand(ruleA, "after", (destBrain) => {
      const rule = new BrainRuleDef(destBrain.servicesRng());
      rule.deserializeJson(copiedRuleJson, destBrain.deserializationCatalogs());
      return List.from([rule]);
    });

    assertCommandRoundTrip(brain, command);
    const page = firstPage(brain);
    assert.equal(page.children().size(), 3);
    assert.equal(page.children().get(0), ruleA);
    assert.equal(page.children().get(2), ruleB);
  });
});

describe("a batch of rule moves", () => {
  /**
   * A page of four rules, each carrying a distinct tile so the serialized shape
   * tells them apart, with the third rule holding a child.
   */
  function brainWithFourRules(): { brain: BrainDef; page: BrainPageDef; rules: BrainRuleDef[] } {
    const brain = newBrain();
    const page = firstPage(brain);
    const first = page.children().get(0) as BrainRuleDef;
    first.do().appendTile(actuatorTile());
    const rules = [first];
    for (let i = 1; i < 4; i++) {
      const rule = page.appendNewRule();
      rule.do().appendTile(numberLiteralTile(brain, i));
      rules.push(rule);
    }
    const child = rules[2].appendNewRule();
    child.when().appendTile(sensorTile());
    return { brain, page, rules };
  }

  test("several moves undo as one entry and redo as one", () => {
    const { brain, rules } = brainWithFourRules();
    const moved = rules[3];
    const history = new BrainCommandHistory();
    const origin = documentShape(brain);

    history.beginBatch("Move rule");
    history.executeCommand(new MoveRuleUpCommand(moved));
    history.executeCommand(new MoveRuleUpCommand(moved));
    history.executeCommand(new IndentRuleCommand(moved));
    history.endBatch();

    const settled = documentShape(brain);
    assert.notDeepEqual(settled, origin, "the moves must have changed the document");

    history.undo();
    assert.deepEqual(documentShape(brain), origin, "one undo returns the rule to where it started");
    assert.equal(history.canUndo(), false, "the whole pick-up was a single entry");

    history.redo();
    assert.deepEqual(documentShape(brain), settled, "one redo re-applies every move");
    assert.equal(history.canRedo(), false);
  });

  test("aborting returns the document to exactly its state before the batch, with no entry", () => {
    const { brain, rules } = brainWithFourRules();
    const moved = rules[3];
    const history = new BrainCommandHistory();
    const origin = documentShape(brain);

    history.beginBatch("Move rule");
    history.executeCommand(new MoveRuleUpCommand(moved));
    history.executeCommand(new IndentRuleCommand(moved));
    history.executeCommand(new OutdentRuleCommand(moved));
    history.executeCommand(new MoveRuleUpCommand(moved));
    assert.notDeepEqual(documentShape(brain), origin, "the moves applied live");
    history.abortBatch();

    assert.deepEqual(documentShape(brain), origin, "abort reverses every applied move");
    assert.equal(history.canUndo(), false, "a cancelled pick-up leaves no history entry");
    assert.equal(history.canRedo(), false);
  });

  test("aborting restores a rule outdented out from among its parent's other children", () => {
    const { brain, rules } = brainWithFourRules();
    // Give the child of rules[2] a sibling after it.
    const held = rules[2].children().get(0) as BrainRuleDef;
    const following = rules[2].appendNewRule();
    following.do().appendTile(actuatorTile());

    const history = new BrainCommandHistory();
    const origin = documentShape(brain);

    history.beginBatch("Move rule");
    history.executeCommand(new OutdentRuleCommand(held));
    history.abortBatch();

    assert.deepEqual(documentShape(brain), origin);
    assert.equal(rules[2].children().get(0), held);
    assert.equal(rules[2].children().get(1), following);
  });

  test("work done after the batch closes takes its own entry and stays out of the pick-up's", () => {
    const { brain, rules } = brainWithFourRules();
    const moved = rules[3];
    const history = new BrainCommandHistory();
    const origin = documentShape(brain);

    history.beginBatch("Move rule");
    history.executeCommand(new MoveRuleUpCommand(moved));
    history.endBatch();
    const afterMove = documentShape(brain);

    history.executeCommand(new AddTileCommand(rules[0], RuleSide.When, sensorTile()));
    assert.notDeepEqual(documentShape(brain), afterMove);

    history.undo();
    assert.deepEqual(documentShape(brain), afterMove, "the first undo reverses only the later work");
    history.undo();
    assert.deepEqual(documentShape(brain), origin, "the pick-up is still its own entry underneath");
    assert.equal(history.canUndo(), false);
  });

  test("a batch that moved nothing leaves no entry", () => {
    const { brain, rules } = brainWithFourRules();
    const history = new BrainCommandHistory();
    const origin = documentShape(brain);

    history.beginBatch("Move rule");
    history.endBatch();

    assert.deepEqual(documentShape(brain), origin);
    assert.equal(history.canUndo(), false);
    assert.equal(rules.length, 4);
  });
});

// ---- Tile commands ---------------------------------------------------------

describe("tile commands round-trip the document", () => {
  test("AddTileCommand appends on the When side", () => {
    const brain = newBrain();
    assertCommandRoundTrip(brain, new AddTileCommand(firstRule(brain), RuleSide.When, sensorTile()));
    assert.deepEqual(
      firstRule(brain)
        .when()
        .tiles()
        .toArray()
        .map((t) => t.tileId),
      [sensorTile().tileId]
    );
  });

  test("AddTileCommand appends on the Do side", () => {
    const brain = newBrain();
    assertCommandRoundTrip(brain, new AddTileCommand(firstRule(brain), RuleSide.Do, actuatorTile()));
    assert.deepEqual(
      firstRule(brain)
        .do()
        .tiles()
        .toArray()
        .map((t) => t.tileId),
      [actuatorTile().tileId]
    );
  });

  test("InsertTileCommand inserts at the given index", () => {
    const brain = newBrain();
    const rule = firstRule(brain);
    rule.do().appendTile(actuatorTile());
    const literal = numberLiteralTile(brain, 7);
    assertCommandRoundTrip(brain, new InsertTileCommand(rule, RuleSide.Do, 0, literal));
    assert.deepEqual(
      rule
        .do()
        .tiles()
        .toArray()
        .map((t) => t.tileId),
      [literal.tileId, actuatorTile().tileId]
    );
  });

  test("ReplaceTileCommand restores the replaced tile on undo", () => {
    const brain = newBrain();
    const rule = firstRule(brain);
    const oldLiteral = numberLiteralTile(brain, 1);
    const newLiteral = numberLiteralTile(brain, 2);
    rule.do().appendTile(oldLiteral);
    assertCommandRoundTrip(brain, new ReplaceTileCommand(rule, RuleSide.Do, 0, newLiteral));
    assert.equal(rule.do().tiles().get(0), newLiteral);
  });

  test("RemoveTileCommand restores the removed tile at its index on undo", () => {
    const brain = newBrain();
    const rule = firstRule(brain);
    rule.do().appendTile(numberLiteralTile(brain, 3));
    rule.do().appendTile(actuatorTile());
    assertCommandRoundTrip(brain, new RemoveTileCommand(rule, RuleSide.Do, 0));
    assert.deepEqual(
      rule
        .do()
        .tiles()
        .toArray()
        .map((t) => t.tileId),
      [actuatorTile().tileId]
    );
  });

  test("PasteTileBeforeCommand inserts the produced tile before the target index", () => {
    const brain = newBrain();
    const rule = firstRule(brain);
    const literal = numberLiteralTile(brain, 9);
    rule.do().appendTile(actuatorTile());
    // The producer mirrors the paste flow: it resolves the copied tile
    // against the destination brain's catalog on every execute.
    const command = new PasteTileBeforeCommand(rule, RuleSide.Do, 0, (destBrain) =>
      destBrain.catalog().get(literal.tileId)
    );
    assertCommandRoundTrip(brain, command);
    assert.deepEqual(
      rule
        .do()
        .tiles()
        .toArray()
        .map((t) => t.tileId),
      [literal.tileId, actuatorTile().tileId]
    );
  });

  test("PasteTileBeforeCommand is a no-op when the producer yields no tile", () => {
    const brain = newBrain();
    const rule = firstRule(brain);
    rule.do().appendTile(actuatorTile());
    const beforeShape = ruleShape(rule.toJson());
    const command = new PasteTileBeforeCommand(rule, RuleSide.Do, 0, () => undefined);
    command.execute();
    assert.deepEqual(ruleShape(rule.toJson()), beforeShape);
    command.undo();
    assert.deepEqual(ruleShape(rule.toJson()), beforeShape);
  });
});

// ---- Working-copy isolation ------------------------------------------------
// The editor edits `sourceBrain.workingCopy()` and drops the copy on discard, so
// a command executed against the copy must leave the source brain byte-identical
// to its pre-copy snapshot. The snapshot extends the document shape with a
// catalog projection, because catalog-touching commands (variable rename, page
// add/remove) would otherwise leak through shared tile-def instances unseen.

interface CatalogEntryShape {
  tileId: string;
  kind: string;
  label?: string;
  hidden: boolean;
  varName?: string;
}

function catalogShape(brain: BrainDef): CatalogEntryShape[] {
  return brain
    .catalog()
    .getAll()
    .toArray()
    .map((tileDef) => {
      const entry: CatalogEntryShape = {
        tileId: tileDef.tileId,
        kind: tileDef.kind,
        hidden: tileDef.hidden === true,
      };
      if (tileDef.metadata) entry.label = tileDef.metadata.label;
      const varName = (tileDef as BrainTileVariableDef).varName;
      if (varName !== undefined) entry.varName = varName;
      return entry;
    })
    .sort((a, b) => (a.tileId < b.tileId ? -1 : a.tileId > b.tileId ? 1 : 0));
}

function brainSnapshot(brain: BrainDef): unknown {
  return { document: documentShape(brain), catalog: catalogShape(brain) };
}

/**
 * One row of the working-copy isolation table: `build` populates a fresh brain,
 * and `makeCommand` locates its targets positionally so the same row can be
 * applied to the copy.
 */
interface WorkingCopyIsolationCase {
  name: string;
  build: (brain: BrainDef) => void;
  makeCommand: (brain: BrainDef) => BrainCommand;
}

/** Two root rules, the first carrying a tile so ordering shows up in the shape. */
function buildTwoRules(brain: BrainDef): void {
  const page = firstPage(brain);
  (page.children().get(0) as BrainRuleDef).do().appendTile(actuatorTile());
  const ruleB = page.appendNewRule();
  ruleB.when().appendTile(sensorTile());
}

function ruleAt(brain: BrainDef, index: number): BrainRuleDef {
  return firstPage(brain).children().get(index) as BrainRuleDef;
}

const workingCopyIsolationCases: WorkingCopyIsolationCase[] = [
  {
    name: "AddPageCommand",
    build: () => {},
    makeCommand: (brain) => new AddPageCommand(brain),
  },
  {
    name: "RemovePageCommand",
    build: (brain) => {
      brain.appendNewPage();
    },
    makeCommand: (brain) => new RemovePageCommand(brain, 0),
  },
  {
    name: "ReplaceLastPageCommand",
    build: (brain) => {
      firstRule(brain).do().appendTile(actuatorTile());
    },
    makeCommand: (brain) => new ReplaceLastPageCommand(brain, 0),
  },
  {
    name: "RenameBrainCommand",
    build: () => {},
    makeCommand: (brain) => new RenameBrainCommand(brain, "Renamed On The Clone"),
  },
  {
    name: "RenamePageCommand",
    build: () => {},
    makeCommand: (brain) => new RenamePageCommand(firstPage(brain), "Renamed On The Clone"),
  },
  {
    name: "RenameVariableCommand",
    build: (brain) => {
      firstRule(brain).do().appendTile(numberVariableTile(brain, "score"));
    },
    makeCommand: (brain) => {
      const varTile = firstRule(brain).do().tiles().get(0) as BrainTileVariableDef;
      return new RenameVariableCommand(brain, varTile, "points");
    },
  },
  {
    name: "EditLiteralCommand",
    build: (brain) => {
      firstRule(brain)
        .do()
        .appendTile(uniqueLiteralTile(brain, "litIdentityCopy", 1, "rock"));
    },
    makeCommand: (brain) => {
      const literal = firstRule(brain).do().tiles().get(0) as BrainTileLiteralDef;
      return new EditLiteralCommand(brain, literal, { value: 2, displayName: "stone" });
    },
  },
  {
    name: "SetRuleCommentCommand",
    build: () => {},
    makeCommand: (brain) => new SetRuleCommentCommand(firstRule(brain), "comment on the working copy"),
  },
  {
    name: "ReplaceBrainCommand",
    build: (brain) => {
      firstRule(brain).do().appendTile(actuatorTile());
    },
    makeCommand: (brain) => {
      const replacement = BrainDef.emptyBrainDef(services);
      replacement.setName("Replacement Brain");
      (replacement.pages().get(0).children().get(0) as BrainRuleDef).when().appendTile(sensorTile());
      return new ReplaceBrainCommand(brain, replacement.toJson());
    },
  },
  {
    name: "AddRuleCommand",
    build: () => {},
    makeCommand: (brain) => new AddRuleCommand(firstPage(brain)),
  },
  {
    name: "InsertRuleCommand",
    build: buildTwoRules,
    makeCommand: (brain) => new InsertRuleCommand(ruleAt(brain, 0), "before"),
  },
  {
    name: "DeleteRuleCommand",
    build: buildTwoRules,
    makeCommand: (brain) => new DeleteRuleCommand(ruleAt(brain, 0)),
  },
  {
    name: "MoveRuleUpCommand",
    build: buildTwoRules,
    makeCommand: (brain) => new MoveRuleUpCommand(ruleAt(brain, 1)),
  },
  {
    name: "MoveRuleDownCommand",
    build: buildTwoRules,
    makeCommand: (brain) => new MoveRuleDownCommand(ruleAt(brain, 0)),
  },
  {
    name: "MoveRuleUpCommand (child rule)",
    build: (brain) => {
      const parent = firstRule(brain);
      parent.do().appendTile(actuatorTile());
      parent.appendNewRule().when().appendTile(sensorTile());
      parent.appendNewRule().do().appendTile(numberLiteralTile(brain, 5));
    },
    makeCommand: (brain) => new MoveRuleUpCommand(firstRule(brain).children().get(1) as BrainRuleDef),
  },
  {
    name: "MoveRuleDownCommand (child rule)",
    build: (brain) => {
      const parent = firstRule(brain);
      parent.do().appendTile(actuatorTile());
      parent.appendNewRule().when().appendTile(sensorTile());
      parent.appendNewRule().do().appendTile(numberLiteralTile(brain, 5));
    },
    makeCommand: (brain) => new MoveRuleDownCommand(firstRule(brain).children().get(0) as BrainRuleDef),
  },
  {
    name: "MoveRuleCommand",
    build: buildTwoRules,
    makeCommand: (brain) => {
      const page = firstPage(brain);
      return new MoveRuleCommand(ruleAt(brain, 0), { pageDef: page, index: 0 }, { pageDef: page, index: 1 });
    },
  },
  {
    name: "IndentRuleCommand",
    build: buildTwoRules,
    makeCommand: (brain) => new IndentRuleCommand(ruleAt(brain, 1)),
  },
  {
    name: "OutdentRuleCommand",
    build: (brain) => {
      buildTwoRules(brain);
      ruleAt(brain, 1).indent();
    },
    makeCommand: (brain) => new OutdentRuleCommand(ruleAt(brain, 0).children().get(0) as BrainRuleDef),
  },
  {
    name: "PasteRulesCommand",
    build: buildTwoRules,
    makeCommand: (brain) => {
      const copiedRuleJson = ruleAt(brain, 0).toJson();
      return new PasteRulesCommand(ruleAt(brain, 1), "before", (destBrain) => {
        const rule = new BrainRuleDef(destBrain.servicesRng());
        rule.deserializeJson(copiedRuleJson, destBrain.deserializationCatalogs());
        return List.from([rule]);
      });
    },
  },
  {
    name: "AddTileCommand",
    build: () => {},
    makeCommand: (brain) => new AddTileCommand(firstRule(brain), RuleSide.When, sensorTile()),
  },
  {
    name: "InsertTileCommand",
    build: (brain) => {
      firstRule(brain).do().appendTile(actuatorTile());
    },
    makeCommand: (brain) => new InsertTileCommand(firstRule(brain), RuleSide.Do, 0, numberLiteralTile(brain, 7)),
  },
  {
    name: "ReplaceTileCommand",
    build: (brain) => {
      firstRule(brain).do().appendTile(numberLiteralTile(brain, 1));
    },
    makeCommand: (brain) => new ReplaceTileCommand(firstRule(brain), RuleSide.Do, 0, numberLiteralTile(brain, 2)),
  },
  {
    name: "RemoveTileCommand",
    build: (brain) => {
      firstRule(brain).do().appendTile(actuatorTile());
    },
    makeCommand: (brain) => new RemoveTileCommand(firstRule(brain), RuleSide.Do, 0),
  },
  {
    name: "PasteTileBeforeCommand",
    build: (brain) => {
      firstRule(brain).do().appendTile(actuatorTile());
    },
    makeCommand: (brain) => {
      const literal = numberLiteralTile(brain, 9);
      return new PasteTileBeforeCommand(firstRule(brain), RuleSide.Do, 0, (destBrain) =>
        destBrain.catalog().get(literal.tileId)
      );
    },
  },
];

describe("commands run against a working copy leave the source brain untouched", () => {
  for (const testCase of workingCopyIsolationCases) {
    test(testCase.name, () => {
      const source = newBrain();
      testCase.build(source);
      const sourceSnapshot = brainSnapshot(source);

      const working = source.workingCopy();
      const history = new BrainCommandHistory();
      history.executeCommand(testCase.makeCommand(working));

      assert.notDeepEqual(brainSnapshot(working), sourceSnapshot, "execute must change the working copy");
      assert.deepEqual(brainSnapshot(source), sourceSnapshot, "the source brain must be untouched");
    });
  }
});

describe("BrainCommandHistory change origin", () => {
  /** The origins the changes made by `work` were reported under, in order. */
  function originsOf(history: BrainCommandHistory, work: () => void): BrainEditOrigin[] {
    const seen: BrainEditOrigin[] = [];
    const stopListening = history.onChange((origin) => {
      seen.push(origin);
    });
    work();
    stopListening();
    return seen;
  }

  test("reports a change made outside any scope as the person's", () => {
    const history = new BrainCommandHistory();
    const state = { value: 0 };

    const seen = originsOf(history, () => {
      history.executeCommand(new CounterCommand(state));
      history.undo();
      history.redo();
      history.recordCommand(new CounterCommand(state));
      history.clear();
    });

    assert.deepEqual(seen, Array(5).fill(BrainEditOrigin.Person));
  });

  test("reports every change a scope makes under that scope's origin", () => {
    const history = new BrainCommandHistory();
    const state = { value: 0 };

    const seen = originsOf(history, () => {
      history.runAs(BrainEditOrigin.Tool, () => {
        history.beginBatch("edit");
        history.executeCommand(new CounterCommand(state));
        history.endBatch();
        history.undo();
      });
    });

    // beginBatch alone notifies nobody: the command joining the batch, the
    // batch closing, and the undo are the three changes.
    assert.deepEqual(seen, [BrainEditOrigin.Tool, BrainEditOrigin.Tool, BrainEditOrigin.Tool]);
  });

  test("an aborted batch reports under the scope that opened it", () => {
    const history = new BrainCommandHistory();
    const state = { value: 0 };

    const seen = originsOf(history, () => {
      history.runAs(BrainEditOrigin.Tool, () => {
        history.beginBatch("edit");
        history.executeCommand(new CounterCommand(state));
        history.abortBatch();
      });
    });

    assert.deepEqual(seen, [BrainEditOrigin.Tool, BrainEditOrigin.Tool]);
    assert.equal(state.value, 0, "the abort took the command back");
  });

  test("puts the origin that stood before back once a scope ends", () => {
    const history = new BrainCommandHistory();
    const state = { value: 0 };

    const seen = originsOf(history, () => {
      history.runAs(BrainEditOrigin.Editor, () => {
        history.executeCommand(new CounterCommand(state));
      });
      history.executeCommand(new CounterCommand(state));
    });

    assert.deepEqual(seen, [BrainEditOrigin.Editor, BrainEditOrigin.Person]);
  });

  test("puts the origin back when the scope's work throws", () => {
    const history = new BrainCommandHistory();
    const state = { value: 0 };

    assert.throws(() =>
      history.runAs(BrainEditOrigin.Tool, () => {
        throw new Error("edit failed");
      })
    );

    const seen = originsOf(history, () => {
      history.executeCommand(new CounterCommand(state));
    });
    assert.deepEqual(seen, [BrainEditOrigin.Person]);
  });

  test("the innermost scope running is the origin a change carries", () => {
    const history = new BrainCommandHistory();
    const state = { value: 0 };

    const seen = originsOf(history, () => {
      history.runAs(BrainEditOrigin.Tool, () => {
        history.runAs(BrainEditOrigin.Editor, () => {
          history.executeCommand(new CounterCommand(state));
        });
        history.executeCommand(new CounterCommand(state));
      });
    });

    assert.deepEqual(seen, [BrainEditOrigin.Editor, BrainEditOrigin.Tool]);
  });
});
