import { Dict } from "../platform/dict";
import { Error } from "../platform/error";
import { List } from "../platform/list";
import { NativeType, type StructTypeDef, type TypeId } from "./type-defs";

///////////////////////////
// Async handle identifiers
///////////////////////////

/** Opaque identifier for a pending async operation. */
export type HandleId = number;

///////////////////////////
// Error codes and payloads
///////////////////////////

/**
 * Numeric fault classifier carried by every {@link ErrorValue}. Wire-stable
 * across the TS reference VM and the C++ MCU port. Values are explicit so
 * adding new codes does not renumber existing ones.
 */
export enum ErrorCode {
  Timeout = 1,
  Cancelled = 2,
  HostError = 3,
  ScriptError = 4,
  StackOverflow = 5,
  StackUnderflow = 6,
}

/**
 * Return the canonical string name for a code (e.g. `ErrorCode.ScriptError ->
 * "ScriptError"`). Use at the diagnostics boundary when rendering errors for
 * humans. The runtime itself never compares against the name.
 */
export function errorCodeName(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.Timeout:
      return "Timeout";
    case ErrorCode.Cancelled:
      return "Cancelled";
    case ErrorCode.HostError:
      return "HostError";
    case ErrorCode.ScriptError:
      return "ScriptError";
    case ErrorCode.StackOverflow:
      return "StackOverflow";
    case ErrorCode.StackUnderflow:
      return "StackUnderflow";
    default:
      return `ErrorCode(${code as number})`;
  }
}

/** Tagged error payload produced by the VM (timeouts, host exceptions, stack faults, etc.). */
export type ErrorValue = {
  code: ErrorCode;
  message: string;
  detail?: unknown;
  site?: { funcId: number; pc: number };
  stackTrace?: List<string>;
};

///////////////////////////
// Value Model
///////////////////////////

/** Dictionary of brain {@link Value}s with typed accessors per native type. */
export class ValueDict extends Dict<string | number, Value> {
  getString(key: string | number): StringValue | undefined {
    const val = this.get(key);
    if (val && val.t === NativeType.String) {
      return val as StringValue;
    }
    return undefined;
  }

  getNumber(key: string | number): NumberValue | undefined {
    const val = this.get(key);
    if (val && val.t === NativeType.Number) {
      return val as NumberValue;
    }
    return undefined;
  }

  getBoolean(key: string | number): BooleanValue | undefined {
    const val = this.get(key);
    if (val && val.t === NativeType.Boolean) {
      return val as BooleanValue;
    }
    return undefined;
  }

  getList(key: string | number): ListValue | undefined {
    const val = this.get(key);
    if (val && val.t === NativeType.List) {
      return val as ListValue;
    }
    return undefined;
  }

  getMap(key: string | number): MapValue | undefined {
    const val = this.get(key);
    if (val && val.t === NativeType.Map) {
      return val as MapValue;
    }
    return undefined;
  }

  getStruct(key: string | number): StructValue | undefined {
    const val = this.get(key);
    if (val && val.t === NativeType.Struct) {
      return val as StructValue;
    }
    return undefined;
  }

  getEnum(key: string | number): EnumValue | undefined {
    const val = this.get(key);
    if (val && val.t === NativeType.Enum) {
      return val as EnumValue;
    }
    return undefined;
  }
}

/** Brain runtime value of unknown native type. */
export type UnknownValue = { t: NativeType.Unknown };
/** Brain runtime value representing the absence of a value (statement result). */
export type VoidValue = { t: NativeType.Void };
/** Brain runtime value representing nil. */
export type NilValue = { t: NativeType.Nil };
/** Brain runtime boolean value. */
export type BooleanValue = { t: NativeType.Boolean; v: boolean };
/** Brain runtime number value. */
export type NumberValue = { t: NativeType.Number; v: number };
/** Brain runtime string value. */
export type StringValue = { t: NativeType.String; v: string };
/** Brain runtime enum value: `typeId` plus the symbol `key`. */
export type EnumValue = { t: NativeType.Enum; typeId: TypeId; v: string };
/** Brain runtime list value. */
export type ListValue = { t: NativeType.List; typeId: TypeId; v: List<Value> };
/** Brain runtime map value. */
export type MapValue = { t: NativeType.Map; typeId: TypeId; v: ValueDict };
/** Brain runtime struct value. `v` holds closed-struct field values indexed by `fieldIndex`. */
export type StructValue = { t: NativeType.Struct; typeId: TypeId; v?: List<Value>; native?: unknown };
/** Brain runtime function value: function id plus optional captured upvalues. */
export type FunctionValue = { t: NativeType.Function; funcId: number; captures?: List<Value> };

