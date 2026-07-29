/**
 * Characterization suite for the brain editing command layer.
 *
 * Pins, for every concrete command kind, that executing the command through
 * BrainCommandHistory round-trips the program document (execute -> undo
 * restores the prior document, redo reapplies the change) and that
 * canUndo()/canRedo() transition correctly. Fixtures are real BrainDef
 * documents built through the real model APIs.
 *
 * Also pins clone isolation: the editor edits a clone of the saved program and
 * drops it on discard, so every command must leave the source document
 * untouched when it runs against a clone.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { BrainServices, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { CoreVariableFactoryId, mkVariableFactoryTileId, RuleSide } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import {
  AddPageCommand,
  AddRuleCommand,
  AddTileCommand,
  type BrainCommand,
  BrainCommandHistory,
  BrainDef,
  type BrainPageDef,
  BrainRuleDef,
  DeleteRuleCommand,
  IndentRuleCommand,
  InsertRuleBeforeCommand,
  InsertTileCommand,
  MoveRuleCommand,
  MoveRuleDownCommand,
  MoveRuleUpCommand,
  OutdentRuleCommand,
  PasteRuleAboveCommand,
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
} from "@mindcraft-lang/core/brain/model";
import {
  type BrainTileFactoryDef,
  BrainTileLiteralDef,
  type BrainTileVariableDef,
} from "@mindcraft-lang/core/brain/tiles";
import { CoreHostActions, CoreTypeIds, mkActuatorTileId, mkSensorTileId } from "@mindcraft-lang/core/runtime";

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

/** Manufacture a number variable tile through its factory and register it in the brain's catalog. */
function numberVariableTile(brain: BrainDef, varName: string): BrainTileVariableDef {
  const factory = coreTile(mkVariableFactoryTileId(CoreVariableFactoryId.Number)) as BrainTileFactoryDef;
  const tileDef = factory.manufacture(factory, { name: varName }) as BrainTileVariableDef;
  brain.catalog().registerTileDef(tileDef);
  return tileDef;
}

// ---- Document shape --------------------------------------------------------
// The round-trip oracle is a structural projection of the document: brain
// name plus, per page, the page name and serialized rule tree (tile-id lists,
// comments, children). Page ids are excluded because page-creating commands
// mint a fresh page id on redo; catalog residue (hidden page tiles) is
// asserted separately where a command owns catalog changes.

interface RuleShape {
  when: string[];
  doSide: string[];
  comment?: string;
  children: RuleShape[];
}

function ruleShape(json: RuleJson): RuleShape {
  const shape: RuleShape = {
    when: json.when.toArray(),
    doSide: json.do.toArray(),
    children: json.children.toArray().map(ruleShape),
  };
  if (json.comment !== undefined) shape.comment = json.comment;
  return shape;
}

function documentShape(brain: BrainDef): { name: string; pages: { name: string; rules: RuleShape[] }[] } {
  return {
    name: brain.name(),
    pages: brain
      .pages()
      .toArray()
      .map((page) => ({
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

  test("InsertRuleBeforeCommand inserts at the target's index", () => {
    const { brain, ruleA } = brainWithTwoRules();
    assertCommandRoundTrip(brain, new InsertRuleBeforeCommand(ruleA));
    assert.equal(firstPage(brain).children().size(), 3);
    assert.equal(firstPage(brain).children().get(1), ruleA);
  });

  test("DeleteRuleCommand restores the rule subtree on undo", () => {
    const { brain, ruleA } = brainWithTwoRules();
    const child = ruleA.appendNewRule();
    child.when().appendTile(sensorTile());
    assertCommandRoundTrip(brain, new DeleteRuleCommand(ruleA));
    assert.equal(firstPage(brain).children().size(), 1);
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

  test("PasteRuleAboveCommand inserts the produced rules above the target, re-producing on redo", () => {
    const { brain, ruleA, ruleB } = brainWithTwoRules();
    ruleA.when().appendTile(sensorTile());
    ruleA.do().appendTile(numberLiteralTile(brain, 42));
    // The producer mirrors the paste flow: it deserializes a captured rule
    // snapshot into the destination brain on every execute, so redo mints
    // fresh rule instances just like a clipboard paste does.
    const copiedRuleJson = ruleA.toJson();
    let producerCalls = 0;
    const command = new PasteRuleAboveCommand(ruleB, (destBrain) => {
      producerCalls++;
      const rule = new BrainRuleDef();
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

// ---- Clone isolation -------------------------------------------------------
// The editor edits `sourceBrain.clone()` and drops the clone on discard, so a
// command executed against the clone must leave the source brain byte-identical
// to its pre-clone snapshot. The snapshot extends the document shape with a
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
 * One row of the clone-isolation table: `build` populates a fresh brain, and
 * `makeCommand` locates its targets positionally so the same row can be applied
 * to the clone.
 */
interface CloneIsolationCase {
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

const cloneIsolationCases: CloneIsolationCase[] = [
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
    name: "SetRuleCommentCommand",
    build: () => {},
    makeCommand: (brain) => new SetRuleCommentCommand(firstRule(brain), "comment on the clone"),
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
    name: "InsertRuleBeforeCommand",
    build: buildTwoRules,
    makeCommand: (brain) => new InsertRuleBeforeCommand(ruleAt(brain, 0)),
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
    name: "PasteRuleAboveCommand",
    build: buildTwoRules,
    makeCommand: (brain) => {
      const copiedRuleJson = ruleAt(brain, 0).toJson();
      return new PasteRuleAboveCommand(ruleAt(brain, 1), (destBrain) => {
        const rule = new BrainRuleDef();
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

describe("commands run against a clone leave the source brain untouched", () => {
  for (const testCase of cloneIsolationCases) {
    test(testCase.name, () => {
      const source = newBrain();
      testCase.build(source);
      const sourceSnapshot = brainSnapshot(source);

      const working = source.clone();
      const history = new BrainCommandHistory();
      history.executeCommand(testCase.makeCommand(working));

      assert.notDeepEqual(brainSnapshot(working), sourceSnapshot, "execute must change the working copy");
      assert.deepEqual(brainSnapshot(source), sourceSnapshot, "the source brain must be untouched");
    });
  }
});
