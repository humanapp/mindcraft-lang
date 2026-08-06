import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toolDefinitions, toolInputSchemas } from "./tool-schemas.js";

describe("the bridge tool surface", () => {
  test("offers the six tools of the authoring slice", () => {
    assert.deepEqual(
      toolDefinitions.map((tool) => tool.name),
      ["compile", "propose_edit", "read_catalog", "read_project", "simulate", "suggest_tiles"]
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

    assert.deepEqual(properties?.op?.enum, ["addRule", "placeTile", "placeTiles", "replaceTile", "deleteTile"]);
    assert.ok(
      (properties?.op as { description?: string })?.description?.includes("placeTiles takes ruleId, side, tileIds"),
      "the enum description names each operation's own arguments"
    );
  });

  test("rejects an unknown operation", () => {
    assert.equal(toolInputSchemas.propose_edit.safeParse({ op: "rewriteEverything" }).success, false);
  });

  test("rejects an unknown rule side", () => {
    assert.equal(toolInputSchemas.suggest_tiles.safeParse({ ruleId: "0/0", side: "sideways" }).success, false);
  });

  test("rejects a simulate request with no think count", () => {
    assert.equal(toolInputSchemas.simulate.safeParse({ scenario: { seed: 1, subject: "herbivore" } }).success, false);
  });
});
