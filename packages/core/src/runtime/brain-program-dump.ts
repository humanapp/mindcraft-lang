/**
 * Canonical program dump: a deterministic, line-oriented ASCII rendering of a
 * decoded linked brain program plus its binary envelope fields. Two decoders
 * of the same binary `.mcprogram` produce byte-identical dumps; the committed
 * dump beside each binary fixture is the cross-implementation contract a
 * separately built VM's reader is verified against.
 *
 * Dump format, version 1 (LOCKED; any change bumps
 * {@link CANONICAL_PROGRAM_DUMP_FORMAT_VERSION} and regenerates every
 * committed dump):
 *
 * - The dump is ASCII with LF line endings and ends with a trailing LF.
 *   Tokens on a line are separated by single spaces. Nested lines are
 *   indented two spaces per depth level.
 * - Every rendered field is reproducible from the decoded program structures
 *   alone. TypeId strings never appear; type references render as type-table
 *   indices.
 * - Integer scalars (counts, indices, ids, opcodes, operands) render as the
 *   minimal lowercase hexadecimal of their unsigned 32-bit value with no
 *   prefix or padding ("0" for zero). Signed scalars (the rel-offset
 *   instruction operands) render the two's-complement bit pattern of their
 *   i32 value under the same rule (-6 renders as "fffffffa").
 * - Numeric values (numbers-pool entries, Number constants, map number keys)
 *   render as the IEEE-754 bit pattern of the decoded value at the program's
 *   profile precision: 8 zero-padded hex digits of the f32 bits on an f32
 *   profile, 16 digits of the f64 bits on an f64 profile.
 * - Strings render as a double-quoted UTF-8 byte sequence: bytes 0x20..0x7e
 *   are literal except `"` (renders `\"`) and `\` (renders `\\`); every other
 *   byte renders as `\xNN` with two lowercase hex digits.
 * - An absent optional scalar renders as `-`.
 *
 * Line layout, in order (a section header carries its entry count; an
 * optional program section that decoded as absent is omitted entirely,
 * while a present-but-empty section renders its header with count 0):
 *
 * ```
 * mcprogram-dump 1
 * profile <profileId>
 * precision f32|f64
 * strings <count>
 *   string <idx> "<bytes>"
 * types <count>
 *   type <idx> atom <atomId>
 *   type <idx> list <elemIdx>
 *   type <idx> map <keyIdx> <valueIdx>
 *   type <idx> union <memberCount> <memberIdx>...
 *   type <idx> function <paramCount> <paramIdx>... <resultIdx>
 *   type <idx> nullable <baseIdx>
 *   type <idx> struct "<name>" slots <slotCount> fields <count> "<field>" <id>...
 *   type <idx> enum "<name>" symbols <count> "<key>" <"value"|bits>...
 * numbers <count>
 *   number <idx> <bits>
 * values <count>
 *   value <idx> <value-node>
 * functions <count>
 *   function <idx> params <n> locals <n> ctx <typeIdx|-> code <instrCount>
 *     instr <op> <operand>...
 * vars <count>
 *   var <idx> "<name>"
 * actions <count>
 *   action <idx> entry <funcId> init <funcId|-> activate <funcId|-> deactivate <funcId|->
 * rulefuncs <count>
 *   rulefunc <idx> <funcId>
 * ruleancestors <count>
 *   ruleancestor <idx> <funcId> <parentFuncId>
 * pages <count>
 *   page <idx> index <pageIndex> id "<pageId>" roots <count> callsites <count>
 *     root <funcId>
 *     callsite host <callSiteId> action <actionId>
 *     callsite bytecode <callSiteId> slot <actionSlot>
 * ```
 *
 * A value node is one of the following; container children follow on
 * subsequent lines, one indent level deeper, in element / insertion / field
 * order:
 *
 * ```
 * unknown
 * void
 * nil
 * bool 0|1
 * number <bits>
 * string "<bytes>"
 * enum <typeIdx> <ordinal>
 * list <typeIdx> <count>
 * map <typeIdx> <count>      (children: `entry number <bits>` or
 *                             `entry string "<bytes>"`, each followed by the
 *                             entry's value node one level deeper)
 * struct <typeIdx> <count>
 * function <funcId> captures <count|->
 * buffer <byteCount> <hexbytes>
 * ```
 *
 * A `buffer` node renders its byte count then, only when the count is
 * non-zero, a single token of the raw bytes as two lowercase hex digits per
 * byte with no separators.
 *
 * Instruction operands follow the opcode's `OPERAND_SCHEMA` entry: required
 * operands always render; an absent optional trailing operand renders `-`.
 */