/**
 * Settle handle for one pending async operation, bound to a single
 * {@link HandleId}. An async host function or action body retains this across
 * the async boundary and calls exactly one of {@link resolve}, {@link reject},
 * or {@link cancel} when the work completes. Settling a handle that is no longer
 * pending -- already settled, cancelled with its awaiting fiber, or collected --
 * is a no-op.
 */
export interface AsyncHandle {
  /** The bound handle id, the value the dispatching opcode pushed for `AWAIT`. */
  readonly id: HandleId;

  /** Settles the handle as resolved, carrying `value` to the awaiting fiber. */
  resolve(value: Value): void;

  /** Settles the handle as rejected; the awaiting fiber throws an error of `code`. */
  reject(code: ErrorCode, message?: string): void;

  /** Settles the handle as cancelled; the awaiting fiber throws `ErrorCode.Cancelled`. */
  cancel(message?: string): void;
}

/** Tagged-union of all brain runtime values, including VM-internal `handle` and `err`. */
export type Value =
  | UnknownValue
  | VoidValue
  | NilValue
  | BooleanValue
  | NumberValue
  | StringValue
  | EnumValue
  | ListValue
  | MapValue
  | StructValue
  | FunctionValue
  | { t: "handle"; id: HandleId } // VM-internal type
  | { t: "err"; e: ErrorValue }; // VM-internal type

/** Pooled singleton {@link UnknownValue}. */
export const UNKNOWN_VALUE: UnknownValue = { t: NativeType.Unknown };
/** Pooled singleton {@link VoidValue}. */
export const VOID_VALUE: VoidValue = { t: NativeType.Void };
/** Pooled singleton {@link NilValue}. */
export const NIL_VALUE: NilValue = { t: NativeType.Nil };
/** Pooled singleton {@link BooleanValue} for `true`. */
export const TRUE_VALUE: BooleanValue = { t: NativeType.Boolean, v: true };
/** Pooled singleton {@link BooleanValue} for `false`. */
export const FALSE_VALUE: BooleanValue = { t: NativeType.Boolean, v: false };

/** Return the pooled singleton {@link BooleanValue} for `b`. */
export function mkBooleanValue(b: boolean): BooleanValue {
  return b ? TRUE_VALUE : FALSE_VALUE;
}
/** Build a {@link NumberValue}. */
export function mkNumberValue(n: number): NumberValue {
  return { t: NativeType.Number, v: n };
}
/** Build a {@link StringValue}. */
export function mkStringValue(str: string): StringValue {
  return { t: NativeType.String, v: str };
}
/** Build a closed {@link StructValue} with fields ordered by `StructFieldDef.fieldIndex`. */
export function mkClosedStructValue(typeId: TypeId, fieldsByIndex: List<Value>): StructValue {
  return { t: NativeType.Struct, typeId, v: fieldsByIndex };
}
/** Build a closed {@link StructValue} by resolving field names through a registered struct definition. */
export function mkClosedStructValueByName(typeDef: StructTypeDef, fieldsByName: Dict<string, Value>): StructValue {
  const fieldsByIndex = List.empty<Value>();
  for (let i = 0; i < typeDef.fields.size(); i++) {
    fieldsByIndex.push(NIL_VALUE);
  }
  fieldsByName.forEach((value, fieldName) => {
    const fieldIndex = typeDef.fieldIndexByName.get(fieldName);
    if (fieldIndex === undefined) {
      throw new Error(`Unknown field '${fieldName}' on struct type ${typeDef.typeId}`);
    }
    fieldsByIndex.set(fieldIndex, value);
  });
  return mkClosedStructValue(typeDef.typeId, fieldsByIndex);
}
/** Read a closed {@link StructValue} field by name through a registered struct definition. */
export function getClosedStructFieldByName(
  typeDef: StructTypeDef,
  source: StructValue,
  fieldName: string
): Value | undefined {
  const fieldIndex = typeDef.fieldIndexByName.get(fieldName);
  return fieldIndex === undefined ? undefined : source.v?.get(fieldIndex);
}
/** Build a native-backed {@link StructValue} with no field map. */
export function mkNativeStructValue(typeId: TypeId, native: unknown): StructValue {
  return { t: NativeType.Struct, typeId, v: List.empty<Value>(), native };
}
/** Build a {@link ListValue}. */
export function mkListValue(typeId: TypeId, items: List<Value>): ListValue {
  return { t: NativeType.List, typeId, v: items };
}
/** Build a {@link FunctionValue}, optionally with captured upvalues. */
export function mkFunctionValue(funcId: number, captures?: List<Value>): FunctionValue {
  if (captures !== undefined) {
    return { t: NativeType.Function, funcId, captures };
  }
  return { t: NativeType.Function, funcId };
}

