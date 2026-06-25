import { Error } from "../platform/error";
import { List } from "../platform/list";
import { TypeUtils } from "../platform/types";
import { dictToJsonEntries, listFromJson, listToJson } from "./json-container-codec";
import { NativeType } from "./type-defs";
import {
  bufferToHex,
  type ErrorValue,
  FALSE_VALUE,
  type FunctionValue,
  type MapValue,
  mkBufferValueFromHex,
  mkFunctionValue,
  mkListValue,
  mkNumberValue,
  mkStringValue,
  NIL_VALUE,
  type StructValue,
  TRUE_VALUE,
  UNKNOWN_VALUE,
  type Value,
  ValueDict,
  VOID_VALUE,
} from "./value";

/** JSON primitive value accepted inside serialized brain program values. */
export type BrainProgramJsonPrimitive = string | number | boolean | null;

/** JSON value accepted inside serialized brain program values. */
export type BrainProgramJsonValue =
  | BrainProgramJsonPrimitive
  | readonly BrainProgramJsonValue[]
  | { readonly [key: string]: BrainProgramJsonValue };

/** JSON-safe runtime value stored in linked brain program payloads. */
export type BrainProgramValueJson = BrainProgramJsonValue;

type RuntimeValueTag = Value["t"];

/** JSON object payload keyed by string, used for tagged brain program values. */
export type BrainProgramJsonObject = { readonly [key: string]: BrainProgramJsonValue };

interface RuntimeValueJsonCodec<TValue extends Value = Value> {
  readonly fromJson: (json: BrainProgramJsonObject) => TValue;
  readonly toJson: (value: TValue) => BrainProgramJsonObject;
}

type RuntimeValueJsonCodecTable = {
  readonly [TTag in RuntimeValueTag]: RuntimeValueJsonCodec<Extract<Value, { t: TTag }>>;
};

const RUNTIME_VALUE_JSON_CODECS = {
  [NativeType.Unknown]: {
    fromJson: () => UNKNOWN_VALUE,
    toJson: () => ({ t: NativeType.Unknown }),
  },
  [NativeType.Void]: {
    fromJson: () => VOID_VALUE,
    toJson: () => ({ t: NativeType.Void }),
  },
  [NativeType.Nil]: {
    fromJson: () => NIL_VALUE,
    toJson: () => ({ t: NativeType.Nil }),
  },
  [NativeType.Boolean]: {
    fromJson: (json) => (json.v === true ? TRUE_VALUE : FALSE_VALUE),
    toJson: (value) => ({ t: NativeType.Boolean, v: value.v }),
  },
  [NativeType.Number]: {
    fromJson: (json) => mkNumberValue(json.v as number),
    toJson: (value) => ({ t: NativeType.Number, v: value.v }),
  },
  [NativeType.String]: {
    fromJson: (json) => mkStringValue(json.v as string),
    toJson: (value) => ({ t: NativeType.String, v: value.v }),
  },
  [NativeType.Enum]: {
    fromJson: (json) => ({
      t: NativeType.Enum,
      typeId: json.typeId as string,
      v: json.v as string,
    }),
    toJson: (value) => ({ t: NativeType.Enum, typeId: value.typeId, v: value.v }),
  },
  [NativeType.List]: {
    fromJson: (json) =>
      mkListValue(json.typeId as string, listFromJson(json.v as readonly BrainProgramValueJson[], brainValueFromJson)),
    toJson: (value) => ({ t: NativeType.List, typeId: value.typeId, v: listToJson(value.v, brainValueToJson) }),
  },
  [NativeType.Map]: {
    fromJson: mapValueFromJson,
    toJson: mapValueToJson,
  },
  [NativeType.Struct]: {
    fromJson: (json) => ({
      t: NativeType.Struct,
      typeId: json.typeId as string,
      v: listFromJson((json.v ?? []) as readonly BrainProgramValueJson[], brainValueFromJson),
    }),
    toJson: structValueToJson,
  },
  [NativeType.Function]: {
    fromJson: (json) =>
      mkFunctionValue(
        json.funcId as number,
        json.captures === undefined
          ? undefined
          : listFromJson(json.captures as readonly BrainProgramValueJson[], brainValueFromJson)
      ),
    toJson: functionValueToJson,
  },
  [NativeType.Buffer]: {
    fromJson: (json) => mkBufferValueFromHex(json.v as string),
    toJson: (value) => ({ t: NativeType.Buffer, v: bufferToHex(value) }),
  },
  handle: {
    fromJson: (json) => ({
      t: "handle",
      id: json.id as number,
    }),
    toJson: (value) => ({ t: "handle", id: value.id }),
  },
  err: {
    fromJson: (json) => ({
      t: "err",
      e: errorValueFromJson(json.e as BrainProgramJsonObject),
    }),
    toJson: (value) => ({ t: "err", e: errorValueToJson(value.e) }),
  },
} satisfies RuntimeValueJsonCodecTable;

