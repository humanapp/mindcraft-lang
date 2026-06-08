import { Dict } from "../platform/dict";
import { Error } from "../platform/error";
import { List } from "../platform/list";
import { MathOps } from "../platform/math";
import type { IByteArray } from "../platform/stream";
import { MemoryStream } from "../platform/stream";
import { TypeUtils } from "../platform/types";
import type { UniqueSet } from "../platform/uniqueset";
import {
  type BrainProgramConstantPoolsJson,
  type BrainProgramExecutableActionJson,
  type BrainProgramFunctionBytecodeJson,
  type BrainProgramInstructionJson,
  type BrainProgramJson,
  type BrainProgramJsonObject,
  type BrainProgramRuleAncestorJsonEntry,
  type LinkedBrainProgramActionCallSiteJsonEntry,
  type LinkedBrainProgramJson,
  type LinkedBrainProgramPageMetadataJson,
  linkedBrainProgramFromJson,
} from "./brain-program-codec";
import { type Instr, OPERAND_SCHEMA, type OperandSpec } from "./bytecode";
import type { BytecodeExecutableAction } from "./context";
import type { ActionCallSiteEntry, LinkedBrainProgram, PageMetadata } from "./host-bindings";
import type { Program } from "./program";
import { MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC } from "./program-image";
import { NativeType } from "./type-defs";
import type { Value } from "./value";

/**
 * Target numeric precision the binary `.mcprogram` is built for. Constant
 * literals are rounded to this precision before encoding (`f32` via
 * {@link MathOps.fround}; `f64` is identity); an `f32` decoder rejects an `f64`
 * numeric entry.
 */
export type NumberPrecision = "f32" | "f64";

/** Options controlling {@link linkedBrainProgramToBytes}. */
export interface LinkedBrainProgramToBytesOptions {
  /** Numeric device-profile id written verbatim into the binary envelope header. */
  readonly profileId: number;

  /** Target numeric precision; constant numbers are rounded to it before encoding. */
  readonly precision: NumberPrecision;
}

/** Options controlling {@link linkedBrainProgramFromBytes}. */
export interface LinkedBrainProgramFromBytesOptions {
  /**
   * Target numeric precision of the decoding device. An `f32` reader rejects an
   * `f64` numeric entry (CNUM discriminant `2`) with a stable diagnostic.
   */
  readonly precision: NumberPrecision;

  /**
   * Maximum supported envelope/format version. A binary whose format version
   * exceeds this is rejected. Defaults to {@link BINARY_PROGRAM_FORMAT_VERSION}.
   */
  readonly maxFormatVersion?: number;
}

/** Decoded binary `.mcprogram` envelope. */
export interface LinkedBrainProgramFromBytesResult {
  /** Numeric device-profile id read from the binary envelope header. */
  readonly profileId: number;

  /** Linked brain program hydrated from the binary payload. */
  readonly program: LinkedBrainProgram;
}

/** Stable machine-readable diagnostic codes for binary `.mcprogram` decode/encode failures. */
export const BrainProgramBinaryCodecErrorCode = {
  /** The leading bytes are not the binary `.mcprogram` magic. */
  INVALID_MAGIC: "MINDCRAFT_BINARY_CODEC_INVALID_MAGIC",
  /** The envelope format version exceeds the reader's maximum. */
  UNSUPPORTED_FORMAT_VERSION: "MINDCRAFT_BINARY_CODEC_UNSUPPORTED_FORMAT_VERSION",
  /** An f64 numeric entry was found while decoding for an f32 target. */
  F64_ON_F32_TARGET: "MINDCRAFT_BINARY_CODEC_F64_ON_F32_TARGET",
  /** A CNUM discriminant byte is not one of `0`/`1`/`2`. */
  INVALID_NUMBER_DISCRIMINANT: "MINDCRAFT_BINARY_CODEC_INVALID_NUMBER_DISCRIMINANT",
  /** A value tag byte is not a serializable {@link NativeType}. */
  INVALID_VALUE_TAG: "MINDCRAFT_BINARY_CODEC_INVALID_VALUE_TAG",
  /** A runtime-only or native-backed value was passed to the encoder. */
  UNENCODABLE_VALUE: "MINDCRAFT_BINARY_CODEC_UNENCODABLE_VALUE",
  /** An opcode byte has no operand-schema entry. */
  UNKNOWN_OPCODE: "MINDCRAFT_BINARY_CODEC_UNKNOWN_OPCODE",
  /** An instruction's operands do not match its opcode's operand schema. */
  INSTRUCTION_SCHEMA_MISMATCH: "MINDCRAFT_BINARY_CODEC_INSTRUCTION_SCHEMA_MISMATCH",
  /** A profile id outside the unsigned 32-bit range was supplied to the encoder. */
  INVALID_PROFILE_ID: "MINDCRAFT_BINARY_CODEC_INVALID_PROFILE_ID",
} as const;

/** Union of all {@link BrainProgramBinaryCodecErrorCode} values. */
export type BrainProgramBinaryCodecErrorCode =
  (typeof BrainProgramBinaryCodecErrorCode)[keyof typeof BrainProgramBinaryCodecErrorCode];