// Value extractors
/** Return the boolean payload, or undefined if `v` is not a {@link BooleanValue}. */
export function extractBooleanValue(v: Value | undefined): boolean | undefined {
  if (v && v.t === NativeType.Boolean) {
    return v.v;
  }
  return undefined;
}
/** Return the number payload, or undefined if `v` is not a {@link NumberValue}. */
export function extractNumberValue(v: Value | undefined): number | undefined {
  if (v && v.t === NativeType.Number) {
    return v.v;
  }
  return undefined;
}
/** Return the string payload, or undefined if `v` is not a {@link StringValue}. */
export function extractStringValue(v: Value | undefined): string | undefined {
  if (v && v.t === NativeType.String) {
    return v.v;
  }
  return undefined;
}
/** Return the list payload, or undefined if `v` is not a {@link ListValue}. */
export function extractListValue(v: Value | undefined): List<Value> | undefined {
  if (v && v.t === NativeType.List) {
    return v.v;
  }
  return undefined;
}

// Type guards
/** Type guard for VM-internal handle values. */
export function isHandleValue(v: Value | undefined): v is { t: "handle"; id: HandleId } {
  return v?.t === "handle";
}
/** Type guard for {@link UnknownValue}. */
export function isUnknownValue(v: Value | undefined): v is UnknownValue {
  return v?.t === NativeType.Unknown;
}
/** Type guard for {@link VoidValue}. */
export function isVoidValue(v: Value | undefined): v is VoidValue {
  return v?.t === NativeType.Void;
}
/** Type guard for {@link NilValue}. */
export function isNilValue(v: Value | undefined): v is NilValue {
  return v?.t === NativeType.Nil;
}
/** Type guard for {@link BooleanValue}. */
export function isBooleanValue(v: Value | undefined): v is BooleanValue {
  return v?.t === NativeType.Boolean;
}
/** Type guard for {@link NumberValue}. */
export function isNumberValue(v: Value | undefined): v is NumberValue {
  return v?.t === NativeType.Number;
}
/** Type guard for {@link StringValue}. */
export function isStringValue(v: Value | undefined): v is StringValue {
  return v?.t === NativeType.String;
}
/** Type guard for {@link EnumValue}. */
export function isEnumValue(v: Value | undefined): v is EnumValue {
  return v?.t === NativeType.Enum;
}
/** Type guard for {@link ListValue}. */
export function isListValue(v: Value | undefined): v is ListValue {
  return v?.t === NativeType.List;
}
/** Type guard for {@link MapValue}. */
export function isMapValue(v: Value | undefined): v is MapValue {
  return v?.t === NativeType.Map;
}
/** Type guard for {@link StructValue}. */
export function isStructValue(v: Value | undefined): v is StructValue {
  return v?.t === NativeType.Struct;
}
/** Type guard for {@link FunctionValue}. */
export function isFunctionValue(v: Value | undefined): v is FunctionValue {
  return v?.t === NativeType.Function;
}
/** Type guard for VM-internal error values. */
export function isErrValue(v: Value | undefined): v is { t: "err"; e: ErrorValue } {
  return v?.t === "err";
}

/**
 * Invoke `cb` with the {@link TypeId} of `value` and of every value nested
 * inside it (list elements, map values, struct fields). Values that carry no
 * type identity (numbers, strings, booleans, nil, functions, handles) are
 * skipped.
 */
export function forEachValueTypeId(value: Value, cb: (typeId: TypeId) => void): void {
  switch (value.t) {
    case NativeType.Enum:
      cb(value.typeId);
      return;
    case NativeType.List:
      cb(value.typeId);
      value.v.forEach((item) => {
        forEachValueTypeId(item, cb);
      });
      return;
    case NativeType.Map:
      cb(value.typeId);
      value.v.forEach((item) => {
        forEachValueTypeId(item, cb);
      });
      return;
    case NativeType.Struct:
      cb(value.typeId);
      value.v?.forEach((item) => {
        forEachValueTypeId(item, cb);
      });
      return;
    default:
      return;
  }
}
