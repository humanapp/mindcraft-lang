import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { compileUserTile } from "./compile.js";

let services: BrainServices;

describe("scope and variable metadata", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("function with nested blocks -> correct scope tree", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const x = 1;
    {
      const y = 2;
      {
        const z = 3;
      }
    }
    return x;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const entryDebug = result.functionDebugInfo!.find((f) => f.name === "test.onExecute");
    assert.ok(entryDebug, "expected onExecute function debug info");

    const scopes = entryDebug!.scopes;
    assert.ok(scopes.length >= 3, `expected at least 3 scopes (function + 2 blocks), got ${scopes.length}`);

    const funcScope = scopes.find((s) => s.kind === "function");
    assert.ok(funcScope, "expected a function scope");
    assert.equal(funcScope!.parentScopeId, null, "function scope should have no parent");

    const blockScopes = scopes.filter((s) => s.kind === "block");
    assert.ok(blockScopes.length >= 2, `expected at least 2 block scopes, got ${blockScopes.length}`);

    const outerBlock = blockScopes.find((s) => s.parentScopeId === funcScope!.scopeId);
    assert.ok(outerBlock, "expected outer block to be child of function scope");

    const innerBlock = blockScopes.find((s) => s.parentScopeId === outerBlock!.scopeId);
    assert.ok(innerBlock, "expected inner block to be child of outer block");

    for (const scope of scopes) {
      assert.ok(scope.startPc >= 0, "scope startPc should be >= 0");
      assert.ok(scope.endPc >= scope.startPc, `scope endPc (${scope.endPc}) should be >= startPc (${scope.startPc})`);
    }
  });

  test("variable declared in block -> lifetime matches block PC range", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    let result = 0;
    {
      const inner = 42;
      result = inner;
    }
    return result;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const entryDebug = result.functionDebugInfo!.find((f) => f.name === "test.onExecute");
    assert.ok(entryDebug);

    const innerLocal = entryDebug!.locals.find((l) => l.name === "inner");
    assert.ok(innerLocal, "expected 'inner' local");
    assert.equal(innerLocal!.storageKind, "local");

    const blockScope = entryDebug!.scopes.find((s) => s.scopeId === innerLocal!.scopeId);
    assert.ok(blockScope, "expected block scope for inner variable");
    assert.equal(blockScope!.kind, "block");

    assert.ok(
      innerLocal!.lifetimeStartPc >= blockScope!.startPc,
      `inner lifetimeStartPc (${innerLocal!.lifetimeStartPc}) should be >= block startPc (${blockScope!.startPc})`
    );
    assert.ok(
      innerLocal!.lifetimeEndPc <= blockScope!.endPc,
      `inner lifetimeEndPc (${innerLocal!.lifetimeEndPc}) should be <= block endPc (${blockScope!.endPc})`
    );
  });

  test("parameters have storageKind parameter", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const entryDebug = result.functionDebugInfo!.find((f) => f.name === "test.onExecute");
    assert.ok(entryDebug);

    const ctxParam = entryDebug!.locals.find((l) => l.name === "ctx");
    assert.ok(ctxParam, "expected 'ctx' parameter");
    assert.equal(ctxParam!.storageKind, "parameter");
    assert.equal(ctxParam!.slotIndex, 0);
  });

  test("callsite vars appear in module scope", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let counter = 0;

export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    counter = counter + 1;
    return counter;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const initDebug = result.functionDebugInfo!.find((f) => f.name === "<module-init>");
    assert.ok(initDebug, "expected module init function debug info");
    assert.ok(initDebug!.scopes.length > 0, "expected module init to have scope metadata");

    const funcScope = initDebug!.scopes.find((s) => s.kind === "function");
    assert.ok(funcScope, "expected function scope in module init");
  });

  test("closure captures have storageKind capture", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const x = 10;
    const fn = (y: number): number => x + y;
    return fn(5);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const closureDebug = result.functionDebugInfo!.find((f) => f.name.startsWith("<closure#"));
    assert.ok(closureDebug, "expected closure function debug info");

    const captureLocal = closureDebug!.locals.find((l) => l.storageKind === "capture");
    assert.ok(captureLocal, "expected a capture-kind local in the closure");
    assert.equal(captureLocal!.name, "x");
  });

  test("compiler-generated temporaries are not in locals list", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const items = [10, 20, 30];
    let sum = 0;
    for (const item of items) {
      sum = sum + item;
    }
    return sum;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const entryDebug = result.functionDebugInfo!.find((f) => f.name === "test.onExecute");
    assert.ok(entryDebug);

    const namedLocals = entryDebug!.locals.map((l) => l.name);
    assert.ok(namedLocals.includes("items"), "expected 'items' in locals");
    assert.ok(namedLocals.includes("sum"), "expected 'sum' in locals");
    assert.ok(namedLocals.includes("item"), "expected 'item' in locals");

    for (const local of entryDebug!.locals) {
      assert.ok(local.name.length > 0, "all locals should have a name (no anonymous temporaries)");
      assert.ok(!local.name.startsWith("__"), "locals should not include compiler-generated temporaries");
    }
  });

  test("helper function parameters are tracked", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function add(a: number, b: number): number {
  return a + b;
}

export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    return add(1, 2);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const helperDebug = result.functionDebugInfo!.find((f) => f.name === "add");
    assert.ok(helperDebug, "expected helper function debug info");

    const params = helperDebug!.locals.filter((l) => l.storageKind === "parameter");
    assert.equal(params.length, 2, "expected 2 parameters");
    assert.equal(params[0].name, "a");
    assert.equal(params[1].name, "b");

    const funcScope = helperDebug!.scopes.find((s) => s.kind === "function");
    assert.ok(funcScope, "expected function scope");
    assert.equal(funcScope!.name, "add");
  });

  test("for loop creates a block scope for its variables", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    let sum = 0;
    for (let i = 0; i < 5; i++) {
      sum = sum + i;
    }
    return sum;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const entryDebug = result.functionDebugInfo!.find((f) => f.name === "test.onExecute");
    assert.ok(entryDebug);

    const iLocal = entryDebug!.locals.find((l) => l.name === "i");
    assert.ok(iLocal, "expected 'i' local");
    assert.equal(iLocal!.storageKind, "local");

    const forScope = entryDebug!.scopes.find((s) => s.scopeId === iLocal!.scopeId);
    assert.ok(forScope, "expected scope for for-loop variable");
    assert.equal(forScope!.kind, "block");
  });

  test("for...in creates a block scope for its variables", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const items: number[] = [10, 20, 30];
    let sum = 0;
    for (const key in items) {
      sum = sum + items[key];
    }
    return sum;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const entryDebug = result.functionDebugInfo!.find((f) => f.name === "test.onExecute");
    assert.ok(entryDebug);

    const keyLocal = entryDebug!.locals.find((l) => l.name === "key");
    assert.ok(keyLocal, "expected 'key' local");
    assert.equal(keyLocal!.storageKind, "local");

    const forInScope = entryDebug!.scopes.find((s) => s.scopeId === keyLocal!.scopeId);
    assert.ok(forInScope, "expected scope for for-in loop variable");
    assert.equal(forInScope!.kind, "block");
  });

  test("switch cases share one block scope", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    const x: number = 1;
    switch (x) {
      case 1:
        const a = 10;
        break;
      case 2:
        const b = 20;
        break;
      default:
        break;
    }
    return x;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const entryDebug = result.functionDebugInfo!.find((f) => f.name === "test.onExecute");
    assert.ok(entryDebug);

    const aLocal = entryDebug!.locals.find((l) => l.name === "a");
    const bLocal = entryDebug!.locals.find((l) => l.name === "b");
    assert.ok(aLocal, "expected 'a' local");
    assert.ok(bLocal, "expected 'b' local");
    assert.equal(aLocal!.scopeId, bLocal!.scopeId, "switch case locals should share one scope");

    const switchScope = entryDebug!.scopes.find((s) => s.scopeId === aLocal!.scopeId);
    assert.ok(switchScope, "expected switch scope");
    assert.equal(switchScope!.kind, "block");
  });

  test("scope IDs are unique within a function", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  onExecute(ctx: Context): number {
    {
      const a = 1;
    }
    {
      const b = 2;
    }
    return 0;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const entryDebug = result.functionDebugInfo!.find((f) => f.name === "test.onExecute");
    assert.ok(entryDebug);

    const scopeIds = new Set(entryDebug!.scopes.map((s) => s.scopeId));
    assert.equal(scopeIds.size, entryDebug!.scopes.length, "scope IDs should be unique");
  });

  test("onExecute with params tracks all parameter locals", () => {
    const source = `
import { Actuator, optional, param, type Context } from "mindcraft";

export default Actuator({
  name: "test",
  args: [
    optional(param("speed", { type: "number", default: 5 })),
    optional(param("label", { type: "string", default: "fast" })),
  ],
  onExecute(ctx: Context, args: { speed: number; label: string }): void {
    const doubled = args.speed * 2;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const entryDebug = result.functionDebugInfo!.find((f) => f.name === "test.onExecute");
    assert.ok(entryDebug);

    const params = entryDebug!.locals.filter((l) => l.storageKind === "parameter");
    const paramNames = params.map((p) => p.name);
    assert.ok(paramNames.includes("ctx"), "expected 'ctx' parameter");
    assert.ok(paramNames.includes("speed"), "expected 'speed' parameter");
    assert.ok(paramNames.includes("label"), "expected 'label' parameter");
  });
});
