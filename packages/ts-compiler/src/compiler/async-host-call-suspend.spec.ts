import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, type ReadonlyList } from "@mindcraft-lang/core";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import type { ExecutionContext } from "@mindcraft-lang/core/runtime";
import { type AsyncHandle, ContextTypeIds, CoreTypeIds, type Value } from "@mindcraft-lang/core/runtime";
import { buildAmbientDeclarations } from "./ambient.js";
import { compileUserTile } from "./compile.js";
import { LoweringDiagCode } from "./diag-codes.js";
import type { CompileDiagnostic } from "./types.js";

let services: BrainServices;

function compile(source: string) {
  const ambientSource = buildAmbientDeclarations(services.runtime.types);
  return compileUserTile(source, {
    ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
    services,
  });
}

/** Returns the source text spanned by a diagnostic whose range is on a single line. */
function spannedText(source: string, diag: CompileDiagnostic): string {
  const line = source.split("\n")[diag.line! - 1];
  return line.slice(diag.column! - 1, diag.endColumn! - 1);
}

describe("async host call in a non-suspendable context", () => {
  before(() => {
    services = __test__createBrainServices();

    const { types, functions } = services.runtime;

    const hasScrollText = (() => {
      const def = types.get(ContextTypeIds.Context);
      const methods = def && "methods" in def ? (def as { methods?: List<{ name: string }> }).methods : undefined;
      return methods?.some((m) => m.name === "scrollText") ?? false;
    })();
    if (!hasScrollText) {
      types.addStructMethods(
        ContextTypeIds.Context,
        List.from([
          {
            name: "scrollText",
            params: List.from([{ name: "text", typeId: CoreTypeIds.String }]),
            returnTypeId: CoreTypeIds.Void,
            isAsync: true,
          },
        ])
      );
    }

    if (!functions.get("Context.scrollText")) {
      functions.register(
        6201,
        "Context.scrollText",
        true,
        { exec: (_ctx: ExecutionContext, _args: ReadonlyList<Value>, _handle: AsyncHandle) => {} },
        { callSpec: { type: "bag", items: [] }, argSlots: List.empty<never>() }
      );
    }
  });

  test("synchronous onExecute calling an async host fn is rejected at the call range", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "sync-scroll",
  onExecute(ctx: Context): void {
    ctx.scrollText("hi");
  },
});
`;
    const result = compile(source);
    const diag = result.diagnostics.find((d) => d.code === LoweringDiagCode.AsyncHostCallInNonSuspendableContext);
    assert.ok(diag, `Expected AsyncHostCallInNonSuspendableContext, got: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(spannedText(source, diag), `ctx.scrollText("hi")`);
    assert.match(diag.message, /`Context\.scrollText` is an async action/);
    assert.match(diag.message, /synchronous `onExecute`/);
    assert.match(diag.message, /Declare `onExecute` as `async`/);
  });

  test("async onExecute awaiting an async host fn is diagnostic-free", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "async-scroll",
  async onExecute(ctx: Context): Promise<void> {
    await ctx.scrollText("hi");
  },
});
`;
    const result = compile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  });

  test("onPageEntered calling an async host fn is rejected", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "page-entered-scroll",
  onPageEntered(ctx: Context): void {
    ctx.scrollText("hi");
  },
  onExecute(ctx: Context): void {},
});
`;
    const result = compile(source);
    const diag = result.diagnostics.find((d) => d.code === LoweringDiagCode.AsyncHostCallInNonSuspendableContext);
    assert.ok(diag, `Expected AsyncHostCallInNonSuspendableContext, got: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(spannedText(source, diag), `ctx.scrollText("hi")`);
    assert.match(diag.message, /cannot be called from `onPageEntered`/);
  });

  test("onPageExited calling an async host fn is rejected", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "page-exited-scroll",
  onPageExited(ctx: Context): void {
    ctx.scrollText("hi");
  },
  onExecute(ctx: Context): void {},
});
`;
    const result = compile(source);
    const diag = result.diagnostics.find((d) => d.code === LoweringDiagCode.AsyncHostCallInNonSuspendableContext);
    assert.ok(diag, `Expected AsyncHostCallInNonSuspendableContext, got: ${JSON.stringify(result.diagnostics)}`);
    assert.match(diag.message, /cannot be called from `onPageExited`/);
  });

  test("`.then` on an async result is rejected even in an async body", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "then-scroll",
  async onExecute(ctx: Context): Promise<void> {
    ctx.scrollText("hi").then(() => {});
  },
});
`;
    const result = compile(source);
    const diag = result.diagnostics.find((d) => d.code === LoweringDiagCode.UnsupportedAsyncResultMethod);
    assert.ok(diag, `Expected UnsupportedAsyncResultMethod, got: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(spannedText(source, diag), `ctx.scrollText("hi").then(() => {})`);
    assert.match(diag.message, /`\.then\(\)` is not supported on an async result\. Use `await`/);
    assert.equal(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.AsyncHostCallInNonSuspendableContext),
      false
    );
  });

  test("`.catch` on an async result is rejected", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "catch-scroll",
  async onExecute(ctx: Context): Promise<void> {
    ctx.scrollText("hi").catch(() => {});
  },
});
`;
    const result = compile(source);
    const diag = result.diagnostics.find((d) => d.code === LoweringDiagCode.UnsupportedAsyncResultMethod);
    assert.ok(diag, `Expected UnsupportedAsyncResultMethod, got: ${JSON.stringify(result.diagnostics)}`);
    assert.match(diag.message, /`\.catch\(\)` is not supported on an async result/);
  });

  test("a discarded async call in an async body warns but still compiles", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "floating-scroll",
  async onExecute(ctx: Context): Promise<void> {
    ctx.scrollText("hi");
  },
});
`;
    const result = compile(source);
    const diag = result.diagnostics.find((d) => d.code === LoweringDiagCode.UnawaitedAsyncCall);
    assert.ok(diag, `Expected UnawaitedAsyncCall, got: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(diag.severity, "warning");
    assert.equal(spannedText(source, diag), `ctx.scrollText("hi")`);
    assert.match(diag.message, /result of async action `Context\.scrollText` is discarded/);
    assert.ok(result.program, "warning must not suppress the program");
  });

  test("awaiting the async call clears the discarded-result warning", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "awaited-scroll",
  async onExecute(ctx: Context): Promise<void> {
    await ctx.scrollText("hi");
  },
});
`;
    const result = compile(source);
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);
  });

  test("a discarded async call in a synchronous body reports only the hard error", () => {
    const source = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "sync-floating-scroll",
  onExecute(ctx: Context): void {
    ctx.scrollText("hi");
  },
});
`;
    const result = compile(source);
    assert.ok(result.diagnostics.some((d) => d.code === LoweringDiagCode.AsyncHostCallInNonSuspendableContext));
    assert.equal(
      result.diagnostics.some((d) => d.code === LoweringDiagCode.UnawaitedAsyncCall),
      false,
      "the floating-result warning is redundant when the call is already a hard error"
    );
  });
});