/** Current binary `.mcprogram` envelope/format version. */
export const BINARY_PROGRAM_FORMAT_VERSION = 1;

/** The file magic identifying a binary `.mcprogram`, as a cross-platform list of bytes. */
const MAGIC = List.from(MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC as readonly number[]);

const I32_MIN = -2147483648;
const I32_MAX = 2147483647;

const NUMBER_DISCRIMINANT_SMALL_INT = 0;
const NUMBER_DISCRIMINANT_F32 = 1;
const NUMBER_DISCRIMINANT_F64 = 2;

const MAP_KEY_TAG_NUMBER = 0;
const MAP_KEY_TAG_STRING = 1;

const CALL_SITE_BINDING_HOST = 0;
const CALL_SITE_BINDING_BYTECODE = 1;

const ACTION_FLAG_INITIALIZER = 1;
const ACTION_FLAG_ACTIVATION = 2;
const ACTION_FLAG_DEACTIVATION = 4;

// Presence-bitmask bits for the optional sections. A set bit means the
// corresponding program field is present (possibly empty); a clear bit
// hydrates `undefined`.
const PRESENCE_ACTS = 1;
const PRESENCE_RULF = 2;
const PRESENCE_RANC = 4;

function codecError(code: BrainProgramBinaryCodecErrorCode, message: string): Error {
  return new Error(`[${code}] ${message}`);
}

///////////////////////////
// String interning
///////////////////////////

/**
 * The single program-wide string table (`CSTR`). The first
 * {@link constStringCount} entries are exactly `constantPools.strings` (opcode
 * string/typeId operands index `0..N-1` unchanged); every other string
 * reference (function `injectCtxTypeId`, page ids, variable names, and value
 * typeIds / enum symbols / `String` values) is interned and deduped into the
 * same table, with new entries appended at `>= N`.
 */
class StringInterner {
  readonly strings = List.empty<string>();
  readonly constStringCount: number;
  private readonly index = new Dict<string, number>();

  constructor(poolStrings: List<string>) {
    for (let i = 0; i < poolStrings.size(); i++) {
      const value = poolStrings.get(i);
      const idx = this.strings.size();
      this.strings.push(value);
      if (!this.index.has(value)) {
        this.index.set(value, idx);
      }
    }
    this.constStringCount = this.strings.size();
  }

  intern(value: string): number {
    const existing = this.index.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const idx = this.strings.size();
    this.strings.push(value);
    this.index.set(value, idx);
    return idx;
  }
}

function buildStringInterner(linked: LinkedBrainProgram): StringInterner {
  const program = linked.program;
  const interner = new StringInterner(program.constantPools.strings);

  const functions = program.functions;
  for (let i = 0; i < functions.size(); i++) {
    const injectCtxTypeId = functions.get(i).injectCtxTypeId;
    if (injectCtxTypeId !== undefined) {
      interner.intern(injectCtxTypeId);
    }
  }

  const values = program.constantPools.values;
  for (let i = 0; i < values.size(); i++) {
    internValueStrings(values.get(i), interner);
  }

  const variableNames = program.variableNames;
  for (let i = 0; i < variableNames.size(); i++) {
    interner.intern(variableNames.get(i));
  }

  const pages = linked.pages;
  for (let i = 0; i < pages.size(); i++) {
    interner.intern(pages.get(i).pageId);
  }

  return interner;
}

function internValueStrings(value: Value, interner: StringInterner): void {
  if (value.t === NativeType.String) {
    interner.intern(value.v);
  } else if (value.t === NativeType.Enum) {
    interner.intern(value.typeId);
    interner.intern(value.v);
  } else if (value.t === NativeType.List) {
    interner.intern(value.typeId);
    for (let i = 0; i < value.v.size(); i++) {
      internValueStrings(value.v.get(i), interner);
    }
  } else if (value.t === NativeType.Map) {
    interner.intern(value.typeId);
    const entries = value.v.entries();
    for (let i = 0; i < entries.size(); i++) {
      const entry = entries.get(i);
      if (TypeUtils.isString(entry[0])) {
        interner.intern(entry[0]);
      }
      internValueStrings(entry[1], interner);
    }
  } else if (value.t === NativeType.Struct) {
    interner.intern(value.typeId);
    if (value.v !== undefined) {
      for (let i = 0; i < value.v.size(); i++) {
        internValueStrings(value.v.get(i), interner);
      }
    }
  } else if (value.t === NativeType.Function && value.captures !== undefined) {
    for (let i = 0; i < value.captures.size(); i++) {
      internValueStrings(value.captures.get(i), interner);
    }
  }
}

///////////////////////////
// Encode
///////////////////////////

