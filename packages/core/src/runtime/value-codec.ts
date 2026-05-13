import { List } from "../platform/list";
import { TypeUtils } from "../platform/types";
import { listFromJson } from "./json-container-codec";
import { NativeType } from "./type-defs";
import {
  type ErrorValue,
  FALSE_VALUE,
  type MapValue,
  mkFunctionValue,
  mkListValue,
  mkNumberValue,
  mkStringValue,
  NIL_VALUE,
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

type BrainProgramJsonObject = { readonly [key: string]: BrainProgramJsonValue };

interface RuntimeValueJsonCodec<TValue extends Value = Value> {
  readonly fromJson: (json: BrainProgramJsonObject) => TValue;
}

type RuntimeValueJsonCodecTable = {
  readonly [TTag in RuntimeValueTag]: RuntimeValueJsonCodec<Extract<Value, { t: TTag }>>;
};

const RUNTIME_VALUE_JSON_CODECS = {
  [NativeType.Unknown]: {
    fromJson: () => UNKNOWN_VALUE,
  },
  [NativeType.Void]: {
    fromJson: () => VOID_VALUE,
  },
  [NativeType.Nil]: {
    fromJson: () => NIL_VALUE,
  },
  [NativeType.Boolean]: {
    fromJson: (json) => (json.v === true ? TRUE_VALUE : FALSE_VALUE),
  },
  [NativeType.Number]: {
    fromJson: (json) => mkNumberValue(json.v as number),
  },
  [NativeType.String]: {
    fromJson: (json) => mkStringValue(json.v as string),
  },
  [NativeType.Enum]: {
    fromJson: (json) => ({
      t: NativeType.Enum,
      typeId: json.typeId as string,
      v: json.v as string,
    }),
  },
  [NativeType.List]: {
    fromJson: (json) =>
      mkListValue(json.typeId as string, listFromJson(json.v as readonly BrainProgramValueJson[], brainValueFromJson)),
  },
  [NativeType.Map]: {
    fromJson: mapValueFromJson,
  },
  [NativeType.Struct]: {
    fromJson: (json) => ({
      t: NativeType.Struct,
      typeId: json.typeId as string,
      v: listFromJson((json.v ?? []) as readonly BrainProgramValueJson[], brainValueFromJson),
    }),
  },
  [NativeType.Function]: {
    fromJson: (json) =>
      mkFunctionValue(
        json.funcId as number,
        json.captures === undefined
          ? undefined
          : listFromJson(json.captures as readonly BrainProgramValueJson[], brainValueFromJson)
      ),
  },
  handle: {
    fromJson: (json) => ({
      t: "handle",
      id: json.id as number,
    }),
  },
  err: {
    fromJson: (json) => ({
      t: "err",
      e: errorValueFromJson(json.e as BrainProgramJsonObject),
    }),
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

function isBrainProgramJsonObject(value: BrainProgramJsonValue): value is BrainProgramJsonObject {
  return TypeUtils.isObject(value) && !TypeUtils.isArray(value);
}
