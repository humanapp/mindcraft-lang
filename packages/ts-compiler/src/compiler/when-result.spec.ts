import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, runtime } from "@mindcraft-lang/core";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/runtime";
import { CoreFuncId, HandleTable, NativeType, NIL_VALUE, Op, type Value, VmStatus } from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";
import { compileUserTile } from "./compile.js";
import { CompileDiagCode, DescriptorDiagCode } from "./diag-codes.js";

let services: BrainServices;

function toVmServices(b: BrainServices) {
  return __test__createPlatformServices({ runtime: { functions: b.runtime.functions, types: b.runtime.types } })
    .runtime;
}

/** A standalone execution context with no enclosing rule (currentRuleFuncId undefined). */
function mkCtx(): ExecutionContext {
  return {
    services: __test__createPlatformServices(),
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
  };
}

function mkScheduler(): Scheduler {
  return {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  };
}

const WHEN_RESULT_SENSOR = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "when-result-reader",
  consumesWhenResult: "number",
  onExecute(ctx: Context): number {
    const result = ctx.getWhenResult();
    return typeof result === "number" ? result : -1;
  },
});
`;

describe("ctx.getWhenResult()", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("lowers to a HOST_CALL of Context.getWhenResult with only the receiver argument", () => {
    const compiled = compileUserTile(WHEN_RESULT_SENSOR, { services });
    assert.deepStrictEqual(compiled.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(compiled.diagnostics)}`);
    assert.ok(compiled.program, "expected a compiled program");

    let hostCall: { a?: number; b?: number } | undefined;
    compiled.program!.functions.forEach((fn) => {
      fn.code.forEach((instr) => {
        if (instr.op === Op.HOST_CALL && instr.a === CoreFuncId.ContextGetWhenResult) {
          hostCall = instr;
        }
      });
    });
    assert.ok(hostCall, "expected a HOST_CALL to Context.getWhenResult");
    assert.equal(hostCall.b, 1, "the struct receiver is the only argument (arg 0)");
  });

  test("returns nil when there is no enclosing rule (no WHEN result captured)", () => {
    const compiled = compileUserTile(WHEN_RESULT_SENSOR, { services });
    assert.deepStrictEqual(compiled.diagnostics, []);
    assert.ok(compiled.program);

    const prog = compiled.program!;
    const vm = new runtime.VM(prog, toVmServices(services), { handles: new HandleTable(100) });
    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 1000;
    const runResult = vm.runFiber(fiber, mkScheduler());

    assert.equal(runResult.status, VmStatus.DONE);
    // getWhenResult read nil, so the `typeof number` guard failed and the sensor returned -1.
    assert.ok(runResult.result);
    assert.equal(runResult.result!.t, NativeType.Number);
    assert.equal((runResult.result as { v: number }).v, -1);
  });
});

const READER_WITHOUT_DECLARATION = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "when-reader-undeclared",
  onExecute(ctx: Context): number {
    const result = ctx.getWhenResult();
    return typeof result === "number" ? result : 0;
  },
});
`;

const READER_WITH_DECLARATION = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "when-reader-declared",
  consumesWhenResult: "number",
  onExecute(ctx: Context): number {
    const result = ctx.getWhenResult();
    return typeof result === "number" ? result : 0;
  },
});
`;

const DECLARATION_WITHOUT_READ = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "when-declared-no-read",
  consumesWhenResult: "number",
  onExecute(ctx: Context): number {
    return 7;
  },
});
`;

const ACTUATOR_READER_WITHOUT_DECLARATION = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "when-actuator-undeclared",
  onExecute(ctx: Context): void {
    ctx.getWhenResult();
  },
});
`;

const DECLARATION_UNKNOWN_TYPE = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "when-declared-unknown",
  consumesWhenResult: "no-such-type",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;

const DECLARATION_NOT_NAME_OR_REF = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "when-declared-parenthesized",
  consumesWhenResult: ("number"),
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;

describe("consumesWhenResult declaration", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  function hasCode(diagnostics: readonly { code: number }[], code: number): boolean {
    return diagnostics.some((d) => d.code === code);
  }

  test("warns when getWhenResult is read but consumesWhenResult is not declared", () => {
    const compiled = compileUserTile(READER_WITHOUT_DECLARATION, { services });
    const warning = compiled.diagnostics.find((d) => d.code === CompileDiagCode.WhenResultReadWithoutDeclaration);
    assert.ok(warning, "expected the missing-declaration warning");
    assert.equal(warning.severity, "warning");
    assert.ok(compiled.program, "compilation still succeeds -- the warning does not block it");
  });

  test("warns for an actuator that reads getWhenResult without declaring consumesWhenResult", () => {
    const compiled = compileUserTile(ACTUATOR_READER_WITHOUT_DECLARATION, { services });
    assert.ok(
      hasCode(compiled.diagnostics, CompileDiagCode.WhenResultReadWithoutDeclaration),
      "an undeclared actuator reader must warn too"
    );
  });

  test("does not warn when consumesWhenResult is declared", () => {
    const compiled = compileUserTile(READER_WITH_DECLARATION, { services });
    assert.ok(compiled.program);
    assert.ok(
      !hasCode(compiled.diagnostics, CompileDiagCode.WhenResultReadWithoutDeclaration),
      "a declared reader must not warn"
    );
  });

  test("does not warn when consumesWhenResult is declared but getWhenResult is not read", () => {
    const compiled = compileUserTile(DECLARATION_WITHOUT_READ, { services });
    assert.ok(compiled.program);
    assert.ok(
      !hasCode(compiled.diagnostics, CompileDiagCode.WhenResultReadWithoutDeclaration),
      "a declaration without a read is allowed and must not warn"
    );
  });

  test("errors when consumesWhenResult names a type that does not resolve", () => {
    const compiled = compileUserTile(DECLARATION_UNKNOWN_TYPE, { services });
    const error = compiled.diagnostics.find((d) => d.code === CompileDiagCode.UnresolvedTypeReference);
    assert.ok(error, "expected the unresolved-type-reference error");
    assert.equal(error.severity, "error");
  });

  test("errors when consumesWhenResult is neither a type name string literal nor a type reference", () => {
    const compiled = compileUserTile(DECLARATION_NOT_NAME_OR_REF, { services });
    assert.ok(
      hasCode(compiled.diagnostics, DescriptorDiagCode.ConsumesWhenResultMustBeNameOrRef),
      "a parenthesized value must be rejected precisely"
    );
  });
});