/**
 * Serializes a linked brain program to the binary `.mcprogram` form: a 2-byte
 * magic, a 1-byte format version, the numeric profile id, a 1-byte presence
 * bitmask, then the positional sections `CSTR`, `CNUM`, `CVAL`, `FUNC`, `VARS`,
 * the present optional sections (`ACTS`, `RULF`, `RANC`), and `PAGE`. Sections
 * carry no tags or lengths; each is self-delimiting by its leading count.
 *
 * Drops `name`, `maxStackDepth`, `ruleIndex`, `entryPoint`, and `pageName`.
 * Numbers are rounded to the target profile precision; `handle`, `err`, and
 * native-backed struct values are rejected.
 *
 * @param program - Linked brain program to serialize.
 * @param options - Numeric profile id and target precision.
 */
export function linkedBrainProgramToBytes(
  program: LinkedBrainProgram,
  options: LinkedBrainProgramToBytesOptions
): IByteArray {
  if (!isU32(options.profileId)) {
    throw codecError(
      BrainProgramBinaryCodecErrorCode.INVALID_PROFILE_ID,
      `profileId must be an unsigned 32-bit integer; got ${options.profileId}`
    );
  }

  const interner = buildStringInterner(program);
  const precision = options.precision;
  const linkedProgram = program.program;

  let presence = 0;
  if (linkedProgram.actions !== undefined) presence |= PRESENCE_ACTS;
  if (linkedProgram.ruleFuncIds !== undefined) presence |= PRESENCE_RULF;
  if (linkedProgram.ruleAncestors !== undefined) presence |= PRESENCE_RANC;

  const s = new MemoryStream();
  for (let i = 0; i < MAGIC.size(); i++) {
    s.writeRawU8(MAGIC.get(i));
  }
  s.writeRawU8(BINARY_PROGRAM_FORMAT_VERSION);
  s.writeVarUint(options.profileId);
  s.writeRawU8(presence);

  // CSTR is written first; every later section resolves string indices against it.
  writeCstrSection(s, interner);
  writeCnumSection(s, linkedProgram.constantPools.numbers, precision);
  writeCvalSection(s, linkedProgram.constantPools.values, interner, precision);
  writeFuncSection(s, linkedProgram, interner);
  writeVarsSection(s, linkedProgram.variableNames, interner);
  if (linkedProgram.actions !== undefined) {
    writeActsSection(s, linkedProgram.actions);
  }
  if (linkedProgram.ruleFuncIds !== undefined) {
    writeRulfSection(s, linkedProgram.ruleFuncIds);
  }
  if (linkedProgram.ruleAncestors !== undefined) {
    writeRancSection(s, linkedProgram.ruleAncestors);
  }
  writePageSection(s, program.pages, interner);
  return s.toBytes();
}

function writeFuncSection(s: MemoryStream, program: Program, interner: StringInterner): void {
  const functions = program.functions;
  s.writeVarUint(functions.size());
  for (let i = 0; i < functions.size(); i++) {
    const fn = functions.get(i);
    s.writeVarUint(fn.numParams);
    const numLocals = fn.numLocals ?? fn.numParams;
    const extraLocals = numLocals - fn.numParams;
    if (extraLocals < 0) {
      throw codecError(
        BrainProgramBinaryCodecErrorCode.INSTRUCTION_SCHEMA_MISMATCH,
        `numLocals (${numLocals}) < numParams (${fn.numParams})`
      );
    }
    s.writeVarUint(extraLocals);
    s.writeVarUint(fn.injectCtxTypeId === undefined ? 0 : interner.intern(fn.injectCtxTypeId) + 1);
    const code = fn.code;
    s.writeVarUint(code.size());
    for (let j = 0; j < code.size(); j++) {
      writeInstruction(s, code.get(j));
    }
  }
}

function writeInstruction(s: MemoryStream, instr: Instr): void {
  const schema = operandSchemaFor(instr.op);
  s.writeRawU8(instr.op);

  const defined = definedOperandCount(instr);
  const required = requiredOperandCount(schema);
  if (defined < required || defined > schema.size()) {
    throw codecError(
      BrainProgramBinaryCodecErrorCode.INSTRUCTION_SCHEMA_MISMATCH,
      `opcode ${instr.op} expects ${required}..${schema.size()} operands, got ${defined}`
    );
  }

  for (let i = 0; i < schema.size(); i++) {
    const spec = schema.get(i);
    const operand = operandAt(instr, i);
    if (spec.optional) {
      s.writeVarUint(operand === undefined ? 0 : operand + 1);
    } else if (spec.encoding === "svar") {
      s.writeVarInt(operand as number);
    } else {
      s.writeVarUint(operand as number);
    }
  }
}

function writeCnumSection(s: MemoryStream, numbers: List<number>, precision: NumberPrecision): void {
  s.writeVarUint(numbers.size());
  for (let i = 0; i < numbers.size(); i++) {
    writeNumberEntry(s, numbers.get(i), precision);
  }
}

function writeNumberEntry(s: MemoryStream, n: number, precision: NumberPrecision): void {
  const rounded = precision === "f32" ? MathOps.fround(n) : n;
  if (isSmallInt(rounded)) {
    s.writeRawU8(NUMBER_DISCRIMINANT_SMALL_INT);
    s.writeVarInt(rounded);
  } else if (precision === "f32") {
    s.writeRawU8(NUMBER_DISCRIMINANT_F32);
    s.writeRawF32(rounded);
  } else {
    s.writeRawU8(NUMBER_DISCRIMINANT_F64);
    s.writeRawF64(rounded);
  }
}