import { Error } from "../platform/error";
import { List } from "../platform/list";
import { MathOps } from "../platform/math";
import { MemoryStream } from "../platform/stream";
import { StringUtils } from "../platform/string";
import { TypeUtils } from "../platform/types";
import { buildProgramTypeIndex, type NumberPrecision, type ProgramTypeIndex } from "./brain-program-binary-codec";
import { type Instr, instrOperandMismatch, OPERAND_SCHEMA, type OperandSpec } from "./bytecode";
import type { ActionCallSiteEntry, LinkedBrainProgram } from "./host-bindings";
import type { ProgramTypeEntry } from "./program";
import { type ITypeRegistry, NativeType } from "./type-defs";
import type { Value } from "./value";

/** Current canonical program dump format version. */
export const CANONICAL_PROGRAM_DUMP_FORMAT_VERSION = 2;

/** Options controlling {@link linkedBrainProgramToCanonicalDump}. */
export interface CanonicalProgramDumpOptions {
  /** Numeric device-profile id from the binary envelope header. */
  readonly profileId: number;

  /** Profile numeric precision; selects the numeric-value bit-pattern width. */
  readonly precision: NumberPrecision;

  /**
   * Type registry used to resolve symbol ordinals for enum constant values of
   * atom (core/target) enum types. Required only when the program carries such
   * a constant; program-local enum ordinals resolve through the type table.
   */
  readonly typeRegistry?: ITypeRegistry;
}

const HEX_DIGITS = "0123456789abcdef";

function hexU32(value: number): string {
  let v = value < 0 ? value + 0x100000000 : value;
  if (v === 0) {
    return "0";
  }
  let out = "";
  while (v > 0) {
    out = StringUtils.charAt(HEX_DIGITS, v % 16) + out;
    v = MathOps.floor(v / 16);
  }
  return out;
}

function hexPadded(value: number, width: number): string {
  let out = hexU32(value);
  while (StringUtils.length(out) < width) {
    out = `0${out}`;
  }
  return out;
}

/** Renders the little-endian bytes written to `w` as one big-endian hex bit pattern. */
function writtenBitsHex(w: MemoryStream, byteCount: number): string {
  const r = new MemoryStream(w.toBytes());
  let out = "";
  for (let i = 0; i < byteCount; i++) {
    out = hexPadded(r.readRawU8(), 2) + out;
  }
  return out;
}

function numberBits(value: number, precision: NumberPrecision): string {
  const w = new MemoryStream();
  if (precision === "f32") {
    w.writeRawF32(value);
    return writtenBitsHex(w, 4);
  }
  w.writeRawF64(value);
  return writtenBitsHex(w, 8);
}

function quoted(value: string): string {
  const w = new MemoryStream();
  w.writeVarString(value);
  const r = new MemoryStream(w.toBytes());
  const byteLen = r.readVarUint();
  let out = '"';
  for (let i = 0; i < byteLen; i++) {
    const b = r.readRawU8();
    if (b === 0x22) {
      out += '\\"';
    } else if (b === 0x5c) {
      out += "\\\\";
    } else if (b >= 0x20 && b <= 0x7e) {
      out += StringUtils.fromCharCode(b);
    } else {
      out += `\\x${hexPadded(b, 2)}`;
    }
  }
  return `${out}"`;
}

class DumpWriter {
  private out = "";

  line(depth: number, text: string): void {
    this.out += `${StringUtils.rep("  ", depth)}${text}\n`;
  }

