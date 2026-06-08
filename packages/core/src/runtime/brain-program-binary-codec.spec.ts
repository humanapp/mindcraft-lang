/**
 * Round-trip and conformance tests for the binary `.mcprogram` codec.
 *
 * Covers: profile-rounded lean-normalized round-trip, JSON-vs-binary
 * equivalence, every-opcode instruction round-trip, every-variant value
 * round-trip, f64-on-f32 rejection, var-int overflow, and the diagnostic
 * guards (bad magic, version ceiling, instruction-schema drift, unencodable
 * values).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stream } from "@mindcraft-lang/core";
import {
  type BrainProgramInstructionJson,
  type BrainProgramValueJson,
  binaryProgramByteReport,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromBytes,
  linkedBrainProgramFromJson,
  linkedBrainProgramToBytes,
  linkedBrainProgramToJson,
  MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC,
  mkNativeStructValue,
  NativeType,
  type NumberPrecision,
  OPERAND_SCHEMA,
  Op,
  type OperandSpec,
} from "@mindcraft-lang/core/runtime";

const { MemoryStream, byteArrayFromUint8Array, byteArrayToUint8Array } = stream;

const PROFILE_ID = 7;

// ---- Fixtures ----

/** A representative program exercising functions, all three pools, actions, rules, and pages. */
function sampleProgramJson(): LinkedBrainProgramJson {
  return {
    program: {
      version: 1,
      functions: [
        {
          code: [{ op: Op.WHEN_START }, { op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.WHEN_END, a: -3 }, { op: Op.RET }],
          numParams: 0,
        },
        {
          code: [
            { op: Op.LOAD_LOCAL, a: 0 },
            { op: Op.HOST_CALL, a: 1, b: 1, c: 0 },
            { op: Op.GET_FIELD },
            { op: Op.RET },
          ],
          numParams: 1,
          numLocals: 1,
          injectCtxTypeId: "struct:<Context>",
        },
      ],
      constantPools: {
        numbers: [0, 255, 0.5, -0.25],
        strings: ["microbit", "buttonA", "display"],
        values: [{ t: NativeType.Nil }, { t: NativeType.String, v: "hello" }],
      },
      variableNames: ["score"],
      entryPoint: 0,
      actions: [{ entryFuncId: 1 }],
      ruleFuncIds: [0],
      ruleAncestors: [{ ruleFuncId: 0, parentRuleFuncId: 0 }],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "PAGEID0001",
        pageName: "Unnamed Page",
        rootRuleFuncIds: [0],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: 8 },
          { binding: "bytecode", callSiteId: 1, actionSlot: 0 },
        ],
      },
    ],
  };
}

// ---- Lean normalization (matches the codec's documented invariant) ----

function round(value: number, precision: NumberPrecision): number {
  return precision === "f32" ? Math.fround(value) : value;
}

function normalizeValue(value: BrainProgramValueJson, precision: NumberPrecision): BrainProgramValueJson {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const obj = value as { readonly [key: string]: BrainProgramValueJson };
  switch (obj.t) {
    case NativeType.Number:
      return { t: NativeType.Number, v: round(obj.v as number, precision) };
    case NativeType.List:
      return {
        t: NativeType.List,
        typeId: obj.typeId,
        v: (obj.v as BrainProgramValueJson[]).map((x) => normalizeValue(x, precision)),
      };
    case NativeType.Struct:
      return {
        t: NativeType.Struct,
        typeId: obj.typeId,
        v: ((obj.v ?? []) as BrainProgramValueJson[]).map((x) => normalizeValue(x, precision)),
      };
    case NativeType.Map:
      return {
        t: NativeType.Map,
        typeId: obj.typeId,
        v: (obj.v as { key: string | number; value: BrainProgramValueJson }[]).map((entry) => ({
          key: typeof entry.key === "number" ? round(entry.key, precision) : entry.key,
          value: normalizeValue(entry.value, precision),
        })),
      };
    case NativeType.Function:
      return obj.captures === undefined
        ? value
        : {
            t: NativeType.Function,
            funcId: obj.funcId,
            captures: (obj.captures as BrainProgramValueJson[]).map((x) => normalizeValue(x, precision)),
          };
    default:
      return value;
  }
}

