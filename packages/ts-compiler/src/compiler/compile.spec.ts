import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { compileUserTile } from "./compile.js";
import { CompileDiagCode, DescriptorDiagCode, LoweringDiagCode, ValidatorDiagCode } from "./diag-codes.js";
import type { ExtractedOptional, ExtractedParam } from "./types.js";

const VALID_SENSOR_SOURCE = `
import { Sensor, type Context, param, optional } from "mindcraft";

export default Sensor({
  name: "is-close",
  args: [
    optional(param("distance", { type: "number", default: 5 })),
  ],
  onExecute(ctx: Context, args: { distance: number }): boolean {
    return args.distance < 10;
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
  ctx.brain.setVariable(123, "value");
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
    assert.equal(result.descriptor.returnType, "boolean");
    assert.equal(result.descriptor.args.length, 1);
    assert.equal(result.descriptor.args[0].kind, "optional");
    const arg0 = (result.descriptor.args[0] as ExtractedOptional).item as ExtractedParam;
    assert.equal(arg0.kind, "param");
    assert.equal(arg0.name, "distance");
    assert.equal(arg0.type, "number");
    assert.equal(arg0.defaultValue, 5);
    assert.equal(arg0.anonymous, false);
    assert.equal(result.descriptor.execIsAsync, false);
    assert.ok(result.descriptor.onExecuteNode);
    assert.equal(result.descriptor.onPageEnteredNode, null);
  });

  test("actuator with async exec extracts async flag", () => {
    const source = `
import { Actuator, type Context, param, optional } from "mindcraft";

export default Actuator({
  name: "flee",
  args: [
    optional(param("speed", { type: "number", default: 1 })),
  ],
  async onExecute(ctx: Context, args: { speed: number }): Promise<void> {
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.kind, "actuator");
    assert.equal(result.descriptor.name, "flee");
    assert.equal(result.descriptor.execIsAsync, true);
    assert.equal(result.descriptor.returnType, undefined);
  });

  test("onPageEntered inside descriptor is detected", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
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
import { Sensor, type Context, param, optional } from "mindcraft";

export default Sensor({
  name: "multi-param",
  args: [
    optional(param("range", { type: "number", default: 10 })),
    param("label", { type: "string" }),
    optional(param("active", { type: "boolean", default: true })),
  ],
  onExecute(ctx: Context, args: { range: number; label: string; active: boolean }): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.args.length, 3);

    assert.equal(result.descriptor.args[0].kind, "optional");
    const mp0 = (result.descriptor.args[0] as ExtractedOptional).item as ExtractedParam;
    assert.equal(mp0.kind, "param");
    assert.equal(mp0.name, "range");
    assert.equal(mp0.type, "number");
    assert.equal(mp0.defaultValue, 10);
    assert.equal(mp0.anonymous, false);

    assert.equal(result.descriptor.args[1].kind, "param");
    const mp1 = result.descriptor.args[1] as ExtractedParam;
    assert.equal(mp1.name, "label");
    assert.equal(mp1.type, "string");
    assert.equal(mp1.anonymous, false);

    assert.equal(result.descriptor.args[2].kind, "optional");
    const mp2 = (result.descriptor.args[2] as ExtractedOptional).item as ExtractedParam;
    assert.equal(mp2.kind, "param");
    assert.equal(mp2.name, "active");
    assert.equal(mp2.type, "boolean");
    assert.equal(mp2.defaultValue, true);
    assert.equal(mp2.anonymous, false);
  });

  test("missing name produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  onExecute(ctx: Context): boolean { return true; },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === CompileDiagCode.TypeScriptError));
  });

  test("sensor missing return type annotation produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context) { return true; },
});
`;
    const result = compileUserTile(source, { services });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some((d) => d.code === DescriptorDiagCode.SensorReturnTypeRequired));
  });

  test("missing onExecute produces diagnostic", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
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
  onExecute(ctx: Context): boolean { return true; },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.onPageEnteredNode, null);
  });

  test("actuator with no args extracts empty args list", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "simple",
  onExecute(ctx: Context): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.kind, "actuator");
    assert.equal(result.descriptor.args.length, 0);
  });

  test("anonymous param extracts anonymous flag", () => {
    const source = `
import { Actuator, type Context, param, optional } from "mindcraft";

export default Actuator({
  name: "chase",
  args: [
    param("target", { type: "number", anonymous: true }),
    optional(param("speed", { type: "number", default: 1 })),
  ],
  onExecute(ctx: Context, args: { target: number; speed: number }): void {},
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.args.length, 2);

    assert.equal(result.descriptor.args[0].kind, "param");
    const ap0 = result.descriptor.args[0] as ExtractedParam;
    assert.equal(ap0.name, "target");
    assert.equal(ap0.type, "number");
    assert.equal(ap0.anonymous, true);

    assert.equal(result.descriptor.args[1].kind, "optional");
    const ap1 = (result.descriptor.args[1] as ExtractedOptional).item as ExtractedParam;
    assert.equal(ap1.kind, "param");
    assert.equal(ap1.name, "speed");
    assert.equal(ap1.type, "number");
    assert.equal(ap1.anonymous, false);
    assert.equal(ap1.defaultValue, 1);
  });

  test("omitted args produces empty args list", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "no-params",
  onExecute(ctx: Context): boolean { return true; },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.args.length, 0);
  });
});