  render(): string {
    return this.out;
  }
}

function typeEntryLine(idx: number, entry: ProgramTypeEntry, precision: NumberPrecision): string {
  const head = `type ${hexU32(idx)}`;
  switch (entry.tag) {
    case "atom":
      return `${head} atom ${hexU32(entry.atomId)}`;
    case "list":
      return `${head} list ${hexU32(entry.elem)}`;
    case "map":
      return `${head} map ${hexU32(entry.key)} ${hexU32(entry.value)}`;
    case "union": {
      let line = `${head} union ${hexU32(entry.members.size())}`;
      for (let i = 0; i < entry.members.size(); i++) {
        line += ` ${hexU32(entry.members.get(i)!)}`;
      }
      return line;
    }
    case "function": {
      let line = `${head} function ${hexU32(entry.params.size())}`;
      for (let i = 0; i < entry.params.size(); i++) {
        line += ` ${hexU32(entry.params.get(i)!)}`;
      }
      return `${line} ${hexU32(entry.result)}`;
    }
    case "nullable":
      return `${head} nullable ${hexU32(entry.base)}`;
    case "struct": {
      let line = `${head} struct ${quoted(entry.name)} slots ${hexU32(entry.maxFieldId + 1)} fields ${hexU32(
        entry.fields.size()
      )}`;
      for (let i = 0; i < entry.fields.size(); i++) {
        const field = entry.fields.get(i)!;
        line += ` ${quoted(field.name)} ${hexU32(field.fieldIndex)}`;
      }
      return line;
    }
    case "enum": {
      let line = `${head} enum ${quoted(entry.name)} symbols ${hexU32(entry.symbols.size())}`;
      for (let i = 0; i < entry.symbols.size(); i++) {
        const symbol = entry.symbols.get(i)!;
        const value = symbol.value;
        const valueText = TypeUtils.isString(value) ? quoted(value) : numberBits(value, precision);
        line += ` ${quoted(symbol.key)} ${valueText}`;
      }
      return line;
    }
  }
}

function instrLine(instr: Instr): string {
  const mismatch = instrOperandMismatch(instr);
  if (mismatch !== undefined) {
    throw new Error(`canonical dump: ${mismatch}`);
  }
  const schema = List.from(OPERAND_SCHEMA[instr.op as keyof typeof OPERAND_SCHEMA] as readonly OperandSpec[]);
  let line = `instr ${hexU32(instr.op)}`;
  for (let i = 0; i < schema.size(); i++) {
    const operand = i === 0 ? instr.a : i === 1 ? instr.b : instr.c;
    if (schema.get(i).optional && operand === undefined) {
      line += " -";
    } else {
      line += ` ${hexU32(operand as number)}`;
    }
  }
  return line;
}