/** Applies the binary codec's documented lean normalizations to a JSON payload. */
function leanNormalize(json: LinkedBrainProgramJson, precision: NumberPrecision): LinkedBrainProgramJson {
  const p = json.program;
  return {
    program: {
      version: p.version,
      functions: p.functions.map((fn) => ({
        code: fn.code.map((instr) => ({ ...instr })),
        numParams: fn.numParams,
        numLocals: fn.numLocals ?? fn.numParams,
        ...(fn.injectCtxTypeId !== undefined ? { injectCtxTypeId: fn.injectCtxTypeId } : {}),
      })),
      constantPools: {
        numbers: p.constantPools.numbers.map((n) => round(n, precision)),
        strings: p.constantPools.strings,
        values: p.constantPools.values.map((v) => normalizeValue(v, precision)),
      },
      variableNames: p.variableNames,
      // entryPoint is dropped.
      ...(p.actions !== undefined ? { actions: p.actions } : {}),
      ...(p.ruleFuncIds !== undefined ? { ruleFuncIds: p.ruleFuncIds } : {}),
      ...(p.ruleAncestors !== undefined ? { ruleAncestors: p.ruleAncestors } : {}),
    },
    pages: json.pages.map((page) => ({ ...page, pageName: "" })),
  };
}

function encodeDecode(json: LinkedBrainProgramJson, precision: NumberPrecision) {
  const program = linkedBrainProgramFromJson(json);
  const bytes = linkedBrainProgramToBytes(program, { profileId: PROFILE_ID, precision });
  return linkedBrainProgramFromBytes(bytes, { precision });
}

// ---- Tests ----

describe("binary .mcprogram codec -- round-trip", () => {
  test("round-trips the profile-rounded, lean-normalized payload (f32)", () => {
    const json = sampleProgramJson();
    const decoded = encodeDecode(json, "f32");
    assert.equal(decoded.profileId, PROFILE_ID);
    assert.deepEqual(linkedBrainProgramToJson(decoded.program), leanNormalize(json, "f32"));
  });

  test("JSON and binary decode to the same program (f32)", () => {
    const json = sampleProgramJson();
    const fromBinary = linkedBrainProgramToJson(encodeDecode(json, "f32").program);
    const fromJson = linkedBrainProgramToJson(linkedBrainProgramFromJson(leanNormalize(json, "f32")));
    assert.deepEqual(fromBinary, fromJson);
  });

  test("round-trips an f64 profile without rounding", () => {
    const json = sampleProgramJson();
    json.program.constantPools.numbers = [0, 255, 0.1, 1e39];
    const decoded = encodeDecode(json, "f64");
    assert.deepEqual(linkedBrainProgramToJson(decoded.program), leanNormalize(json, "f64"));
  });
});

describe("binary .mcprogram codec -- every opcode", () => {
  test("round-trips one instruction per opcode (signed and optional-b cases)", () => {
    const instrs = buildEveryOpcodeInstrs();
    const json: LinkedBrainProgramJson = {
      program: {
        version: 1,
        functions: [{ code: instrs, numParams: 0 }],
        constantPools: { numbers: [], strings: [], values: [] },
        variableNames: [],
      },
      pages: [],
    };
    const decoded = encodeDecode(json, "f32");
    const decodedCode = linkedBrainProgramToJson(decoded.program).program.functions[0].code;
    assert.deepEqual(decodedCode, instrs);
  });
});

function buildEveryOpcodeInstrs(): BrainProgramInstructionJson[] {
  const instrs: BrainProgramInstructionJson[] = [];
  const ops = Object.keys(OPERAND_SCHEMA)
    .map((k) => Number(k))
    .sort((a, b) => a - b);
  for (const op of ops) {
    const schema = OPERAND_SCHEMA[op as Op];
    instrs.push(makeInstr(op, schema, false));
    if (schema.length > 0 && schema[schema.length - 1].optional) {
      instrs.push(makeInstr(op, schema, true));
    }
  }
  return instrs;
}

function makeInstr(op: number, schema: readonly OperandSpec[], includeOptional: boolean): BrainProgramInstructionJson {
  const instr: { op: number; a?: number; b?: number; c?: number } = { op };
  const slots: Array<"a" | "b" | "c"> = ["a", "b", "c"];
  for (let i = 0; i < schema.length; i++) {
    const spec = schema[i];
    if (spec.optional && !includeOptional) {
      continue;
    }
    instr[slots[i]] = spec.encoding === "svar" ? -(i * 2 + 3) : i + 1;
  }
  return instr;
}