function writeCstrSection(s: MemoryStream, interner: StringInterner): void {
  s.writeVarUint(interner.strings.size());
  s.writeVarUint(interner.constStringCount);
  for (let i = 0; i < interner.strings.size(); i++) {
    s.writeVarString(interner.strings.get(i));
  }
}

function writeCvalSection(
  s: MemoryStream,
  values: List<Value>,
  interner: StringInterner,
  precision: NumberPrecision
): void {
  s.writeVarUint(values.size());
  for (let i = 0; i < values.size(); i++) {
    writeValue(s, values.get(i), interner, precision);
  }
}

function writeValue(s: MemoryStream, value: Value, interner: StringInterner, precision: NumberPrecision): void {
  if (value.t === "handle" || value.t === "err") {
    throw codecError(
      BrainProgramBinaryCodecErrorCode.UNENCODABLE_VALUE,
      `runtime-only value '${value.t}' cannot be serialized`
    );
  }
  writeValueTag(s, value.t);
  switch (value.t) {
    case NativeType.Unknown:
    case NativeType.Void:
    case NativeType.Nil:
      return;
    case NativeType.Boolean:
      s.writeRawU8(value.v ? 1 : 0);
      return;
    case NativeType.Number:
      writeNumberEntry(s, value.v, precision);
      return;
    case NativeType.String:
      s.writeVarUint(interner.intern(value.v));
      return;
    case NativeType.Enum:
      s.writeVarUint(interner.intern(value.typeId));
      s.writeVarUint(interner.intern(value.v));
      return;
    case NativeType.List: {
      s.writeVarUint(interner.intern(value.typeId));
      s.writeVarUint(value.v.size());
      for (let i = 0; i < value.v.size(); i++) {
        writeValue(s, value.v.get(i), interner, precision);
      }
      return;
    }
    case NativeType.Map: {
      s.writeVarUint(interner.intern(value.typeId));
      const entries = value.v.entries();
      s.writeVarUint(entries.size());
      for (let i = 0; i < entries.size(); i++) {
        const entry = entries.get(i);
        const key = entry[0];
        if (TypeUtils.isNumber(key)) {
          s.writeRawU8(MAP_KEY_TAG_NUMBER);
          writeNumberEntry(s, key, precision);
        } else {
          s.writeRawU8(MAP_KEY_TAG_STRING);
          s.writeVarUint(interner.intern(key));
        }
        writeValue(s, entry[1], interner, precision);
      }
      return;
    }
    case NativeType.Struct: {
      if (value.native !== undefined) {
        throw codecError(
          BrainProgramBinaryCodecErrorCode.UNENCODABLE_VALUE,
          "native-backed struct values cannot be serialized"
        );
      }
      s.writeVarUint(interner.intern(value.typeId));
      const fields = value.v;
      const fieldCount = fields === undefined ? 0 : fields.size();
      s.writeVarUint(fieldCount);
      if (fields !== undefined) {
        for (let i = 0; i < fields.size(); i++) {
          writeValue(s, fields.get(i), interner, precision);
        }
      }
      return;
    }
    case NativeType.Function: {
      s.writeVarUint(value.funcId);
      if (value.captures === undefined) {
        s.writeVarUint(0);
      } else {
        s.writeVarUint(value.captures.size() + 1);
        for (let i = 0; i < value.captures.size(); i++) {
          writeValue(s, value.captures.get(i), interner, precision);
        }
      }
      return;
    }
    default:
      // Unreachable: Any/Union are type tags, never runtime values.
      throw codecError(BrainProgramBinaryCodecErrorCode.UNENCODABLE_VALUE, "value is not a serializable NativeType");
  }
}

function writeVarsSection(s: MemoryStream, variableNames: List<string>, interner: StringInterner): void {
  s.writeVarUint(variableNames.size());
  for (let i = 0; i < variableNames.size(); i++) {
    s.writeVarUint(interner.intern(variableNames.get(i)));
  }
}

function writeActsSection(s: MemoryStream, actions: List<BytecodeExecutableAction>): void {
  s.writeVarUint(actions.size());
  for (let i = 0; i < actions.size(); i++) {
    const action = actions.get(i);
    let flags = 0;
    if (action.initializerFuncId !== undefined) flags |= ACTION_FLAG_INITIALIZER;
    if (action.activationFuncId !== undefined) flags |= ACTION_FLAG_ACTIVATION;
    if (action.deactivationFuncId !== undefined) flags |= ACTION_FLAG_DEACTIVATION;
    s.writeRawU8(flags);
    s.writeVarUint(action.entryFuncId);
    if (action.initializerFuncId !== undefined) s.writeVarUint(action.initializerFuncId);
    if (action.activationFuncId !== undefined) s.writeVarUint(action.activationFuncId);
    if (action.deactivationFuncId !== undefined) s.writeVarUint(action.deactivationFuncId);
  }
}

