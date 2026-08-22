import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RuleSide } from "@wendoo/core/brain";
import { CompilationDiagCode, ParseDiagCode } from "@wendoo/core/brain/compiler";
import type { BrainJson } from "@wendoo/core/brain/model";
import { AddRuleCommand, AddTileCommand, BrainRuleDef } from "@wendoo/core/brain/model";
import { RehearsalRejection, RehearsalRejectionCode } from "../kit/index.js";
import type { TraceSummary } from "../simulate/summarizer.js";
import { createTargetAdapter, FAKE_SUBJECT, ruleIdAt } from "../testing/index.js";
import type { CompileDiagnostic } from "./compile.js";
import { compileBrain } from "./compile.js";
import { proposeEdit } from "./propose-edit.js";
import { readProject } from "./read-project.js";
import { rulesToExclude, simulate } from "./simulate.js";
import type { AuthoringWorkspace } from "./workspace.js";
import { allTiles, createAuthoringWorkspace, findPage, findRule, findTile, locateRules } from "./workspace.js";

/** Tiles the fake target's brains are authored from. */
const tiles = {
  sensor: "tile.sensor->sensor.fake.signal",
  actuator: "tile.actuator->actuator.fake.emit",
  modifier: "tile.modifier->modifier:fake.loudly",
  parameter: "tile.parameter->parameter:fake.strength",
  numberFactory: "tile.lit.factory->number",
} as const;

/** Where the work-in-progress document's rules stand, by the state each rule is in. */
const wipRulePath = { clean: "0/0", warned: "0/1", broken: "0/2" } as const;

/** Durable ids of `workspace`'s rules, by the state each rule is in. */
function wipRules(workspace: AuthoringWorkspace): Record<keyof typeof wipRulePath, string> {
  return {
    clean: ruleIdAt(workspace.brainDef, wipRulePath.clean),
    warned: ruleIdAt(workspace.brainDef, wipRulePath.warned),
    broken: ruleIdAt(workspace.brainDef, wipRulePath.broken),
  };
}

/** Put `tileId` on `side` of `ruleId` through a core command, around `propose_edit`. */
function place(workspace: AuthoringWorkspace, ruleId: string, side: RuleSide, tileId: string): void {
  const rule = findRule(workspace.brainDef, ruleId)!.rule;
  workspace.history.executeCommand(new AddTileCommand(rule, side, findTile(workspace.catalogs, tileId)!));
}

/**
 * The brain JSON of a project part-way through being written: the first rule is
 * finished and builds, the second carries a warning the build recovers from,
 * and the third carries two error-severity placement mismatches. Authored
 * through core commands, as a person editing the document would leave it.
 */
function wipBrainJson(): BrainJson {
  const workspace = createAuthoringWorkspace(createTargetAdapter(), "wip");
  const page = findPage(workspace.brainDef, 0)!;
  workspace.history.executeCommand(new AddRuleCommand(page));
  workspace.history.executeCommand(new AddRuleCommand(page));
  const rule = wipRules(workspace);

  place(workspace, rule.clean, RuleSide.When, tiles.sensor);
  place(workspace, rule.clean, RuleSide.Do, tiles.actuator);
  place(workspace, rule.clean, RuleSide.Do, tiles.modifier);

  // A second WHEN sensor is an expression code generation drops: a warning the
  // build recovers from.
  place(workspace, rule.warned, RuleSide.When, tiles.sensor);
  place(workspace, rule.warned, RuleSide.When, tiles.sensor);

  // An actuator cannot sit on a WHEN side; two of them are two errors.
  place(workspace, rule.broken, RuleSide.When, tiles.actuator);
  place(workspace, rule.broken, RuleSide.When, tiles.actuator);

  return workspace.brainDef.toJson() as BrainJson;
}

/** A session opened on the work-in-progress document. */
function wipWorkspace(): AuthoringWorkspace {
  return createAuthoringWorkspace(createTargetAdapter(), "unused", { brainJson: wipBrainJson() });
}

