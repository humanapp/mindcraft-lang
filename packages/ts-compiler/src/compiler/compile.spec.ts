import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { compileUserTile } from "./compile.js";
import { CompileDiagCode, DescriptorDiagCode, LoweringDiagCode, ValidatorDiagCode } from "./diag-codes.js";

const VALID_SENSOR_SOURCE = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "is-close",
  output: "boolean",
  params: {
    distance: { type: "number", default: 5 },
  },
  onExecute(ctx: Context, params: { distance: number }): boolean {
    return params.distance < 10;
  },
});
`;

let services: BrainServices;

describe("compileUserTile", () => {
  before(() => {
    services = __test__createBrainServices();
  });
  test("valid sensor source produces zero diagnostics", () => {
    const result = compileUserTile(VALID_SENSOR_SOURCE, { services });
    assert.deepStrictEqual(result.diagnostics, []);
  });

  test("calling nonexistent engine method produces a diagnostic", () => {
    const source = `
import { type Context } from "mindcraft";

function doStuff(ctx: Context): void {
  ctx.engine.nonExistent();
}
`;
    const result = compileUserTile(source, { services });
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
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0, "expected at least one diagnostic");
  });

  test("diagnostics include line and column info", () => {
    const source = `
import { type Context } from "mindcraft";

function doStuff(ctx: Context): void {
  ctx.engine.nonExistent();
}
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    const diag = result.diagnostics[0];
    assert.ok(typeof diag.line === "number", "expected line number");
    assert.ok(typeof diag.column === "number", "expected column number");
  });

  test("empty source produces missing default export diagnostic", () => {
    const result = compileUserTile("", { services });
    assert.ok(result.diagnostics.length > 0, "expected at least one diagnostic");
    assert.ok(
      result.diagnostics.some((d) => d.code === DescriptorDiagCode.MissingDefaultExport),
      "expected diagnostic about missing default export"
    );
  });
});

describe("AST validation", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("class expression produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

const Foo = class {
  bar(): number { return 42; }
};

export default Sensor({
  name: "test",
  output: "boolean",
  params: {},
  onExecute(ctx: Context): boolean { return true; },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === ValidatorDiagCode.ClassExpressionsNotSupported));
  });

  test("var declaration produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

var x = 1;

export default Sensor({
  name: "test",
  output: "boolean",
  params: {},
  onExecute(ctx: Context): boolean { return true; },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === ValidatorDiagCode.VarNotAllowed));
  });

  test("for...in over anonymous object type produces lowering diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function visit(obj: { a: number }): void {
  for (const k in obj) {}
}

export default Sensor({
  name: "test",
  output: "boolean",
  params: {},
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === LoweringDiagCode.ForInOnUnsupportedType));
  });

  test("eval reference produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "boolean",
  params: {},
  onExecute(ctx: Context): boolean {
    eval("1+1");
    return true;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === CompileDiagCode.TypeScriptError));
  });

  test("computed property name produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "boolean",
  params: {},
  onExecute(ctx: Context): boolean {
    const key = "x";
    const obj = { [key]: 1 };
    return true;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === ValidatorDiagCode.ComputedPropertyNamesNotSupported));
  });

  test("enum declaration passes validation", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

enum Direction {
  Up = "north",
  Down = "south",
}

export default Sensor({
  name: "test",
  output: "boolean",
  params: {},
  onExecute(ctx: Context): boolean {
    return Direction.Up === Direction.Up;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
  });

  test("heterogeneous enum declaration produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

enum Mixed {
  A = "a",
  B = 1,
}

export default Sensor({
  name: "test",
  output: "boolean",
  params: {},
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === CompileDiagCode.InvalidEnumDeclaration));
  });

  test("enum object usage produces explicit diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

enum Direction {
  Up = "north",
}

export default Sensor({
  name: "test",
  output: "boolean",
  params: {},
  onExecute(ctx: Context): boolean {
    const ref = Direction;
    return ref !== undefined;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === LoweringDiagCode.EnumObjectUsageNotSupported));
  });

  test("let and const pass validation", () => {
    const result = compileUserTile(VALID_SENSOR_SOURCE, { services });
    assert.deepStrictEqual(result.diagnostics, []);
  });

  test("switch statement passes validation", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    switch (1) {
      case 1:
        return 10;
      default:
        return 20;
    }
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
  });

  test("unsupported type reference in annotation produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function foo(x: Object): void {}

export default Sensor({
  name: "test",
  output: "boolean",
  params: {},
  onExecute(ctx: Context): boolean { return true; },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === ValidatorDiagCode.UnsupportedTypeReference));
  });

  for (const typeName of ["Object", "Function", "CallableFunction", "NewableFunction", "IArguments", "RegExp"]) {
    test(`type reference to ${typeName} produces diagnostic`, () => {
      const source = `
import { Sensor, type Context } from "mindcraft";

let x: ${typeName};

export default Sensor({
  name: "test",
  output: "boolean",
  params: {},
  onExecute(ctx: Context): boolean { return true; },
});
`;
      const result = compileUserTile(source, { services });
      assert.ok(
        result.diagnostics.some((d) => d.code === ValidatorDiagCode.UnsupportedTypeReference),
        `expected UnsupportedTypeReference for ${typeName}`
      );
    });
  }

  test("unsupported type name used as variable name does not produce UnsupportedTypeReference", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

const IArguments = 42;

export default Sensor({
  name: "test",
  output: "boolean",
  params: {},
  onExecute(ctx: Context): boolean { return true; },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(!result.diagnostics.some((d) => d.code === ValidatorDiagCode.UnsupportedTypeReference));
  });
});