function emitValue(
  w: DumpWriter,
  depth: number,
  label: string,
  value: Value,
  types: ProgramTypeIndex,
  precision: NumberPrecision
): void {
  const head = label === "" ? "" : `${label} `;
  switch (value.t) {
    case NativeType.Unknown:
      w.line(depth, `${head}unknown`);
      return;
    case NativeType.Void:
      w.line(depth, `${head}void`);
      return;
    case NativeType.Nil:
      w.line(depth, `${head}nil`);
      return;
    case NativeType.Boolean:
      w.line(depth, `${head}bool ${value.v ? "1" : "0"}`);
      return;
    case NativeType.Number:
      w.line(depth, `${head}number ${numberBits(value.v, precision)}`);
      return;
    case NativeType.String:
      w.line(depth, `${head}string ${quoted(value.v)}`);
      return;
    case NativeType.Enum:
      w.line(
        depth,
        `${head}enum ${hexU32(types.typeIdxOf(value.typeId))} ${hexU32(types.enumOrdinalOf(value.typeId, value.v))}`
      );
      return;
    case NativeType.List: {
      w.line(depth, `${head}list ${hexU32(types.typeIdxOf(value.typeId))} ${hexU32(value.v.size())}`);
      for (let i = 0; i < value.v.size(); i++) {
        emitValue(w, depth + 1, "", value.v.get(i), types, precision);
      }
      return;
    }
    case NativeType.Map: {
      const entries = value.v.entries();
      w.line(depth, `${head}map ${hexU32(types.typeIdxOf(value.typeId))} ${hexU32(entries.size())}`);
      for (let i = 0; i < entries.size(); i++) {
        const entry = entries.get(i);
        const key = entry[0];
        if (TypeUtils.isNumber(key)) {
          w.line(depth + 1, `entry number ${numberBits(key, precision)}`);
        } else {
          w.line(depth + 1, `entry string ${quoted(key)}`);
        }
        emitValue(w, depth + 2, "", entry[1], types, precision);
      }
      return;
    }
    case NativeType.Struct: {
      if (value.native !== undefined) {
        throw new Error("canonical dump: native-backed struct values have no rendering");
      }
      const fields = value.v;
      const fieldCount = fields === undefined ? 0 : fields.size();
      w.line(depth, `${head}struct ${hexU32(types.typeIdxOf(value.typeId))} ${hexU32(fieldCount)}`);
      if (fields !== undefined) {
        for (let i = 0; i < fields.size(); i++) {
          emitValue(w, depth + 1, "", fields.get(i), types, precision);
        }
      }
      return;
    }
    case NativeType.Function: {
      const captures = value.captures;
      const capturesToken = captures === undefined ? "-" : hexU32(captures.size());
      w.line(depth, `${head}function ${hexU32(value.funcId)} captures ${capturesToken}`);
      if (captures !== undefined) {
        for (let i = 0; i < captures.size(); i++) {
          emitValue(w, depth + 1, "", captures.get(i), types, precision);
        }
      }
      return;
    }
    case NativeType.Buffer: {
      const latin1 = value.v.toStringLatin1();
      const count = value.v.length();
      let line = `${head}buffer ${hexU32(count)}`;
      if (count > 0) {
        let run = "";
        for (let i = 0; i < count; i++) {
          run += hexPadded(StringUtils.charCodeAt(latin1, i) & 0xff, 2);
        }
        line += ` ${run}`;
      }
      w.line(depth, line);
      return;
    }
    default:
      throw new Error(`canonical dump: runtime-only value '${value.t}' has no rendering`);
  }
}

/**
 * Renders a decoded linked brain program and its envelope fields as the
 * canonical program dump text. The rendering is deterministic: equal decoded
 * programs produce byte-identical dumps.
 *
 * Throws on a program a binary `.mcprogram` cannot carry (runtime-only or
 * native-backed constant values, an instruction violating its operand
 * schema, or a constant whose type is missing from the program type table).
 *
 * @param program - Decoded linked brain program to render.
 * @param options - Envelope profile id, profile precision, and optional type registry.
 */
