import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RuleTriggerMode } from "@wendoo/core/brain";
import type { RuleTriggerName } from "./tool-schemas.js";
import { maxBatchCommands, maxPlacedTiles, toolDefinitions, toolInputSchemas } from "./tool-schemas.js";

/** `true` only while the modes the tool schema takes are exactly core's own. */
type TriggerNamesMatchCore = [RuleTriggerName] extends [RuleTriggerMode]
  ? [RuleTriggerMode] extends [RuleTriggerName]
    ? true
    : false
  : false;

describe("the bridge tool surface", () => {
  test("offers the tools of the authoring slice", () => {
    assert.deepEqual(
      toolDefinitions.map((tool) => tool.name),
      [
        "compile",
        "offer_libraries",
        "propose_edit",
        "read_catalog",
        "read_libraries",
        "read_project",
        "simulate",
        "suggest_tiles",
      ]
    );
  });

  test("emits the same definitions on every read, so the tool block is byte-stable", () => {
    assert.equal(JSON.stringify(toolDefinitions), JSON.stringify(toolDefinitions));
    assert.deepEqual(
      toolDefinitions.map((tool) => tool.name),
      [...toolDefinitions].sort((a, b) => (a.name < b.name ? -1 : 1)).map((tool) => tool.name)
    );
  });

  test("carries a when-to-call description per tool", () => {
    for (const tool of toolDefinitions) {
      assert.ok(tool.description.length > 0, `${tool.name} description`);
    }
  });

  test("declares an object input on every tool, union-bodied ones included", () => {
    for (const tool of toolDefinitions) {
      assert.equal((tool.inputSchema as { type?: string }).type, "object", `${tool.name} input schema type`);
    }
  });

  test("permits no properties the schema does not name", () => {
    for (const tool of toolDefinitions) {
      const schema = tool.inputSchema as { oneOf?: unknown[] };
      const branches = (schema.oneOf ?? [schema]) as { type?: string; additionalProperties?: boolean }[];
      for (const branch of branches) {
        assert.equal(branch.type, "object", `${tool.name} takes an object`);
        assert.equal(branch.additionalProperties, false, `${tool.name} accepts only named properties`);
      }
    }
  });
});

