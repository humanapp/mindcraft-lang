import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { compileUserTile, initCompiler } from "./compile.js";

const VALID_SENSOR_SOURCE = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "is-close",
  output: "boolean",
  params: {
    distance: { type: "number", default: 5 },
  },
  exec(ctx: Context, params: { distance: number }): boolean {
    return params.distance < 10;
  },
});
`;

describe("compileUserTile", () => {
  before(async () => {
    await initCompiler();
  });
  test("valid sensor source produces zero diagnostics", () => {
    const result = compileUserTile(VALID_SENSOR_SOURCE);
    assert.deepStrictEqual(result.diagnostics, []);
  });

  test("calling nonexistent engine method produces a diagnostic", () => {
    const source = `
import { type Context } from "mindcraft";

function doStuff(ctx: Context): void {
  ctx.engine.nonExistent();
}
`;
    const result = compileUserTile(source);
    assert.ok(result.diagnostics.length > 0, "expected at least one diagnostic");
    const msg = result.diagnostics[0].message;
    assert.ok(msg.includes("nonExistent"), `expected diagnostic to mention 'nonExistent', got: ${msg}`);
  });

  test("wrong argument type produces a diagnostic", () => {
    const source = `
import { type Context } from "mindcraft";

function doStuff(ctx: Context): void {
  ctx.self.setVariable(123, "value");
}
`;
    const result = compileUserTile(source);
    assert.ok(result.diagnostics.length > 0, "expected at least one diagnostic");
  });

  test("diagnostics include line and column info", () => {
    const source = `
import { type Context } from "mindcraft";

function doStuff(ctx: Context): void {
  ctx.engine.nonExistent();
}
`;
    const result = compileUserTile(source);
    assert.ok(result.diagnostics.length > 0);
    const diag = result.diagnostics[0];
    assert.ok(typeof diag.line === "number", "expected line number");
    assert.ok(typeof diag.column === "number", "expected column number");
  });

  test("empty source produces no diagnostics", () => {
    const result = compileUserTile("");
    assert.deepStrictEqual(result.diagnostics, []);
  });
});