describe("binary .mcprogram codec -- every value variant", () => {
  test("round-trips nested containers, both map key kinds, enums, and closures", () => {
    const values: BrainProgramValueJson[] = [
      { t: NativeType.Unknown },
      { t: NativeType.Void },
      { t: NativeType.Nil },
      { t: NativeType.Boolean, v: true },
      { t: NativeType.Boolean, v: false },
      { t: NativeType.Number, v: 42 },
      { t: NativeType.Number, v: -7 },
      { t: NativeType.String, v: "hello" },
      { t: NativeType.Enum, typeId: "enum:Color", v: "Red" },
      {
        t: NativeType.List,
        typeId: "list:number",
        v: [
          { t: NativeType.Number, v: 1 },
          { t: NativeType.Number, v: 2 },
        ],
      },
      {
        t: NativeType.Map,
        typeId: "map:any",
        v: [
          { key: 1, value: { t: NativeType.String, v: "one" } },
          { key: "k", value: { t: NativeType.Number, v: 9 } },
        ],
      },
      {
        t: NativeType.Struct,
        typeId: "struct:Point",
        v: [
          { t: NativeType.Number, v: 3 },
          { t: NativeType.Number, v: 4 },
        ],
      },
      { t: NativeType.Function, funcId: 2 },
      {
        t: NativeType.Function,
        funcId: 3,
        captures: [
          { t: NativeType.Number, v: 5 },
          { t: NativeType.String, v: "cap" },
        ],
      },
      {
        t: NativeType.List,
        typeId: "list:nested",
        v: [
          { t: NativeType.List, typeId: "list:number", v: [{ t: NativeType.Number, v: 1 }] },
          { t: NativeType.Map, typeId: "map:s", v: [{ key: "a", value: { t: NativeType.Nil } }] },
        ],
      },
    ];
    const json: LinkedBrainProgramJson = {
      program: {
        version: 1,
        functions: [],
        constantPools: { numbers: [], strings: [], values },
        variableNames: [],
      },
      pages: [],
    };
    const decoded = encodeDecode(json, "f32");
    const decodedValues = linkedBrainProgramToJson(decoded.program).program.constantPools.values;
    assert.deepEqual(decodedValues, values);
  });
});

describe("binary .mcprogram codec -- numeric precision", () => {
  test("an f32 target rounds literals before encoding (int and float paths)", () => {
    const json: LinkedBrainProgramJson = {
      program: {
        version: 1,
        functions: [],
        constantPools: { numbers: [0.1, 16777217], strings: [], values: [{ t: NativeType.Number, v: 0.1 }] },
        variableNames: [],
      },
      pages: [],
    };
    const decoded = encodeDecode(json, "f32");
    const pools = linkedBrainProgramToJson(decoded.program).program.constantPools;
    assert.equal(pools.numbers[0], Math.fround(0.1));
    assert.equal(pools.numbers[1], 16777216); // Math.fround(16777217) lands on an exact int.
    assert.equal((pools.values[0] as { v: number }).v, Math.fround(0.1));
  });

  test("an f32 reader rejects an f64 numeric entry", () => {
    const json: LinkedBrainProgramJson = {
      program: {
        version: 1,
        functions: [],
        constantPools: { numbers: [0.1], strings: [], values: [] },
        variableNames: [],
      },
      pages: [],
    };
    const program = linkedBrainProgramFromJson(json);
    const bytes = linkedBrainProgramToBytes(program, { profileId: PROFILE_ID, precision: "f64" });
    assert.throws(() => linkedBrainProgramFromBytes(bytes, { precision: "f32" }), /F64_ON_F32_TARGET/);

    const f64 = linkedBrainProgramFromBytes(bytes, { precision: "f64" });
    assert.equal(linkedBrainProgramToJson(f64.program).program.constantPools.numbers[0], 0.1);
  });
});

