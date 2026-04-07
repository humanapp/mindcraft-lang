import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { type BrainServices, registerCoreBrainComponents } from "@mindcraft-lang/core/brain";
import { compileUserTile } from "./compile.js";
import type { DebugSpan } from "./types.js";

let services: BrainServices;

describe("source span tracking", () => {
  before(() => {
    services = registerCoreBrainComponents();
  });

  test("pcToSpanIndex has an entry for every PC", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    const x = 1;
    const y = 2;
    return x + y;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);
    assert.ok(result.functionDebugInfo);

    for (const fdi of result.functionDebugInfo!) {
      const instrCount = result.program!.functions.get(fdi.funcIndex)!.code.size();
      assert.equal(
        fdi.pcToSpanIndex.length,
        instrCount,
        `function '${fdi.name}': pcToSpanIndex length (${fdi.pcToSpanIndex.length}) should match instruction count (${instrCount})`
      );
      for (let pc = 0; pc < instrCount; pc++) {
        const spanIdx = fdi.pcToSpanIndex[pc];
        assert.ok(
          spanIdx >= 0 && spanIdx < fdi.spans.length,
          `function '${fdi.name}': pcToSpanIndex[${pc}] = ${spanIdx} is out of range [0, ${fdi.spans.length})`
        );
      }
    }
  });

  test("statement boundaries are set for expression statements", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    const x = 42;
    return x;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const entryDebug = result.functionDebugInfo!.find((f) => f.name === "test.onExecute");
    assert.ok(entryDebug, "expected onExecute function debug info");
    const boundarySpans = entryDebug!.spans.filter((s) => s.isStatementBoundary);
    assert.ok(boundarySpans.length > 0, "expected at least one statement boundary span");
  });

  test("statement boundaries are set for return statements", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    return 42;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const entryDebug = result.functionDebugInfo!.find((f) => f.name === "test.onExecute");
    assert.ok(entryDebug);
    const boundarySpans = entryDebug!.spans.filter((s) => s.isStatementBoundary);
    assert.ok(boundarySpans.length > 0, "return statement should be a boundary");
  });

  test("statement boundaries are set for if conditions", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    const x = 5;
    if (x > 3) {
      return 1;
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
    const boundarySpans = entryDebug!.spans.filter((s) => s.isStatementBoundary);
    assert.ok(
      boundarySpans.length >= 3,
      `expected at least 3 boundaries (var decl, if, return, return), got ${boundarySpans.length}`
    );
  });

  test("statement boundaries are set for while loop conditions", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    let x = 0;
    while (x < 5) {
      x = x + 1;
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
    const boundarySpans = entryDebug!.spans.filter((s) => s.isStatementBoundary);
    assert.ok(
      boundarySpans.length >= 3,
      `expected boundaries for var decl, while condition, body statement, return; got ${boundarySpans.length}`
    );
  });

  test("statement boundaries are set for break and continue", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    let x = 0;
    while (x < 10) {
      x = x + 1;
      if (x > 5) {
        break;
      }
      continue;
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
    const boundarySpans = entryDebug!.spans.filter((s) => s.isStatementBoundary);
    assert.ok(
      boundarySpans.length >= 5,
      `expected boundaries for var decl, while cond, assignment, if, break, continue, return; got ${boundarySpans.length}`
    );
  });

  test("sub-expression PCs have isStatementBoundary false", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    const x = 1 + 2;
    return x;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const entryDebug = result.functionDebugInfo!.find((f) => f.name === "test.onExecute");
    assert.ok(entryDebug);
    const nonBoundarySpans = entryDebug!.spans.filter((s) => !s.isStatementBoundary);
    assert.ok(nonBoundarySpans.length > 0, "expected at least one non-boundary span for sub-expressions");
  });

  test("spans have valid line and column info", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    return 42;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const entryDebug = result.functionDebugInfo!.find((f) => f.name === "test.onExecute");
    assert.ok(entryDebug);

    for (const span of entryDebug!.spans) {
      assert.ok(span.startLine > 0, `startLine should be positive, got ${span.startLine}`);
      assert.ok(span.startColumn > 0, `startColumn should be positive, got ${span.startColumn}`);
      assert.ok(span.endLine >= span.startLine, "endLine should be >= startLine");
      if (span.endLine === span.startLine) {
        assert.ok(span.endColumn >= span.startColumn, "endColumn should be >= startColumn on same line");
      }
    }
  });

  test("spanId values are unique within a function", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    const a = 1;
    const b = 2;
    const c = a + b;
    return c;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const entryDebug = result.functionDebugInfo!.find((f) => f.name === "test.onExecute");
    assert.ok(entryDebug);

    const ids = new Set(entryDebug!.spans.map((s) => s.spanId));
    assert.equal(ids.size, entryDebug!.spans.length, "spanId values should be unique");
  });

  test("generated functions have span data", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let counter = 0;

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    counter = counter + 1;
    return counter;
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);
    assert.ok(result.functionDebugInfo!.length >= 2, "expected at least 2 functions (onExecute + wrapper/init)");

    for (const fdi of result.functionDebugInfo!) {
      assert.ok(fdi.spans.length > 0, `function '${fdi.name}' should have at least one span`);
      assert.ok(fdi.pcToSpanIndex.length >= 0, `function '${fdi.name}' should have pcToSpanIndex`);
    }
  });

  test("for loop has boundaries for condition", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "number",
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
    const boundarySpans = entryDebug!.spans.filter((s) => s.isStatementBoundary);
    assert.ok(
      boundarySpans.length >= 3,
      `expected boundaries for var decl, for init, for condition, body, return; got ${boundarySpans.length}`
    );
  });

  test("multiple functions each have their own span data", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function helper(x: number): number {
  return x * 2;
}

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    return helper(21);
  },
});
`;
    const result = compileUserTile(source, { services });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.functionDebugInfo);

    const helperDebug = result.functionDebugInfo!.find((f) => f.name === "helper");
    const entryDebug = result.functionDebugInfo!.find((f) => f.name === "test.onExecute");
    assert.ok(helperDebug, "expected helper function debug info");
    assert.ok(entryDebug, "expected onExecute function debug info");
    assert.ok(helperDebug!.spans.length > 0);
    assert.ok(entryDebug!.spans.length > 0);
  });
});
