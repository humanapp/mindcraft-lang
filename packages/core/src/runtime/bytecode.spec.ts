/**
 * Unit tests for {@link instrOperandMismatch}, the operand-shape validator
 * shared by the bytecode emitter and the binary codec.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { instrOperandMismatch, OPERAND_SCHEMA, Op } from "@wendoo-lang/core/runtime";

describe("instrOperandMismatch", () => {
  test("accepts a schema-shaped instruction for every opcode", () => {
    for (const key of Object.keys(OPERAND_SCHEMA)) {
      const op = Number(key);
      const schema = OPERAND_SCHEMA[op as Op];
      const instr: { op: number; a?: number; b?: number; c?: number } = { op };
      const slots: Array<"a" | "b" | "c"> = ["a", "b", "c"];
      // Fill every required slot; leave a trailing optional slot absent.
      for (let i = 0; i < schema.length; i++) {
        if (!schema[i].optional) {
          instr[slots[i]] = i + 1;
        }
      }
      assert.equal(instrOperandMismatch(instr), undefined, `opcode ${op} should be valid`);
    }
  });

  test("accepts an optional trailing operand present or absent", () => {
    assert.equal(instrOperandMismatch({ op: Op.LIST_NEW, a: 0 }), undefined);
    assert.equal(instrOperandMismatch({ op: Op.LIST_NEW, a: 0, b: 5 }), undefined);
  });

  test("rejects an unknown opcode", () => {
    const reason = instrOperandMismatch({ op: 9999 as Op, a: 1 });
    assert.match(reason ?? "", /unknown opcode 9999/);
  });

  test("rejects operands that are not a contiguous a,b,c prefix", () => {
    assert.match(instrOperandMismatch({ op: Op.POP, b: 1 }) ?? "", /contiguous/);
    assert.match(instrOperandMismatch({ op: Op.CALL, a: 1, c: 3 }) ?? "", /contiguous/);
  });

  test("rejects a missing required operand", () => {
    assert.match(instrOperandMismatch({ op: Op.HOST_CALL, a: 1 }) ?? "", /expects 3\.\.3 operands, got 1/);
  });

  test("rejects an extra operand", () => {
    assert.match(instrOperandMismatch({ op: Op.RET, a: 1 }) ?? "", /expects 0\.\.0 operands, got 1/);
  });
});