const RUNTIME_VALUE_JSON_CODECS_BY_TAG = RUNTIME_VALUE_JSON_CODECS as Readonly<
  Record<string | number, RuntimeValueJsonCodec | undefined>
>;

/**
 * Converts a JSON-safe brain value into the runtime {@link Value} shape.
 *
 * @param json - Serialized brain program value.
 */
export function brainValueFromJson(json: BrainProgramValueJson): Value {
  if (TypeUtils.isBoolean(json)) {
    return json ? TRUE_VALUE : FALSE_VALUE;
  }
  if (TypeUtils.isNumber(json)) {
    return mkNumberValue(json);
  }
  if (TypeUtils.isString(json)) {
    return mkStringValue(json);
  }
  if (!isBrainProgramJsonObject(json)) {
    return json as unknown as Value;
  }

  const typeTag = json.t;
  if (!TypeUtils.isNumber(typeTag) && !TypeUtils.isString(typeTag)) {
    return json as unknown as Value;
  }

  const codec = RUNTIME_VALUE_JSON_CODECS_BY_TAG[typeTag];
  return codec ? codec.fromJson(json) : (json as unknown as Value);
}

/**
 * Converts a runtime {@link Value} into its JSON-safe brain program form.
 *
 * @param value - Runtime value to serialize.
 */
export function brainValueToJson(value: Value): BrainProgramJsonObject {
  const codec = RUNTIME_VALUE_JSON_CODECS_BY_TAG[value.t];
  if (!codec) {
    throw new Error(`brainValueToJson: unsupported value tag ${value.t}`);
  }
  return codec.toJson(value);
}

function mapValueFromJson(json: BrainProgramJsonObject): MapValue {
  const entries = List.empty<readonly [string | number, Value]>();
  const sourceEntries = List.from(
    (json.v ?? []) as readonly {
      readonly key: string | number;
      readonly value: BrainProgramValueJson;
    }[]
  );

  for (let i = 0; i < sourceEntries.size(); i++) {
    const entry = sourceEntries.get(i)!;
    entries.push([entry.key, brainValueFromJson(entry.value)]);
  }

  return {
    t: NativeType.Map,
    typeId: json.typeId as string,
    v: new ValueDict(entries.toArray()),
  };
}

function mapValueToJson(value: MapValue): BrainProgramJsonObject {
  return {
    t: NativeType.Map,
    typeId: value.typeId,
    v: dictToJsonEntries(value.v, (key, entryValue) => ({ key, value: brainValueToJson(entryValue) })),
  };
}

function structValueToJson(value: StructValue): BrainProgramJsonObject {
  return {
    t: NativeType.Struct,
    typeId: value.typeId,
    v: value.v === undefined ? [] : listToJson(value.v, brainValueToJson),
  };
}

function functionValueToJson(value: FunctionValue): BrainProgramJsonObject {
  if (value.captures !== undefined) {
    return {
      t: NativeType.Function,
      funcId: value.funcId,
      captures: listToJson(value.captures, brainValueToJson),
    };
  }
  return { t: NativeType.Function, funcId: value.funcId };
}

function errorValueFromJson(json: BrainProgramJsonObject): ErrorValue {
  const errorValue: ErrorValue = {
    code: json.code as ErrorValue["code"],
    message: json.message as string,
  };

  if (json.detail !== undefined) {
    errorValue.detail = json.detail;
  }
  if (isBrainProgramJsonObject(json.site)) {
    errorValue.site = {
      funcId: json.site.funcId as number,
      pc: json.site.pc as number,
    };
  }
  if (TypeUtils.isArray(json.stackTrace)) {
    errorValue.stackTrace = List.from(json.stackTrace as readonly string[]);
  }

  return errorValue;
}

function errorValueToJson(errorValue: ErrorValue): BrainProgramJsonObject {
  const json: { [key: string]: BrainProgramJsonValue } = {
    code: errorValue.code,
    message: errorValue.message,
  };

  if (errorValue.detail !== undefined) {
    json.detail = errorValue.detail as BrainProgramJsonValue;
  }
  if (errorValue.site !== undefined) {
    json.site = { funcId: errorValue.site.funcId, pc: errorValue.site.pc };
  }
  if (errorValue.stackTrace !== undefined) {
    json.stackTrace = errorValue.stackTrace.toArray();
  }

  return json;
}

function isBrainProgramJsonObject(value: BrainProgramJsonValue): value is BrainProgramJsonObject {
  return TypeUtils.isObject(value) && !TypeUtils.isArray(value);
}
