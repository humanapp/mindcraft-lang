import assert from "node:assert/strict";
import { test } from "node:test";

import { BYTECODE_VERSION, type ExecutionContext, Op, type Program } from "@wendoo-lang/core/runtime";

test("runtime barrel re-exports bytecode primitives", () => {
  assert.equal(typeof BYTECODE_VERSION, "number");
  assert.equal(typeof Op.PUSH_CONST_VAL, "number");
  const _typeProbe: Program | undefined = undefined;
  assert.equal(_typeProbe, undefined);
  const _ctxProbe: ExecutionContext | undefined = undefined;
  assert.equal(_ctxProbe, undefined);
});