describe("binary .mcprogram codec -- diagnostics", () => {
  test("rejects a buffer with a bad magic", () => {
    const bytes = linkedBrainProgramToBytes(linkedBrainProgramFromJson(sampleProgramJson()), {
      profileId: PROFILE_ID,
      precision: "f32",
    });
    const u8 = new Uint8Array(byteArrayToUint8Array(bytes) as Uint8Array);
    u8[0] = u8[0] ^ 0xff;
    assert.throws(
      () => linkedBrainProgramFromBytes(byteArrayFromUint8Array(u8), { precision: "f32" }),
      /INVALID_MAGIC/
    );
  });

  test("rejects an envelope version above the reader's maximum", () => {
    const bytes = linkedBrainProgramToBytes(linkedBrainProgramFromJson(sampleProgramJson()), {
      profileId: PROFILE_ID,
      precision: "f32",
    });
    const u8 = new Uint8Array(byteArrayToUint8Array(bytes) as Uint8Array);
    // The format version is the byte immediately after the magic.
    u8[MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC.length] = 99;
    assert.throws(
      () => linkedBrainProgramFromBytes(byteArrayFromUint8Array(u8), { precision: "f32" }),
      /UNSUPPORTED_FORMAT_VERSION/
    );
  });

  test("rejects a variable-length integer that overflows 32 bits", () => {
    const s = new MemoryStream();
    for (let i = 0; i < MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC.length; i++) {
      s.writeRawU8(MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC[i]);
    }
    s.writeRawU8(1); // format version
    // profileId encoded as six continuation-flagged bytes -> overflow on read.
    for (let i = 0; i < 6; i++) {
      s.writeRawU8(0x80);
    }
    s.writeRawU8(0x00);
    assert.throws(() => linkedBrainProgramFromBytes(s.toBytes(), { precision: "f32" }), /varint/);
  });

  test("the encoder rejects an instruction with extra operands", () => {
    const json: LinkedBrainProgramJson = {
      program: {
        version: 1,
        functions: [{ code: [{ op: Op.RET, a: 5 }], numParams: 0 }],
        constantPools: { numbers: [], strings: [], values: [] },
        variableNames: [],
      },
      pages: [],
    };
    assert.throws(
      () => linkedBrainProgramToBytes(linkedBrainProgramFromJson(json), { profileId: PROFILE_ID, precision: "f32" }),
      /INSTRUCTION_SCHEMA_MISMATCH/
    );
  });

  test("the encoder rejects an instruction missing a required operand", () => {
    const json: LinkedBrainProgramJson = {
      program: {
        version: 1,
        functions: [{ code: [{ op: Op.HOST_CALL, a: 1 }], numParams: 0 }],
        constantPools: { numbers: [], strings: [], values: [] },
        variableNames: [],
      },
      pages: [],
    };
    assert.throws(
      () => linkedBrainProgramToBytes(linkedBrainProgramFromJson(json), { profileId: PROFILE_ID, precision: "f32" }),
      /INSTRUCTION_SCHEMA_MISMATCH/
    );
  });

  test("the encoder rejects runtime-only values (handle)", () => {
    const json = {
      program: {
        version: 1,
        functions: [],
        constantPools: { numbers: [], strings: [], values: [{ t: "handle", id: 1 }] },
        variableNames: [],
      },
      pages: [],
    } as unknown as LinkedBrainProgramJson;
    assert.throws(
      () => linkedBrainProgramToBytes(linkedBrainProgramFromJson(json), { profileId: PROFILE_ID, precision: "f32" }),
      /UNENCODABLE_VALUE/
    );
  });

  test("the encoder rejects native-backed struct values", () => {
    const program = linkedBrainProgramFromJson({
      program: {
        version: 1,
        functions: [],
        constantPools: { numbers: [], strings: [], values: [] },
        variableNames: [],
      },
      pages: [],
    });
    program.program.constantPools.values.push(mkNativeStructValue("struct:Native", {}));
    assert.throws(
      () => linkedBrainProgramToBytes(program, { profileId: PROFILE_ID, precision: "f32" }),
      /UNENCODABLE_VALUE/
    );
  });
});

describe("binary .mcprogram codec -- section byte report", () => {
  test("accounts for every byte across magic, envelope, and sections", () => {
    const bytes = linkedBrainProgramToBytes(linkedBrainProgramFromJson(sampleProgramJson()), {
      profileId: PROFILE_ID,
      precision: "f32",
    });
    const report = binaryProgramByteReport(bytes);
    assert.equal(report.totalBytes, bytes.length());

    const tags = report.sections.map((section) => section.tag);
    for (const expected of ["FUNC", "CNUM", "CSTR", "CVAL", "VARS", "ACTS", "RULF", "RANC", "PAGE"]) {
      assert.ok(tags.includes(expected), `expected a ${expected} section`);
    }

    let sum = report.magicBytes + report.headerBytes;
    for (const section of report.sections) {
      sum += section.bodyBytes;
    }
    assert.equal(sum, report.totalBytes);
  });
});
