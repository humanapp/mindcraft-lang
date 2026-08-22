/**
 * Committed golden `.mcprogram` (JSON), `.mcprogram.bin` (binary), and
 * `.mcprogram.dump` (canonical dump) reference vectors for the linked brain
 * program codec.
 *
 * Each fixture pairs a canonical JSON golden with its binary encoding and the
 * canonical program dump of the decoded binary. The JSON golden is the
 * canonical serialization of an authored program; the binary golden is
 * derived from that JSON; the dump golden is derived from the decoded binary.
 * Per fixture the test (1) writes any golden that is missing, (2) asserts all
 * three are byte-stable against a fresh deterministic build, and (3) decodes
 * the binary and asserts it matches the f32-rounded, lean-normalized JSON.
 * The committed files double as portable decode vectors for a
 * separately-built (e.g. C++) VM: such a VM decodes the `.mcprogram.bin` and
 * byte-compares its own canonical dump against the committed
 * `.mcprogram.dump`.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { stream } from "@wendoo/core";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import {
  type BrainProgramTypeEntryJson,
  type BrainProgramValueJson,
  ContextTypeIds,
  CoreTypeAtomId,
  CoreTypeIds,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromBytes,
  linkedBrainProgramFromJson,
  linkedBrainProgramToBytes,
  linkedBrainProgramToCanonicalDump,
  linkedBrainProgramToJson,
  NativeType,
  type NumberPrecision,
  Op,
} from "@wendoo/core/runtime";

const { byteArrayFromUint8Array, byteArrayToUint8Array } = stream;

const PROFILE_ID = 0;
const PRECISION: NumberPrecision = "f32";

/**
 * With `WENDOO_REGENERATE_GOLDENS=1` every golden below is rewritten from
 * the freshly built artifact; otherwise only a missing golden is written and
 * the committed bytes must match.
 */
const REGENERATE_GOLDENS = process.env.WENDOO_REGENERATE_GOLDENS === "1";
const typeRegistry = __test__createBrainServices().runtime.types;

// ---- Fixtures ----

// Static struct field access compiles to id-bearing STRUCT_GET_FIELD / STRUCT_SET_FIELD
// (operand = field id, no interned name), with STRUCT_DEEP_COPY preserving struct
// value-semantics on a write. Only the runtime-keyed GET_FIELD interns a name ("label"),
// so the string pool holds exactly that one entry.
const STRUCT_FIELD_ACCESS: LinkedBrainProgramJson = {
  program: {
    version: 1,
    functions: [
      {
        code: [
          { op: Op.LOAD_LOCAL, a: 0 },
          { op: Op.STRUCT_GET_FIELD, a: 0 },
          { op: Op.STORE_LOCAL, a: 1 },
          { op: Op.LOAD_LOCAL, a: 0 },
          { op: Op.PUSH_CONST_NUM, a: 0 },
          { op: Op.STRUCT_DEEP_COPY },
          { op: Op.STRUCT_SET_FIELD, a: 1 },
          { op: Op.PUSH_CONST_STR, a: 0 },
          { op: Op.GET_FIELD },
          { op: Op.POP },
          { op: Op.RET },
        ],
        numParams: 1,
        numLocals: 2,
        injectCtxTypeIdx: 0,
      },
    ],
    constantPools: { numbers: [1], strings: ["label"], values: [] },
    types: [{ tag: "atom", typeId: ContextTypeIds.Context, atomId: CoreTypeAtomId.Context }],
    variableNames: [],
  },
  pages: [],
};