function writeRulfSection(s: MemoryStream, ruleFuncIds: UniqueSet<number>): void {
  const ids = ruleFuncIds.toArray();
  s.writeVarUint(ruleFuncIds.size());
  for (let i = 0; i < ruleFuncIds.size(); i++) {
    s.writeVarUint(ids[i]);
  }
}

function writeRancSection(s: MemoryStream, ruleAncestors: Dict<number, number>): void {
  const entries = ruleAncestors.entries();
  s.writeVarUint(entries.size());
  for (let i = 0; i < entries.size(); i++) {
    const entry = entries.get(i);
    s.writeVarUint(entry[0]);
    s.writeVarUint(entry[1]);
  }
}

function writePageSection(s: MemoryStream, pages: List<PageMetadata>, interner: StringInterner): void {
  s.writeVarUint(pages.size());
  for (let i = 0; i < pages.size(); i++) {
    const page = pages.get(i);
    s.writeVarUint(page.pageIndex);
    s.writeVarUint(interner.intern(page.pageId));

    const roots = page.rootRuleFuncIds;
    s.writeVarUint(roots.size());
    for (let r = 0; r < roots.size(); r++) {
      s.writeVarUint(roots.get(r));
    }

    const callSites = page.actionCallSites;
    s.writeVarUint(callSites.size());
    for (let c = 0; c < callSites.size(); c++) {
      writeActionCallSite(s, callSites.get(c));
    }
  }
}

function writeActionCallSite(s: MemoryStream, callSite: ActionCallSiteEntry): void {
  if (callSite.binding === "host") {
    s.writeRawU8(CALL_SITE_BINDING_HOST);
    s.writeVarUint(callSite.callSiteId);
    s.writeVarUint(callSite.actionId);
  } else {
    s.writeRawU8(CALL_SITE_BINDING_BYTECODE);
    s.writeVarUint(callSite.callSiteId);
    s.writeVarUint(callSite.actionSlot);
  }
}

///////////////////////////
// Decode
///////////////////////////

/**
 * Deserializes a binary `.mcprogram` produced by {@link linkedBrainProgramToBytes}
 * back into a linked brain program plus its numeric profile id.
 *
 * @param bytes - Binary `.mcprogram` payload.
 * @param options - Target precision and optional max format version.
 */
export function linkedBrainProgramFromBytes(
  bytes: IByteArray,
  options: LinkedBrainProgramFromBytesOptions
): LinkedBrainProgramFromBytesResult {
  const precision = options.precision;
  const maxFormatVersion = options.maxFormatVersion ?? BINARY_PROGRAM_FORMAT_VERSION;
  const s = new MemoryStream(bytes);

  for (let i = 0; i < MAGIC.size(); i++) {
    if (s.readRawU8() !== MAGIC.get(i)) {
      throw codecError(BrainProgramBinaryCodecErrorCode.INVALID_MAGIC, "not a binary .mcprogram (bad magic)");
    }
  }

  const formatVersion = s.readRawU8();
  if (formatVersion > maxFormatVersion) {
    throw codecError(
      BrainProgramBinaryCodecErrorCode.UNSUPPORTED_FORMAT_VERSION,
      `format version ${formatVersion} exceeds reader max ${maxFormatVersion}`
    );
  }
  const profileId = s.readVarUint();
  const presence = s.readRawU8();

  // CSTR is read first; every later section resolves string indices against it.
  const strings = readCstrSection(s);
  const numbers = readCnumSection(s, precision);
  const values = readCvalSection(s, strings, precision);
  const functions = readFuncSection(s, strings);
  const variableNames = readVarsSection(s, strings);
  const actions = (presence & PRESENCE_ACTS) !== 0 ? readActsSection(s) : undefined;
  const ruleFuncIds = (presence & PRESENCE_RULF) !== 0 ? readRulfSection(s) : undefined;
  const ruleAncestors = (presence & PRESENCE_RANC) !== 0 ? readRancSection(s) : undefined;
  const pages = readPageSection(s, strings);

  const constantPools: BrainProgramConstantPoolsJson = {
    numbers,
    strings: strings.constStrings(),
    values,
  };
  const programJson: BrainProgramJson = {
    version: 1,
    functions,
    constantPools,
    variableNames,
    ...(actions !== undefined ? { actions } : {}),
    ...(ruleFuncIds !== undefined ? { ruleFuncIds } : {}),
    ...(ruleAncestors !== undefined ? { ruleAncestors } : {}),
  };
  const linkedJson: LinkedBrainProgramJson = { program: programJson, pages };
  return { profileId, program: linkedBrainProgramFromJson(linkedJson) };
}

/** Full string table plus a `constStrings()` view onto the `constantPools.strings` prefix. */
class StringTable {
  constructor(
    private readonly all: List<string>,
    readonly constStringCount: number
  ) {}