describe("descriptor extraction", () => {
  test("valid sensor extracts correct descriptor", () => {
    const result = compileUserTile(VALID_SENSOR_SOURCE, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.kind, "sensor");
    assert.equal(result.descriptor.name, "is-close");
    assert.equal(result.descriptor.outputType, "boolean");
    assert.equal(result.descriptor.params.length, 1);
    assert.equal(result.descriptor.params[0].name, "distance");
    assert.equal(result.descriptor.params[0].type, "number");
    assert.equal(result.descriptor.params[0].defaultValue, 5);
    assert.equal(result.descriptor.params[0].required, false);
    assert.equal(result.descriptor.params[0].anonymous, false);
    assert.equal(result.descriptor.execIsAsync, false);
    assert.ok(result.descriptor.onExecuteNode);
    assert.equal(result.descriptor.onPageEnteredNode, null);
  });

  test("actuator with async exec extracts async flag", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "flee",
  params: {
    speed: { type: "number", default: 1 },
  },
  async onExecute(ctx: Context, params: { speed: number }): Promise<void> {
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.kind, "actuator");
    assert.equal(result.descriptor.name, "flee");
    assert.equal(result.descriptor.execIsAsync, true);
    assert.equal(result.descriptor.outputType, undefined);
  });

  test("onPageEntered inside descriptor is detected", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "boolean",
  params: {},
  onExecute(ctx: Context): boolean { return true; },
  onPageEntered(ctx: Context): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.ok(result.descriptor.onPageEnteredNode !== null, "expected onPageEnteredNode to be present");
  });

  test("multiple params are extracted correctly", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "multi-param",
  output: "number",
  params: {
    range: { type: "number", default: 10 },
    label: { type: "string" },
    active: { type: "boolean", default: true },
  },
  onExecute(ctx: Context, params: { range: number; label: string; active: boolean }): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.params.length, 3);

    assert.equal(result.descriptor.params[0].name, "range");
    assert.equal(result.descriptor.params[0].type, "number");
    assert.equal(result.descriptor.params[0].defaultValue, 10);
    assert.equal(result.descriptor.params[0].required, false);
    assert.equal(result.descriptor.params[0].anonymous, false);

    assert.equal(result.descriptor.params[1].name, "label");
    assert.equal(result.descriptor.params[1].type, "string");
    assert.equal(result.descriptor.params[1].required, true);
    assert.equal(result.descriptor.params[1].anonymous, false);

    assert.equal(result.descriptor.params[2].name, "active");
    assert.equal(result.descriptor.params[2].type, "boolean");
    assert.equal(result.descriptor.params[2].defaultValue, true);
    assert.equal(result.descriptor.params[2].required, false);
    assert.equal(result.descriptor.params[2].anonymous, false);
  });

  test("missing name produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  output: "boolean",
  params: {},
  onExecute(ctx: Context): boolean { return true; },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === CompileDiagCode.TypeScriptError));
  });

  test("sensor missing output produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  params: {},
  onExecute(ctx: Context): boolean { return true; },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === CompileDiagCode.TypeScriptError));
  });

  test("missing onExecute produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "boolean",
  params: {},
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === CompileDiagCode.TypeScriptError));
  });

  test("descriptor without onPageEntered has null node", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "boolean",
  params: {},
  onExecute(ctx: Context): boolean { return true; },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.onPageEnteredNode, null);
  });

  test("actuator with no params extracts empty params list", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "simple",
  params: {},
  onExecute(ctx: Context): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.kind, "actuator");
    assert.equal(result.descriptor.params.length, 0);
  });

  test("anonymous param extracts anonymous flag", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "chase",
  params: {
    target: { type: "number", anonymous: true },
    speed: { type: "number", default: 1 },
  },
  onExecute(ctx: Context, params: { target: number; speed: number }): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.params.length, 2);

    assert.equal(result.descriptor.params[0].name, "target");
    assert.equal(result.descriptor.params[0].type, "number");
    assert.equal(result.descriptor.params[0].anonymous, true);
    assert.equal(result.descriptor.params[0].required, true);

    assert.equal(result.descriptor.params[1].name, "speed");
    assert.equal(result.descriptor.params[1].type, "number");
    assert.equal(result.descriptor.params[1].anonymous, false);
    assert.equal(result.descriptor.params[1].required, false);
    assert.equal(result.descriptor.params[1].defaultValue, 1);
  });

  test("omitted params produces empty params list", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "no-params",
  output: "boolean",
  onExecute(ctx: Context): boolean { return true; },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.params.length, 0);
  });
});