// A rule-shaped program: a when-gate guarding a do-block, a host-action call, and a
// helper with exception handling. Exercises the boundary/branch opcodes plus the
// rule / page / action / ancestor tables.
const CONTROL_FLOW: LinkedBrainProgramJson = {
  program: {
    version: 1,
    functions: [
      {
        code: [
          { op: Op.WHEN_START },
          { op: Op.LOAD_VAR_SLOT, a: 0 },
          { op: Op.JMP_IF_FALSE, a: 4 },
          { op: Op.DO_START },
          { op: Op.HOST_ACTION_CALL, a: 0, b: 1, c: 0 },
          { op: Op.DO_END },
          { op: Op.WHEN_END, a: -6 },
          { op: Op.RET },
        ],
        numParams: 0,
        numLocals: 0,
      },
      {
        code: [
          { op: Op.TRY, a: 3 },
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.THROW },
          { op: Op.END_TRY },
          { op: Op.RET },
        ],
        numParams: 0,
        numLocals: 0,
      },
    ],
    constantPools: { numbers: [], strings: [], values: [{ t: NativeType.Nil }] },
    variableNames: ["enabled"],
    actions: [{ entryFuncId: 1 }],
    ruleFuncIds: [0],
    ruleAncestors: [{ ruleFuncId: 0, parentRuleFuncId: 0 }],
  },
  pages: [
    {
      pageIndex: 0,
      pageId: "PAGEID0001",
      pageName: "Main Page",
      rootRuleFuncIds: [0],
      actionCallSites: [{ binding: "host", callSiteId: 0, actionId: 0 }],
    },
  ],
};

// Full coverage of the residual value pool: every value variant the codec can carry,
// including nested containers, both map key kinds, an enum, and a capturing closure.
// Type table for the value pool: atom refs, parameterized list/map (with a
// nested list), and program-local struct + enum entries.
const NUMBER_LIST_TYPE_ID = `list:<List<${CoreTypeIds.Number}>>`;
const ANY_MAP_TYPE_ID = `map:<Map<${CoreTypeIds.Any},${CoreTypeIds.Any}>>`;
const POINT_TYPE_ID = "struct:</fixture.ts::Point>";
const COLOR_TYPE_ID = "enum:</fixture.ts::Color>";

const NUMBER_OR_STRING_TYPE_ID = `union:<${CoreTypeIds.Number},${CoreTypeIds.String}>`;
const NULLABLE_NUMBER_TYPE_ID = "number:<number?>";
const NUMBER_TO_NUMBER_TYPE_ID = `function:<Function<(${CoreTypeIds.Number})=>${CoreTypeIds.Number}>>`;

// Exercises every TYPS entry kind: atoms, parameterized list/map, union (in
// canonical sorted member order), function, nullable, and program-local
// struct + enum.
const VALUES_TYPES: readonly BrainProgramTypeEntryJson[] = [
  { tag: "atom", typeId: CoreTypeIds.Number, atomId: CoreTypeAtomId.Number },
  { tag: "atom", typeId: CoreTypeIds.Any, atomId: CoreTypeAtomId.Any },
  { tag: "atom", typeId: CoreTypeIds.String, atomId: CoreTypeAtomId.String },
  { tag: "list", typeId: NUMBER_LIST_TYPE_ID, elem: 0 },
  { tag: "map", typeId: ANY_MAP_TYPE_ID, key: 1, value: 1 },
  { tag: "union", typeId: NUMBER_OR_STRING_TYPE_ID, members: [0, 2] },
  { tag: "function", typeId: NUMBER_TO_NUMBER_TYPE_ID, params: [0], result: 0 },
  { tag: "nullable", typeId: NULLABLE_NUMBER_TYPE_ID, base: 0 },
  {
    tag: "struct",
    typeId: POINT_TYPE_ID,
    name: "/fixture.ts::Point",
    maxFieldId: 1,
    fields: [
      { name: "x", fieldIndex: 0 },
      { name: "y", fieldIndex: 1 },
    ],
  },
  {
    tag: "enum",
    typeId: COLOR_TYPE_ID,
    name: "/fixture.ts::Color",
    symbols: [
      { key: "Red", value: 0 },
      { key: "Green", value: 1 },
    ],
  },
];