  get(index: number): string {
    if (index < 0 || index >= this.all.size()) {
      throw codecError(
        BrainProgramBinaryCodecErrorCode.INVALID_VALUE_TAG,
        `string index ${index} out of range (size ${this.all.size()})`
      );
    }
    return this.all.get(index);
  }

  /** Returns the `constantPools.strings` prefix as a fresh array. */
  constStrings(): string[] {
    return this.all.slice(0, this.constStringCount).toArray();
  }
}

function readCstrSection(s: MemoryStream): StringTable {
  const total = s.readVarUint();
  const constStringCount = s.readVarUint();
  const all = List.empty<string>();
  for (let i = 0; i < total; i++) {
    all.push(s.readVarString());
  }
  return new StringTable(all, constStringCount);
}

function readFuncSection(s: MemoryStream, strings: StringTable): BrainProgramFunctionBytecodeJson[] {
  const count = s.readVarUint();
  const functions: BrainProgramFunctionBytecodeJson[] = [];
  for (let i = 0; i < count; i++) {
    const numParams = s.readVarUint();
    const extraLocals = s.readVarUint();
    const injectCtxId = s.readVarUint();
    const instrCount = s.readVarUint();
    const code: BrainProgramInstructionJson[] = [];
    for (let j = 0; j < instrCount; j++) {
      code.push(readInstruction(s));
    }
    functions.push({
      code,
      numParams,
      numLocals: numParams + extraLocals,
      ...(injectCtxId === 0 ? {} : { injectCtxTypeId: strings.get(injectCtxId - 1) }),
    });
  }
  return functions;
}

function readInstruction(s: MemoryStream): BrainProgramInstructionJson {
  const op = s.readRawU8();
  const schema = operandSchemaFor(op);
  const instr: { op: number; a?: number; b?: number; c?: number } = { op };
  for (let i = 0; i < schema.size(); i++) {
    const spec = schema.get(i);
    if (spec.optional) {
      const sentinel = s.readVarUint();
      if (sentinel !== 0) {
        setOperandAt(instr, i, sentinel - 1);
      }
    } else {
      setOperandAt(instr, i, spec.encoding === "svar" ? s.readVarInt() : s.readVarUint());
    }
  }
  return instr;
}

function readCnumSection(s: MemoryStream, precision: NumberPrecision): number[] {
  const count = s.readVarUint();
  const numbers: number[] = [];
  for (let i = 0; i < count; i++) {
    numbers.push(readNumberEntry(s, precision));
  }
  return numbers;
}

function readNumberEntry(s: MemoryStream, precision: NumberPrecision): number {
  const discriminant = s.readRawU8();
  if (discriminant === NUMBER_DISCRIMINANT_SMALL_INT) {
    return s.readVarInt();
  }
  if (discriminant === NUMBER_DISCRIMINANT_F32) {
    return s.readRawF32();
  }
  if (discriminant === NUMBER_DISCRIMINANT_F64) {
    if (precision === "f32") {
      throw codecError(
        BrainProgramBinaryCodecErrorCode.F64_ON_F32_TARGET,
        "f64 numeric entry is not allowed on an f32 target"
      );
    }
    return s.readRawF64();
  }
  throw codecError(
    BrainProgramBinaryCodecErrorCode.INVALID_NUMBER_DISCRIMINANT,
    `invalid CNUM discriminant ${discriminant}`
  );
}

function readCvalSection(s: MemoryStream, strings: StringTable, precision: NumberPrecision): BrainProgramJsonObject[] {
  const count = s.readVarUint();
  const values: BrainProgramJsonObject[] = [];
  for (let i = 0; i < count; i++) {
    values.push(readValue(s, strings, precision));
  }
  return values;
}

function readValue(s: MemoryStream, strings: StringTable, precision: NumberPrecision): BrainProgramJsonObject {
  const tag = readValueTag(s);
  switch (tag) {
    case NativeType.Unknown:
      return { t: NativeType.Unknown };
    case NativeType.Void:
      return { t: NativeType.Void };
    case NativeType.Nil:
      return { t: NativeType.Nil };
    case NativeType.Boolean:
      return { t: NativeType.Boolean, v: s.readRawU8() !== 0 };
    case NativeType.Number:
      return { t: NativeType.Number, v: readNumberEntry(s, precision) };
    case NativeType.String:
      return { t: NativeType.String, v: strings.get(s.readVarUint()) };
    case NativeType.Enum:
      return { t: NativeType.Enum, typeId: strings.get(s.readVarUint()), v: strings.get(s.readVarUint()) };
    case NativeType.List: {
      const typeId = strings.get(s.readVarUint());
      const count = s.readVarUint();
      const items: BrainProgramJsonObject[] = [];
      for (let i = 0; i < count; i++) {
        items.push(readValue(s, strings, precision));
      }
      return { t: NativeType.List, typeId, v: items };
    }
    case NativeType.Map: {
      const typeId = strings.get(s.readVarUint());
      const count = s.readVarUint();
      const entries: MapEntryJson[] = [];
      for (let i = 0; i < count; i++) {
        const keyTag = s.readRawU8();
        const key = keyTag === MAP_KEY_TAG_NUMBER ? readNumberEntry(s, precision) : strings.get(s.readVarUint());
        entries.push({ key, value: readValue(s, strings, precision) });
      }
      return { t: NativeType.Map, typeId, v: entries };
    }
    case NativeType.Struct: {
      const typeId = strings.get(s.readVarUint());
      const count = s.readVarUint();
      const fields: BrainProgramJsonObject[] = [];
      for (let i = 0; i < count; i++) {
        fields.push(readValue(s, strings, precision));
      }
      return { t: NativeType.Struct, typeId, v: fields };
    }
    case NativeType.Function: {
      const funcId = s.readVarUint();
      const biasedCaptures = s.readVarUint();
      if (biasedCaptures === 0) {
        return { t: NativeType.Function, funcId };
      }
      const captures: BrainProgramJsonObject[] = [];
      for (let i = 0; i < biasedCaptures - 1; i++) {
        captures.push(readValue(s, strings, precision));
      }
      return { t: NativeType.Function, funcId, captures };
    }
    default:
      throw codecError(BrainProgramBinaryCodecErrorCode.INVALID_VALUE_TAG, `invalid value tag ${tag}`);
  }
}

