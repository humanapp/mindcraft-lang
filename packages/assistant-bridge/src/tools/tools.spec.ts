import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { catalogDigest } from "../catalog/digest.js";
import { createTargetAdapter, FAKE_SUBJECT } from "../testing/index.js";
import { executeToolCall } from "./dispatch.js";
import { proposeEdit } from "./propose-edit.js";
import { readCatalog } from "./read-catalog.js";
import { readProject } from "./read-project.js";
import { suggestTiles } from "./suggest-tiles.js";
import { toolDefinitions } from "./tool-schemas.js";
import type { AuthoringWorkspace } from "./workspace.js";
import { createAuthoringWorkspace } from "./workspace.js";

/** Tiles the fake target's brains are authored from. */
const tiles = {
  sensor: "tile.sensor->sensor.fake.signal",
  actuator: "tile.actuator->actuator.fake.emit",
  modifier: "tile.modifier->modifier:fake.loudly",
  parameter: "tile.parameter->parameter:fake.strength",
  numberFactory: "tile.lit.factory->number",
  variableFactory: "tile.var.factory->number",
} as const;

/** A workspace over the fake target, one empty rule ready at `0/0`. */
function workspace(): AuthoringWorkspace {
  return createAuthoringWorkspace(createTargetAdapter(), "fake brain");
}

/** Author `WHEN the signal is on DO emit loudly at strength 7` into `0/0`. */
function authorSignalRule(ws: AuthoringWorkspace): void {
  const when = proposeEdit(ws, { op: "placeTiles", ruleId: "0/0", side: "when", tileIds: [tiles.sensor] });
  assert.equal(when.ok, true, JSON.stringify(when));
  const doSide = proposeEdit(ws, {
    op: "placeTiles",
    ruleId: "0/0",
    side: "do",
    tileIds: [tiles.actuator, tiles.modifier, tiles.parameter, { tileId: tiles.numberFactory, value: 7 }],
  });
  assert.equal(doSide.ok, true, JSON.stringify(doSide));
}

describe("the bridge tools over a real target", () => {
  test("offers every tool the model may call, in a stable order", () => {
    const names = toolDefinitions.map((definition) => definition.name);

    assert.deepEqual(names, [...names].sort());
    assert.deepEqual(names, ["compile", "propose_edit", "read_catalog", "read_project", "simulate", "suggest_tiles"]);
  });

  test("offers the target's own sensor at the start of a WHEN side", () => {
    const offering = suggestTiles(workspace(), { ruleId: "0/0", side: "when" });

    assert.ok("exact" in offering, JSON.stringify(offering));
    assert.ok(offering.exact.some((tile) => tile.tileId === tiles.sensor));
  });

  test("lands a whole expression as one undoable edit and reads it back", () => {
    const ws = workspace();

    authorSignalRule(ws);

    const project = readProject(ws);
    const rule = project.pages[0]?.rules[0];
    assert.deepEqual(
      rule?.when.map((tile) => tile.tileId),
      [tiles.sensor]
    );
    assert.equal(rule?.do.length, 4);
    assert.equal(ws.history.undoDepth(), 2, "one history entry per accepted run");
  });

  test("leaves the document untouched when an edit is rejected", () => {
    const ws = workspace();

    const rejected = proposeEdit(ws, { op: "placeTile", ruleId: "0/0", side: "when", tileId: tiles.actuator });

    assert.equal(rejected.ok, false);
    assert.deepEqual(readProject(ws).pages[0]?.rules[0]?.when, []);
    assert.equal(ws.history.undoDepth(), 0);
  });

  test("names a manufactured tile by the label it carries, never by its id", () => {
    const ws = workspace();

    const minted = proposeEdit(ws, {
      op: "placeTiles",
      ruleId: "0/0",
      side: "when",
      tileIds: [
        { tileId: tiles.variableFactory, name: "hunger" },
        "tile.op->gt",
        { tileId: tiles.numberFactory, value: 3 },
      ],
    });

    assert.equal(minted.ok, true, JSON.stringify(minted));
    const when = readProject(ws).pages[0]?.rules[0]?.when ?? [];
    for (const tile of when) {
      assert.notEqual(tile.label, tile.tileId, `${tile.tileId} reads by a label`);
    }
    const labels = when.map((tile) => tile.label);
    assert.ok(labels.includes("hunger"), "the minted variable reads by its name");
    assert.ok(labels.includes("3"), "the minted literal reads by its value");
  });

  test("carries manufactured tiles into the catalog and the digest by their labels", () => {
    const ws = workspace();
    proposeEdit(ws, {
      op: "placeTiles",
      ruleId: "0/0",
      side: "when",
      tileIds: [{ tileId: "tile.var.factory->boolean", name: "hunger" }],
    });

    const view = readCatalog(ws, { filter: "hunger" });
    const digest = catalogDigest(view.tiles);

    assert.equal(view.tiles.length, 1);
    assert.equal(view.tiles[0]?.label, "hunger");
    assert.ok(digest.text.includes(" | hunger | "), digest.text);
  });

  test("compiles and rehearses the authored brain through name-and-JSON dispatch", async () => {
    const ws = workspace();
    authorSignalRule(ws);

    const compiled = await executeToolCall(ws, "compile", {});
    const simulated = await executeToolCall(ws, "simulate", {
      scenario: { seed: 20260805, subject: FAKE_SUBJECT },
      thinks: 60,
    });

    assert.deepEqual(compiled.payload, { ok: true, diagnostics: [] });
    const summary = (simulated.payload as { ok: boolean; summary: { rules: unknown[]; dispatchTotals: string[] } })
      .summary;
    assert.equal(summary.rules.length, 1);
    assert.ok(
      summary.dispatchTotals.some((entry) => entry.startsWith("actuator.fake.emit(")),
      summary.dispatchTotals.join(" ")
    );
  });

  test("distinguishes calls of one action by the arguments they carried", async () => {
    const ws = workspace();
    authorSignalRule(ws);

    const simulated = await executeToolCall(ws, "simulate", {
      scenario: { seed: 20260805, subject: FAKE_SUBJECT },
      thinks: 20,
    });

    const { dispatchTotals } = (simulated.payload as { summary: { dispatchTotals: string[] } }).summary;
    assert.ok(
      dispatchTotals.some((entry) => entry.includes("loudly=") && entry.includes("strength=7")),
      dispatchTotals.join(" ")
    );
  });

  test("refuses a call it does not serve and a call whose input does not fit", async () => {
    const ws = workspace();

    const unknown = await executeToolCall(ws, "read_trace", {});
    const invalid = await executeToolCall(ws, "suggest_tiles", { ruleId: "0/0", side: "sideways" });

    assert.equal(unknown.isError, true);
    assert.deepEqual(unknown.payload, { error: "unknown_tool", detail: "read_trace" });
    assert.equal(invalid.isError, true);
    assert.equal((invalid.payload as { error: string }).error, "invalid_input");
  });

  test("reports a scenario naming a subject the target does not offer", async () => {
    const ws = workspace();
    authorSignalRule(ws);

    const simulated = await executeToolCall(ws, "simulate", {
      scenario: { seed: 1, subject: "nobody" },
      thinks: 5,
    });

    assert.deepEqual(simulated.payload, {
      ok: false,
      error: "unknown_subject",
      named: "nobody",
      subjects: [FAKE_SUBJECT],
    });
  });
});