/** Every diagnostic the document reports, as `code@ruleId` entries in report order. */
function documentDiagnostics(workspace: AuthoringWorkspace): string[] {
  return compileBrain(workspace).diagnostics.map((diag) => `${diag.code}@${diag.ruleId ?? "document"}`);
}

/** Error-severity diagnostics the document reports. */
function documentErrors(workspace: AuthoringWorkspace): CompileDiagnostic[] {
  return compileBrain(workspace).diagnostics.filter((diag) => diag.severity === "error");
}

/** Tile ids the document's own catalog holds right now, sorted. */
function documentTileIds(workspace: AuthoringWorkspace): string[] {
  return allTiles(workspace.catalogs).map((tile) => tile.tileId);
}

describe("a session opened on a work-in-progress document", () => {
  test("opens the document it was given, not a new one", () => {
    const project = readProject(wipWorkspace());

    assert.equal(project.pages[0]?.rules.length, 3);
    assert.deepEqual(
      project.pages[0]?.rules[0]?.when.map((tile) => tile.tileId),
      [tiles.sensor]
    );
  });

  test("carries the document's pre-existing diagnostics in", () => {
    const workspace = wipWorkspace();
    const errors = documentErrors(workspace);

    assert.equal(errors.length, 2);
    for (const error of errors) {
      assert.equal(error.code, ParseDiagCode.TilePlacementSideMismatch);
      assert.equal(error.ruleId, wipRules(workspace).broken);
    }
  });

  test("names the parse code behind a standing drop as well as the drop", () => {
    const workspace = wipWorkspace();
    const warned = wipRules(workspace).warned;
    const diagnostics = documentDiagnostics(workspace);

    assert.ok(
      diagnostics.includes(`${ParseDiagCode.UnexpectedActionCallAfterExpression}@${warned}`),
      JSON.stringify(diagnostics)
    );
    assert.ok(
      diagnostics.includes(`${CompilationDiagCode.UncompilableExpressionDropped}@${warned}`),
      JSON.stringify(diagnostics)
    );
  });
});

describe("the key a standing diagnostic is counted under", () => {
  test("stays the same when a rule inserted above moves every path below it", () => {
    const workspace = wipWorkspace();
    const page = findPage(workspace.brainDef, 0)!;
    const before = documentDiagnostics(workspace);
    const pathsBefore = locateRules(workspace.brainDef).map((located) => located.rulePath);

    page.addRuleAtIndex(0, new BrainRuleDef(workspace.brainDef.servicesRng()));

    const pathsAfter = locateRules(workspace.brainDef).map((located) => located.rulePath);
    assert.equal(pathsAfter.length, pathsBefore.length + 1, "the insertion added a rule");
    assert.deepEqual(documentDiagnostics(workspace), before);
  });
});