function readVarsSection(s: MemoryStream, strings: StringTable): string[] {
  const count = s.readVarUint();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    names.push(strings.get(s.readVarUint()));
  }
  return names;
}

function readActsSection(s: MemoryStream): BrainProgramExecutableActionJson[] {
  const count = s.readVarUint();
  const actions: BrainProgramExecutableActionJson[] = [];
  for (let i = 0; i < count; i++) {
    const flags = s.readRawU8();
    const entryFuncId = s.readVarUint();
    const action: {
      entryFuncId: number;
      initializerFuncId?: number;
      activationFuncId?: number;
      deactivationFuncId?: number;
    } = { entryFuncId };
    if ((flags & ACTION_FLAG_INITIALIZER) !== 0) action.initializerFuncId = s.readVarUint();
    if ((flags & ACTION_FLAG_ACTIVATION) !== 0) action.activationFuncId = s.readVarUint();
    if ((flags & ACTION_FLAG_DEACTIVATION) !== 0) action.deactivationFuncId = s.readVarUint();
    actions.push(action);
  }
  return actions;
}

function readRulfSection(s: MemoryStream): number[] {
  const count = s.readVarUint();
  const ruleFuncIds: number[] = [];
  for (let i = 0; i < count; i++) {
    ruleFuncIds.push(s.readVarUint());
  }
  return ruleFuncIds;
}

function readRancSection(s: MemoryStream): BrainProgramRuleAncestorJsonEntry[] {
  const count = s.readVarUint();
  const entries: BrainProgramRuleAncestorJsonEntry[] = [];
  for (let i = 0; i < count; i++) {
    const ruleFuncId = s.readVarUint();
    const parentRuleFuncId = s.readVarUint();
    entries.push({ ruleFuncId, parentRuleFuncId });
  }
  return entries;
}

function readPageSection(s: MemoryStream, strings: StringTable): LinkedBrainProgramPageMetadataJson[] {
  const count = s.readVarUint();
  const pages: LinkedBrainProgramPageMetadataJson[] = [];
  for (let i = 0; i < count; i++) {
    const pageIndex = s.readVarUint();
    const pageId = strings.get(s.readVarUint());
    const rootCount = s.readVarUint();
    const rootRuleFuncIds: number[] = [];
    for (let r = 0; r < rootCount; r++) {
      rootRuleFuncIds.push(s.readVarUint());
    }
    const callSiteCount = s.readVarUint();
    const actionCallSites: LinkedBrainProgramActionCallSiteJsonEntry[] = [];
    for (let c = 0; c < callSiteCount; c++) {
      const binding = s.readRawU8();
      const callSiteId = s.readVarUint();
      const id = s.readVarUint();
      actionCallSites.push(
        binding === CALL_SITE_BINDING_HOST
          ? { binding: "host", callSiteId, actionId: id }
          : { binding: "bytecode", callSiteId, actionSlot: id }
      );
    }
    // pageName is dropped on the wire and hydrates empty.
    pages.push({ pageIndex, pageId, pageName: "", rootRuleFuncIds, actionCallSites });
  }
  return pages;
}

///////////////////////////
// Section byte report
///////////////////////////

/** On-wire body byte count of one binary `.mcprogram` section. */
export interface BinaryProgramSectionByteSize {
  /** Section name (e.g. `"FUNC"`). */
  readonly tag: string;

  /** Section body byte count (var-int-packed payload). */
  readonly bodyBytes: number;
}

/** Byte-size breakdown for a binary `.mcprogram`. */
export interface BinaryProgramByteReport {
  /** Total file byte count. */
  readonly totalBytes: number;

  /** File magic byte count. */
  readonly magicBytes: number;

  /** Envelope header byte count: format version + profile id + presence bitmask. */
  readonly headerBytes: number;

  /** Per-section body sizes, in buffer order. */
  readonly sections: readonly BinaryProgramSectionByteSize[];
}