export function linkedBrainProgramToCanonicalDump(
  program: LinkedBrainProgram,
  options: CanonicalProgramDumpOptions
): string {
  const p = program.program;
  const types = p.types ?? List.empty<ProgramTypeEntry>();
  const typeIndex = buildProgramTypeIndex(types, options.typeRegistry);
  const precision = options.precision;
  const w = new DumpWriter();

  w.line(0, `mcprogram-dump ${hexU32(CANONICAL_PROGRAM_DUMP_FORMAT_VERSION)}`);
  w.line(0, `profile ${hexU32(options.profileId)}`);
  w.line(0, `precision ${precision}`);

  const strings = p.constantPools.strings;
  w.line(0, `strings ${hexU32(strings.size())}`);
  for (let i = 0; i < strings.size(); i++) {
    w.line(1, `string ${hexU32(i)} ${quoted(strings.get(i))}`);
  }

  w.line(0, `types ${hexU32(types.size())}`);
  for (let i = 0; i < types.size(); i++) {
    w.line(1, typeEntryLine(i, types.get(i)!, precision));
  }

  const numbers = p.constantPools.numbers;
  w.line(0, `numbers ${hexU32(numbers.size())}`);
  for (let i = 0; i < numbers.size(); i++) {
    w.line(1, `number ${hexU32(i)} ${numberBits(numbers.get(i), precision)}`);
  }

  const values = p.constantPools.values;
  w.line(0, `values ${hexU32(values.size())}`);
  for (let i = 0; i < values.size(); i++) {
    emitValue(w, 1, `value ${hexU32(i)}`, values.get(i), typeIndex, precision);
  }

  const functions = p.functions;
  w.line(0, `functions ${hexU32(functions.size())}`);
  for (let i = 0; i < functions.size(); i++) {
    const fn = functions.get(i);
    const ctxToken = fn.injectCtxTypeIdx === undefined ? "-" : hexU32(fn.injectCtxTypeIdx);
    const numLocals = fn.numLocals ?? fn.numParams;
    w.line(
      1,
      `function ${hexU32(i)} params ${hexU32(fn.numParams)} locals ${hexU32(numLocals)} ctx ${ctxToken} code ${hexU32(fn.code.size())}`
    );
    for (let j = 0; j < fn.code.size(); j++) {
      w.line(2, instrLine(fn.code.get(j)));
    }
  }

  const variableNames = p.variableNames;
  w.line(0, `vars ${hexU32(variableNames.size())}`);
  for (let i = 0; i < variableNames.size(); i++) {
    w.line(1, `var ${hexU32(i)} ${quoted(variableNames.get(i))}`);
  }

  const actions = p.actions;
  if (actions !== undefined) {
    w.line(0, `actions ${hexU32(actions.size())}`);
    for (let i = 0; i < actions.size(); i++) {
      const action = actions.get(i);
      const opt = (funcId: number | undefined): string => (funcId === undefined ? "-" : hexU32(funcId));
      w.line(
        1,
        `action ${hexU32(i)} entry ${hexU32(action.entryFuncId)} init ${opt(action.initializerFuncId)} activate ${opt(action.activationFuncId)} deactivate ${opt(action.deactivationFuncId)}`
      );
    }
  }

  const ruleFuncIds = p.ruleFuncIds;
  if (ruleFuncIds !== undefined) {
    const ids = ruleFuncIds.toArray();
    w.line(0, `rulefuncs ${hexU32(ruleFuncIds.size())}`);
    for (let i = 0; i < ruleFuncIds.size(); i++) {
      w.line(1, `rulefunc ${hexU32(i)} ${hexU32(ids[i])}`);
    }
  }

  const ruleAncestors = p.ruleAncestors;
  if (ruleAncestors !== undefined) {
    const entries = ruleAncestors.entries();
    w.line(0, `ruleancestors ${hexU32(entries.size())}`);
    for (let i = 0; i < entries.size(); i++) {
      const entry = entries.get(i);
      w.line(1, `ruleancestor ${hexU32(i)} ${hexU32(entry[0])} ${hexU32(entry[1])}`);
    }
  }

  const pages = program.pages;
  w.line(0, `pages ${hexU32(pages.size())}`);
  for (let i = 0; i < pages.size(); i++) {
    const page = pages.get(i);
    const roots = page.rootRuleFuncIds;
    const callSites = page.actionCallSites;
    w.line(
      1,
      `page ${hexU32(i)} index ${hexU32(page.pageIndex)} id ${quoted(page.pageId)} roots ${hexU32(roots.size())} callsites ${hexU32(callSites.size())}`
    );
    for (let r = 0; r < roots.size(); r++) {
      w.line(2, `root ${hexU32(roots.get(r))}`);
    }
    for (let c = 0; c < callSites.size(); c++) {
      w.line(2, callSiteLine(callSites.get(c)));
    }
  }

  return w.render();
}

function callSiteLine(callSite: ActionCallSiteEntry): string {
  if (callSite.binding === "host") {
    return `callsite host ${hexU32(callSite.callSiteId)} action ${hexU32(callSite.actionId)}`;
  }
  return `callsite bytecode ${hexU32(callSite.callSiteId)} slot ${hexU32(callSite.actionSlot)}`;
}