const VALUES_POOL: readonly BrainProgramValueJson[] = [
  { t: NativeType.Unknown },
  { t: NativeType.Void },
  { t: NativeType.Nil },
  { t: NativeType.Boolean, v: true },
  { t: NativeType.Boolean, v: false },
  { t: NativeType.Number, v: 42 },
  { t: NativeType.Number, v: -7 },
  { t: NativeType.String, v: "hello" },
  { t: NativeType.Enum, typeId: COLOR_TYPE_ID, v: "Red" },
  {
    t: NativeType.List,
    typeId: NUMBER_LIST_TYPE_ID,
    v: [
      { t: NativeType.Number, v: 1 },
      { t: NativeType.Number, v: 2 },
    ],
  },
  {
    t: NativeType.Map,
    typeId: ANY_MAP_TYPE_ID,
    v: [
      { key: 1, value: { t: NativeType.String, v: "one" } },
      { key: "k", value: { t: NativeType.Number, v: 9 } },
    ],
  },
  {
    t: NativeType.Struct,
    typeId: POINT_TYPE_ID,
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
];

const VALUES_AND_COLLECTIONS: LinkedBrainProgramJson = {
  program: {
    version: 1,
    functions: [
      {
        code: [{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.PUSH_CONST_VAL, a: 13 }, { op: Op.POP }, { op: Op.RET }],
        numParams: 0,
        numLocals: 0,
      },
    ],
    constantPools: { numbers: [], strings: [], values: [...VALUES_POOL] },
    types: [...VALUES_TYPES],
    variableNames: [],
  },
  pages: [],
};

// Buffer program constants: the empty buffer, a single byte, the boundary byte
// values (0/127/128/255), a longer 32-byte run, and a repeated/altered triple
// for content-equality coverage. Buffers carry no typeId, so the type table is
// empty. The constant wire form is a value tag (NativeType.Buffer = 12) then a
// var-uint byte length then that many raw bytes. This fixture is the cross-VM
// decode vector for the buffer value type.
const BUFFER_LONG_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

const BUFFER_VECTORS: LinkedBrainProgramJson = {
  program: {
    version: 1,
    functions: [
      {
        code: [
          { op: Op.PUSH_CONST_VAL, a: 0 },
          { op: Op.POP },
          { op: Op.PUSH_CONST_VAL, a: 1 },
          { op: Op.POP },
          { op: Op.PUSH_CONST_VAL, a: 2 },
          { op: Op.POP },
          { op: Op.PUSH_CONST_VAL, a: 3 },
          { op: Op.POP },
          { op: Op.PUSH_CONST_VAL, a: 4 },
          { op: Op.POP },
          { op: Op.PUSH_CONST_VAL, a: 5 },
          { op: Op.POP },
          { op: Op.PUSH_CONST_VAL, a: 6 },
          { op: Op.POP },
          { op: Op.RET },
        ],
        numParams: 0,
        numLocals: 0,
      },
    ],
    constantPools: {
      numbers: [],
      strings: [],
      values: [
        { t: NativeType.Buffer, v: "" },
        { t: NativeType.Buffer, v: "2a" },
        { t: NativeType.Buffer, v: "007f80ff" },
        { t: NativeType.Buffer, v: BUFFER_LONG_HEX },
        { t: NativeType.Buffer, v: "010203" },
        { t: NativeType.Buffer, v: "010203" },
        { t: NativeType.Buffer, v: "010204" },
      ],
    },
    types: [],
    variableNames: [],
  },
  pages: [],
};

const FIXTURES: ReadonlyArray<{ name: string; program: LinkedBrainProgramJson }> = [
  { name: "struct-field-access", program: STRUCT_FIELD_ACCESS },
  { name: "control-flow", program: CONTROL_FLOW },
  { name: "values-and-collections", program: VALUES_AND_COLLECTIONS },
  { name: "buffer-vectors", program: BUFFER_VECTORS },
];

// ---- Lean normalization (mirrors the binary codec's documented invariant) ----

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

function leanNormalize(json: LinkedBrainProgramJson, precision: NumberPrecision): LinkedBrainProgramJson {
  const p = json.program;
  return {
    program: {
      version: p.version,
      functions: p.functions.map((fn) => ({
        code: fn.code.map((instr) => ({ ...instr })),
        numParams: fn.numParams,
        numLocals: fn.numLocals ?? fn.numParams,
        ...(fn.injectCtxTypeIdx !== undefined ? { injectCtxTypeIdx: fn.injectCtxTypeIdx } : {}),
      })),
      constantPools: {
        numbers: p.constantPools.numbers.map((n) => round(n, precision)),
        strings: p.constantPools.strings,
        values: p.constantPools.values.map((v) => normalizeValue(v, precision)),
      },
      types: p.types ?? [],
      variableNames: p.variableNames,
      ...(p.variableInitValues !== undefined ? { variableInitValues: p.variableInitValues } : {}),
      ...(p.actions !== undefined ? { actions: p.actions } : {}),
      ...(p.ruleFuncIds !== undefined ? { ruleFuncIds: p.ruleFuncIds } : {}),
      ...(p.ruleAncestors !== undefined ? { ruleAncestors: p.ruleAncestors } : {}),
    },
    pages: json.pages.map((page) => ({ ...page, pageName: "" })),
  };
}

// ---- Test ----

function fixturePath(relative: string): string {
  return fileURLToPath(new URL(`./__fixtures__/${relative}`, import.meta.url));
}

for (const fixture of FIXTURES) {
  test(`${fixture.name}: JSON, binary, and dump goldens are reproducible and round-trip`, () => {
    const jsonPath = fixturePath(`${fixture.name}.mcprogram`);
    const binPath = fixturePath(`${fixture.name}.mcprogram.bin`);
    const dumpPath = fixturePath(`${fixture.name}.mcprogram.dump`);

    const canonicalJson = linkedBrainProgramToJson(linkedBrainProgramFromJson(fixture.program));
    const jsonText = `${JSON.stringify(canonicalJson, null, 2)}\n`;
    if (REGENERATE_GOLDENS || !existsSync(jsonPath)) {
      writeFileSync(jsonPath, jsonText);
    }
    const committedJsonText = readFileSync(jsonPath, "utf8");
    assert.equal(committedJsonText, jsonText, `${fixture.name}.mcprogram is not byte-stable`);

    const committedJson = JSON.parse(committedJsonText) as LinkedBrainProgramJson;
    const program = linkedBrainProgramFromJson(committedJson);

    const bytes = linkedBrainProgramToBytes(program, { profileId: PROFILE_ID, precision: PRECISION, typeRegistry });
    const generated = Buffer.from(byteArrayToUint8Array(bytes) as Uint8Array);
    if (REGENERATE_GOLDENS || !existsSync(binPath)) {
      writeFileSync(binPath, generated);
    }
    const committedBin = readFileSync(binPath);
    assert.ok(committedBin.equals(generated), `${fixture.name}.mcprogram.bin is not byte-stable`);

    const decoded = linkedBrainProgramFromBytes(byteArrayFromUint8Array(new Uint8Array(committedBin)), {
      precision: PRECISION,
      typeRegistry,
    });
    assert.equal(decoded.profileId, PROFILE_ID);
    assert.deepEqual(linkedBrainProgramToJson(decoded.program), leanNormalize(committedJson, PRECISION));

    const dumpText = linkedBrainProgramToCanonicalDump(decoded.program, {
      profileId: decoded.profileId,
      precision: PRECISION,
      typeRegistry,
    });
    if (REGENERATE_GOLDENS || !existsSync(dumpPath)) {
      writeFileSync(dumpPath, dumpText);
    }
    const committedDumpText = readFileSync(dumpPath, "utf8");
    assert.equal(committedDumpText, dumpText, `${fixture.name}.mcprogram.dump is not byte-stable`);
  });
}

test("struct-field-access golden: id-based field access interns no field-name strings", () => {
  const json = JSON.parse(readFileSync(fixturePath("struct-field-access.mcprogram"), "utf8")) as LinkedBrainProgramJson;
  // The only interned string is the runtime-keyed GET_FIELD name; STRUCT_GET_FIELD /
  // STRUCT_SET_FIELD address fields by numeric id and intern nothing.
  assert.deepEqual(json.program.constantPools.strings, ["label"]);
});
