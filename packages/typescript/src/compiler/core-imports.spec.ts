import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compiler, type FunctionBytecode, Op, type Program, type Value } from "@mindcraft-lang/core/brain";

describe("core brain imports", () => {
  test("Op enum is importable and has expected members", () => {
    assert.equal(typeof Op, "object");
    assert.equal(typeof Op.PUSH_CONST, "number");
    assert.equal(typeof Op.RET, "number");
  });

  test("BytecodeEmitter class is importable", () => {
    assert.equal(typeof compiler.BytecodeEmitter, "function");
  });

  test("ConstantPool class is importable", () => {
    assert.equal(typeof compiler.ConstantPool, "function");
  });
});