describe("propose_edit judges an edit by what it introduced", () => {
  test("accepts a valid edit to a clean rule despite an error standing elsewhere", () => {
    const workspace = wipWorkspace();

    const edit = proposeEdit(workspace, {
      op: "placeTiles",
      ruleId: wipRules(workspace).clean,
      side: "do",
      tileIds: [tiles.parameter, { tileId: tiles.numberFactory, value: 7 }],
    });

    assert.equal(edit.ok, true, JSON.stringify(edit));
    assert.equal(documentErrors(workspace).length, 2, "the pre-existing errors are untouched");
  });

  test("accepts an edit that leaves a rule's standing parse warning exactly as it found it", () => {
    const workspace = wipWorkspace();
    const diagnosticsBefore = documentDiagnostics(workspace);

    const edit = proposeEdit(workspace, {
      op: "placeTile",
      ruleId: wipRules(workspace).warned,
      side: "do",
      tileId: tiles.actuator,
    });

    assert.equal(edit.ok, true, JSON.stringify(edit));
    assert.deepEqual(documentDiagnostics(workspace), diagnosticsBefore, "the standing warning neither grew nor shrank");
  });

  test("rejects an edit that raises a standing warning's count, naming the parse code over the drop", () => {
    const workspace = wipWorkspace();

    const rejected = proposeEdit(workspace, {
      op: "placeTile",
      ruleId: wipRules(workspace).warned,
      side: "when",
      tileId: tiles.sensor,
    });

    assert.equal(rejected.ok, false);
    assert.equal((rejected as { code: number }).code, ParseDiagCode.UnexpectedActionCallAfterExpression);
  });

  test("accepts an edit to a clean rule while the broken rule reports two errors", () => {
    const workspace = wipWorkspace();

    const edit = proposeEdit(workspace, { op: "addRule", pageIndex: 0 });

    assert.equal(edit.ok, true, JSON.stringify(edit));
  });

  test("accepts an incremental repair that leaves one of two problems standing", () => {
    const workspace = wipWorkspace();

    const repair = proposeEdit(workspace, {
      op: "deleteTile",
      ruleId: wipRules(workspace).broken,
      side: "when",
      position: 1,
    });

    assert.equal(repair.ok, true, JSON.stringify(repair));
    assert.equal(documentErrors(workspace).length, 1, "the repair removed one of the two errors");
  });

  test("rejects an edit that introduces a code the document did not report", () => {
    const workspace = wipWorkspace();
    const diagnosticsBefore = documentDiagnostics(workspace);

    const rejected = proposeEdit(workspace, {
      op: "placeTile",
      ruleId: wipRules(workspace).clean,
      side: "when",
      tileId: tiles.sensor,
    });

    assert.equal(rejected.ok, false);
    assert.equal((rejected as { code: number }).code, ParseDiagCode.UnexpectedActionCallAfterExpression);
    assert.deepEqual(documentDiagnostics(workspace), diagnosticsBefore);
  });

  test("rejects an edit that adds the document's own error code to a rule that was clean", () => {
    const workspace = wipWorkspace();
    const diagnosticsBefore = documentDiagnostics(workspace);

    const rejected = proposeEdit(workspace, {
      op: "placeTile",
      ruleId: wipRules(workspace).clean,
      side: "when",
      tileId: tiles.actuator,
    });

    assert.equal(rejected.ok, false);
    assert.equal((rejected as { code: number }).code, ParseDiagCode.TilePlacementSideMismatch);
    assert.deepEqual(documentDiagnostics(workspace), diagnosticsBefore, "the rule it was clean in stayed clean");
  });

  test("rejects an edit that raises the count of a code already standing in that rule", () => {
    const workspace = wipWorkspace();

    const rejected = proposeEdit(workspace, {
      op: "placeTile",
      ruleId: wipRules(workspace).broken,
      side: "when",
      tileId: tiles.actuator,
    });

    assert.equal(rejected.ok, false);
    assert.equal((rejected as { code: number }).code, ParseDiagCode.TilePlacementSideMismatch);
    assert.equal(documentErrors(workspace).length, 2, "the third actuator did not land");
  });

  test("restores the document and the catalog exactly when a run is rejected", () => {
    const workspace = wipWorkspace();
    const diagnosticsBefore = documentDiagnostics(workspace);
    const tileIdsBefore = documentTileIds(workspace);
    const historyBefore = workspace.history.undoDepth();
    const projectBefore = readProject(workspace);

    const rejected = proposeEdit(workspace, {
      op: "placeTiles",
      ruleId: wipRules(workspace).clean,
      side: "when",
      tileIds: [{ tileId: tiles.numberFactory, value: 41 }, tiles.actuator],
    });

    assert.equal(rejected.ok, false);
    assert.deepEqual(documentDiagnostics(workspace), diagnosticsBefore);
    assert.deepEqual(documentTileIds(workspace), tileIdsBefore, "the run's minted tile left the catalog with it");
    assert.equal(workspace.history.undoDepth(), historyBefore);
    assert.deepEqual(readProject(workspace), projectBefore);
  });
});