describe("tool input validation", () => {
  test("accepts an edit naming an operation and its arguments", () => {
    const parsed = toolInputSchemas.propose_edit.safeParse({
      op: "placeTile",
      ruleId: "0/0",
      side: "when",
      tileId: "tile.sensor->see",
    });

    assert.equal(parsed.success, true);
  });

  test("accepts a run of tiles as one operation", () => {
    const parsed = toolInputSchemas.propose_edit.safeParse({
      op: "placeTiles",
      ruleId: "0/0",
      side: "when",
      tileIds: ["tile.op->not", "tile.sensor->see"],
    });

    assert.equal(parsed.success, true);
  });

  test("accepts a run whose entry names a factory tile and what it mints", () => {
    const parsed = toolInputSchemas.propose_edit.safeParse({
      op: "placeTiles",
      ruleId: "0/0",
      side: "do",
      tileIds: [
        "tile.actuator->say",
        { tileId: "tile.lit.factory->string", value: "hello" },
        { tileId: "tile.var.factory->number", name: "speed" },
      ],
    });

    assert.equal(parsed.success, true);
  });

  test("accepts a factory tile and its mint input wherever a single tile is named", () => {
    for (const input of [
      { op: "placeTile", ruleId: "0/0", side: "do", tileId: { tileId: "tile.lit.factory->number", value: 30 } },
      {
        op: "replaceTile",
        ruleId: "0/0",
        side: "do",
        position: 1,
        tileId: { tileId: "tile.lit.factory->number", value: 30, displayFormat: "percent" },
      },
      {
        op: "placeTile",
        ruleId: "0/0",
        side: "when",
        tileId: { tileId: "tile.var.factory->number", name: "speed" },
      },
    ]) {
      const parsed = toolInputSchemas.propose_edit.safeParse(input);

      assert.equal(parsed.success, true, JSON.stringify(input));
    }
  });

  test("takes exactly the trigger modes core defines, and advertises them", () => {
    const matchesCore: TriggerNamesMatchCore = true;
    const properties = (
      toolDefinitions.find((tool) => tool.name === "propose_edit")?.inputSchema as {
        properties?: Record<string, { enum?: string[] }>;
      }
    ).properties;

    assert.equal(matchesCore, true);
    assert.deepEqual(properties?.trigger?.enum, Object.values(RuleTriggerMode));
  });

  test("accepts a rule made in a trigger mode, and a rule switched to one", () => {
    for (const input of [
      { op: "addRule", pageIndex: 0, trigger: "otherwise" },
      { op: "addChildRule", parentRuleId: "0/0", trigger: "then" },
      { op: "setRuleTrigger", ruleId: "0/0", trigger: "when" },
    ]) {
      const parsed = toolInputSchemas.propose_edit.safeParse(input);

      assert.equal(parsed.success, true, JSON.stringify(input));
    }
  });

  test("accepts a rule made without naming a trigger mode, which takes the default", () => {
    const parsed = toolInputSchemas.propose_edit.safeParse({ op: "addRule", pageIndex: 0 });

    assert.equal(parsed.success, true);
  });

  test("rejects a trigger mode the modes do not name, and a switch naming none", () => {
    for (const input of [
      { op: "addRule", pageIndex: 0, trigger: "always" },
      { op: "setRuleTrigger", ruleId: "0/0" },
    ]) {
      const parsed = toolInputSchemas.propose_edit.safeParse(input);

      assert.equal(parsed.success, false, JSON.stringify(input));
    }
  });

  test("rejects a run entry that names no tile", () => {
    const parsed = toolInputSchemas.propose_edit.safeParse({
      op: "placeTiles",
      ruleId: "0/0",
      side: "do",
      tileIds: [{ value: "hello" }],
    });

    assert.equal(parsed.success, false);
  });

  test("rejects a run of tiles that names none", () => {
    const parsed = toolInputSchemas.propose_edit.safeParse({
      op: "placeTiles",
      ruleId: "0/0",
      side: "when",
      tileIds: [],
    });

    assert.equal(parsed.success, false);
  });

  test("names every operation and the arguments it takes in the discriminator description", () => {
    const proposeEdit = toolDefinitions.find((tool) => tool.name === "propose_edit");
    const properties = (proposeEdit?.inputSchema as { properties?: Record<string, { enum?: string[] }> }).properties;

    assert.deepEqual(properties?.op?.enum, [
      "addRule",
      "addChildRule",
      "setRuleTrigger",
      "placeTile",
      "placeTiles",
      "replaceTile",
      "deleteTile",
      "addPage",
      "deleteRule",
      "deletePage",
      "batch",
    ]);
    assert.ok(
      (properties?.op as { description?: string })?.description?.includes("placeTiles takes ruleId, side, tileIds"),
      "the enum description names each operation's own arguments"
    );
    assert.ok(
      (properties?.op as { description?: string })?.description?.includes("addChildRule takes parentRuleId"),
      "the enum description names the operation that nests a rule"
    );
    assert.ok(
      (properties?.op as { description?: string })?.description?.includes("addPage takes name"),
      "the enum description names the operation that makes a page"
    );
    assert.ok(
      (properties?.op as { description?: string })?.description?.includes("deletePage takes pageId"),
      "the enum description names the operation that removes a page"
    );
  });

  test("describes a property that means something different under each operation once per operation", () => {
    const proposeEdit = toolDefinitions.find((tool) => tool.name === "propose_edit");
    const properties = (proposeEdit?.inputSchema as { properties?: Record<string, { description?: string }> })
      .properties;
    const position = properties?.position?.description ?? "";

    for (const op of ["placeTile", "placeTiles", "replaceTile", "deleteTile"]) {
      assert.ok(position.includes(`${op}:`), `position says what it means under ${op}: ${position}`);
    }
  });

  test("describes a property the branches word identically once", () => {
    const suggest = toolDefinitions.find((tool) => tool.name === "suggest_tiles");
    const properties = (suggest?.inputSchema as { properties?: Record<string, { description?: string }> }).properties;

    assert.equal(properties?.ruleId?.description?.includes("insert:"), false);
    assert.ok((properties?.position?.description ?? "").includes("replace:"), "position differs by mode and says so");
  });

  test("advertises a batch command in the same flattened shape as a single command", () => {
    const proposeEdit = toolDefinitions.find((tool) => tool.name === "propose_edit");
    const properties = (proposeEdit?.inputSchema as { properties: Record<string, unknown> }).properties;
    const commands = properties.commands as { items: { properties: Record<string, { enum?: string[] }> } };
    const top = properties.op as { enum: string[] };

    assert.deepEqual(
      commands.items.properties.op?.enum,
      top.enum.filter((op) => op !== "batch")
    );
    assert.deepEqual(Object.keys(commands.items.properties).sort(), Object.keys(properties).sort().slice(1));
  });

  test("tells the model how a batch command names a rule the batch itself makes", () => {
    const proposeEdit = toolDefinitions.find((tool) => tool.name === "propose_edit");
    const properties = (proposeEdit?.inputSchema as { properties?: Record<string, { description?: string }> })
      .properties;

    assert.ok((properties?.ruleId?.description ?? "").includes("#N"));
    assert.ok((properties?.commands?.description ?? "").includes("#N"));
  });

  test("accepts a batch of two commands and refuses one carrying a single command", () => {
    const command = { op: "addRule", pageIndex: 0 };

    assert.equal(toolInputSchemas.propose_edit.safeParse({ op: "batch", commands: [command, command] }).success, true);
    assert.equal(toolInputSchemas.propose_edit.safeParse({ op: "batch", commands: [command] }).success, false);
  });

  test("accepts a batch at the command cap and refuses one over it", () => {
    const batch = (length: number) => ({
      op: "batch",
      commands: Array.from({ length }, () => ({ op: "addRule", pageIndex: 0 })),
    });

    assert.equal(toolInputSchemas.propose_edit.safeParse(batch(maxBatchCommands)).success, true);
    assert.equal(toolInputSchemas.propose_edit.safeParse(batch(maxBatchCommands + 1)).success, false);
  });

  test("advertises the command cap, so the model reads it before planning", () => {
    const proposeEdit = toolDefinitions.find((tool) => tool.name === "propose_edit");
    const properties = (proposeEdit?.inputSchema as { properties?: Record<string, { maxItems?: number }> }).properties;

    assert.equal(properties?.commands?.maxItems, maxBatchCommands);
  });

  test("accepts a tile run at the cap and refuses one over it", () => {
    const run = (length: number) => ({
      op: "placeTiles",
      ruleId: "rule-0",
      side: "when",
      tileIds: Array.from({ length }, () => "tile.sensor->sensor.fake.signal"),
    });

    assert.equal(toolInputSchemas.propose_edit.safeParse(run(maxPlacedTiles)).success, true);
    assert.equal(toolInputSchemas.propose_edit.safeParse(run(maxPlacedTiles + 1)).success, false);
  });

  test("advertises the tile-run cap", () => {
    const proposeEdit = toolDefinitions.find((tool) => tool.name === "propose_edit");
    const properties = (proposeEdit?.inputSchema as { properties?: Record<string, { maxItems?: number }> }).properties;

    assert.equal(properties?.tileIds?.maxItems, maxPlacedTiles);
  });

  test("refuses a batch carrying a batch", () => {
    assert.equal(
      toolInputSchemas.propose_edit.safeParse({
        op: "batch",
        commands: [
          { op: "addRule", pageIndex: 0 },
          { op: "batch", commands: [] },
        ],
      }).success,
      false
    );
  });

  test("rejects an unknown operation", () => {
    assert.equal(toolInputSchemas.propose_edit.safeParse({ op: "rewriteEverything" }).success, false);
  });

  test("rejects an unknown rule side", () => {
    assert.equal(
      toolInputSchemas.suggest_tiles.safeParse({ mode: "insert", ruleId: "0/0", side: "sideways" }).success,
      false
    );
  });

  test("accepts a suggestion request in either mode and refuses one naming neither", () => {
    assert.equal(
      toolInputSchemas.suggest_tiles.safeParse({ mode: "insert", ruleId: "0/0", side: "when" }).success,
      true
    );
    assert.equal(
      toolInputSchemas.suggest_tiles.safeParse({ mode: "replace", ruleId: "0/0", side: "when", position: 1 }).success,
      true
    );
    assert.equal(toolInputSchemas.suggest_tiles.safeParse({ ruleId: "0/0", side: "when" }).success, false);
  });

  test("requires the replaced position, which insert mode may leave to the end of the side", () => {
    assert.equal(
      toolInputSchemas.suggest_tiles.safeParse({ mode: "replace", ruleId: "0/0", side: "when" }).success,
      false
    );
  });

  test("names both suggestion modes and the arguments each takes in the discriminator description", () => {
    const suggest = toolDefinitions.find((tool) => tool.name === "suggest_tiles");
    const properties = (suggest?.inputSchema as { properties?: Record<string, { enum?: string[] }> }).properties;

    assert.deepEqual(properties?.mode?.enum, ["insert", "replace"]);
    assert.ok(
      (properties?.mode as { description?: string })?.description?.includes("replace takes ruleId, side, position"),
      "the enum description names each mode's own arguments"
    );
  });

  test("rejects a simulate request with no think count", () => {
    assert.equal(toolInputSchemas.simulate.safeParse({ scenario: { seed: 1, subject: "herbivore" } }).success, false);
  });

  test("accepts a scenario scripting percepts of any kind, at any think, of any value shape", () => {
    const parsed = toolInputSchemas.simulate.safeParse({
      scenario: {
        seed: 1,
        subject: "device",
        inputs: [
          { kind: "button-a", at: 2, value: true },
          { kind: "light-level", at: 0, value: 40 },
          { kind: "radio-message-string", at: 4, value: "go" },
        ],
      },
      thinks: 10,
    });

    assert.equal(parsed.success, true);
  });

  test("rejects a scripted percept missing its kind, its think, or its value", () => {
    for (const input of [
      { at: 0, value: true },
      { kind: "button-a", value: true },
      { kind: "button-a", at: 0 },
      { kind: "", at: 0, value: true },
      { kind: "button-a", at: -1, value: true },
      { kind: "button-a", at: 0, value: { level: 1 } },
    ]) {
      const parsed = toolInputSchemas.simulate.safeParse({
        scenario: { seed: 1, subject: "device", inputs: [input] },
        thinks: 10,
      });

      assert.equal(parsed.success, false, JSON.stringify(input));
    }
  });
});