/**
 * Computes the per-section byte breakdown of a binary `.mcprogram` by parsing
 * the payload and measuring each section's span. Intended for size reporting
 * and regression visibility, not for hot paths.
 *
 * @param bytes - Binary `.mcprogram` payload.
 */
export function binaryProgramByteReport(bytes: IByteArray): BinaryProgramByteReport {
  const s = new MemoryStream(bytes);
  for (let i = 0; i < MAGIC.size(); i++) {
    s.readRawU8();
  }
  s.readRawU8(); // format version
  s.readVarUint(); // profileId
  const presence = s.readRawU8();
  const headerBytes = s.tellRead() - MAGIC.size();

  const sections: BinaryProgramSectionByteSize[] = [];
  // f64 precision accepts any number discriminant while measuring.
  const measure = (tag: string, read: () => void): void => {
    const start = s.tellRead();
    read();
    sections.push({ tag, bodyBytes: s.tellRead() - start });
  };

  const cstrStart = s.tellRead();
  const strings = readCstrSection(s);
  sections.push({ tag: "CSTR", bodyBytes: s.tellRead() - cstrStart });
  measure("CNUM", () => {
    readCnumSection(s, "f64");
  });
  measure("CVAL", () => {
    readCvalSection(s, strings, "f64");
  });
  measure("FUNC", () => {
    readFuncSection(s, strings);
  });
  measure("VARS", () => {
    readVarsSection(s, strings);
  });
  if ((presence & PRESENCE_ACTS) !== 0) {
    measure("ACTS", () => {
      readActsSection(s);
    });
  }
  if ((presence & PRESENCE_RULF) !== 0) {
    measure("RULF", () => {
      readRulfSection(s);
    });
  }
  if ((presence & PRESENCE_RANC) !== 0) {
    measure("RANC", () => {
      readRancSection(s);
    });
  }
  measure("PAGE", () => {
    readPageSection(s, strings);
  });

  return { totalBytes: bytes.length(), magicBytes: MAGIC.size(), headerBytes, sections };
}

///////////////////////////
// Shared helpers
///////////////////////////

/** One JSON-encoded map entry (`key` is a string or number; `value` is recursive). */
type MapEntryJson = {
  readonly key: string | number;
  readonly value: BrainProgramJsonObject;
};

function operandSchemaFor(op: number): List<OperandSpec> {
  const raw = OPERAND_SCHEMA[op as keyof typeof OPERAND_SCHEMA] as readonly OperandSpec[] | undefined;
  if (raw === undefined) {
    throw codecError(BrainProgramBinaryCodecErrorCode.UNKNOWN_OPCODE, `no operand schema for opcode ${op}`);
  }
  return List.from(raw);
}

function writeValueTag(s: MemoryStream, tag: NativeType): void {
  // NativeType.Unknown is -1; store it as 0xff and map back on read.
  s.writeRawU8(tag < 0 ? tag + 256 : tag);
}

function readValueTag(s: MemoryStream): NativeType {
  const raw = s.readRawU8();
  return (raw === 255 ? NativeType.Unknown : raw) as NativeType;
}

function definedOperandCount(instr: Instr): number {
  if (instr.a === undefined) {
    if (instr.b !== undefined || instr.c !== undefined) {
      throw codecError(
        BrainProgramBinaryCodecErrorCode.INSTRUCTION_SCHEMA_MISMATCH,
        "operands are not a contiguous prefix"
      );
    }
    return 0;
  }
  if (instr.b === undefined) {
    if (instr.c !== undefined) {
      throw codecError(
        BrainProgramBinaryCodecErrorCode.INSTRUCTION_SCHEMA_MISMATCH,
        "operands are not a contiguous prefix"
      );
    }
    return 1;
  }
  return instr.c === undefined ? 2 : 3;
}

function requiredOperandCount(schema: List<OperandSpec>): number {
  let count = 0;
  for (let i = 0; i < schema.size(); i++) {
    if (!schema.get(i).optional) {
      count += 1;
    }
  }
  return count;
}

function operandAt(instr: Instr, index: number): number | undefined {
  if (index === 0) return instr.a;
  if (index === 1) return instr.b;
  return instr.c;
}

function setOperandAt(instr: { a?: number; b?: number; c?: number }, index: number, value: number): void {
  if (index === 0) {
    instr.a = value;
  } else if (index === 1) {
    instr.b = value;
  } else {
    instr.c = value;
  }
}

function isU32(x: number): boolean {
  if (MathOps.isNaN(x)) {
    return false;
  }
  if (x < 0 || x > 0xffffffff) {
    return false;
  }
  return MathOps.floor(x) === x;
}

function isSmallInt(x: number): boolean {
  if (MathOps.isNaN(x)) {
    return false;
  }
  if (x > I32_MAX || x < I32_MIN) {
    return false;
  }
  if (MathOps.floor(x) !== x) {
    return false;
  }
  // Reject negative zero: it is not small-int-encodable (lands on the profile float).
  return !(x === 0 && 1 / x < 0);
}