describe("simulate rehearses a document that does not wholly build", () => {
  test("runs without the error-bearing rule and states what it left out", async () => {
    const workspace = wipWorkspace();

    const result = await simulate(workspace, { scenario: { seed: 7, subject: FAKE_SUBJECT }, thinks: 5 });

    assert.equal(result.ok, true, JSON.stringify(result));
    const summary = (result as { summary: TraceSummary }).summary;
    assert.deepEqual(summary.excludedRules, [
      {
        ruleId: wipRules(workspace).broken,
        codes: [ParseDiagCode.TilePlacementSideMismatch, ParseDiagCode.TilePlacementSideMismatch],
      },
    ]);
  });

  test("observes the rules it kept and never the rule it left out", async () => {
    const workspace = wipWorkspace();

    const result = await simulate(workspace, { scenario: { seed: 7, subject: FAKE_SUBJECT }, thinks: 5 });

    const rule = wipRules(workspace);
    const ruleIds = (result as { summary: TraceSummary }).summary.rules.map((entry) => entry.ruleId);
    assert.ok(ruleIds.includes(rule.clean), "the finished rule was rehearsed");
    assert.ok(!ruleIds.includes(rule.broken), "the excluded rule reported nothing");
  });

  test("states no exclusion for a document that wholly builds", async () => {
    const workspace = wipWorkspace();
    const broken = wipRules(workspace).broken;
    proposeEdit(workspace, { op: "deleteTile", ruleId: broken, side: "when", position: 1 });
    proposeEdit(workspace, { op: "deleteTile", ruleId: broken, side: "when", position: 0 });

    const result = await simulate(workspace, { scenario: { seed: 7, subject: FAKE_SUBJECT }, thinks: 5 });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal((result as { summary: TraceSummary }).summary.excludedRules, undefined);
  });

  test("names one exclusion per rule, carrying every code that rule reports", () => {
    const excluded = rulesToExclude([
      { code: 4001, severity: "error", ruleId: "secondRule00002" },
      { code: 1016, severity: "error", ruleId: "firstRule000001" },
      { code: 3002, severity: "warning", ruleId: "firstRule000001" },
      { code: 1016, severity: "error", ruleId: "secondRule00002" },
    ]);

    assert.deepEqual(excluded, [
      { ruleId: "firstRule000001", codes: [1016] },
      { ruleId: "secondRule00002", codes: [4001, 1016] },
    ]);
  });

  test("names no exclusion for a build that reports no error", () => {
    assert.deepEqual(rulesToExclude([{ code: 3002, severity: "warning", ruleId: "firstRule000001" }]), []);
  });

  test("falls back rather than excluding when a build error names no rule", () => {
    const excluded = rulesToExclude([
      { code: 1016, severity: "error", ruleId: "firstRule000001" },
      { code: 4002, severity: "error" },
    ]);

    assert.equal(excluded, undefined, "a document-level error is one no exclusion can work around");
  });
});

describe("a rehearsal adapter refuses a brain that does not build", () => {
  test("raises a rejection carrying the build errors instead of an empty account", async () => {
    const workspace = wipWorkspace();

    const rejection = await workspace.adapter
      .run({ brainDef: workspace.brainDef, scenario: { seed: 7, subject: FAKE_SUBJECT }, thinks: 5 })
      .then(
        () => undefined,
        (error: unknown) => error
      );

    assert.ok(rejection instanceof RehearsalRejection, String(rejection));
    assert.equal(rejection.code, RehearsalRejectionCode.BrainDoesNotBuild);
    // A core build diagnostic carries `rulePath`.
    assert.deepEqual(
      rejection.diagnostics.map((diag) => `${diag.code}@${diag.params?.rulePath}`),
      [
        `${ParseDiagCode.TilePlacementSideMismatch}@${wipRulePath.broken}`,
        `${ParseDiagCode.TilePlacementSideMismatch}@${wipRulePath.broken}`,
      ]
    );
    assert.ok(
      rejection.diagnostics.every((diag) => diag.severity === "error"),
      "the rejection carries only what stopped the build"
    );
  });

  test("runs the same brain once the failing rule is named as excluded", async () => {
    const workspace = wipWorkspace();

    const run = await workspace.adapter.run({
      brainDef: workspace.brainDef,
      scenario: { seed: 7, subject: FAKE_SUBJECT },
      thinks: 5,
      excludedRules: [wipRules(workspace).broken],
    });

    assert.equal(run.thinks, 5);
  });
});
