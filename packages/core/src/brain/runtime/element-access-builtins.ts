import { INFINITY, MathOps } from "../../platform/math";
import { StringUtils as SU } from "../../platform/string";
import {
  type ExecutionContext,
  type ListValue,
  type MapValue,
  mkCallDef,
  mkNumberValue,
  mkStringValue,
  NativeType,
  NIL_VALUE,
  type StringValue,
  type Value,
} from "../interfaces";
import type { BrainServices } from "../services";

const elementAccessCallDef = mkCallDef({ type: "bag", items: [] });

function isArrayIndexNumber(value: number): boolean {
  return !MathOps.isNaN(value) && value >= 0 && value < INFINITY && MathOps.floor(value) === value;
}

function parseArrayIndexString(key: string): number | undefined {
  const length = SU.length(key);
  if (length === 0) return undefined;

  let value = 0;
  for (let i = 0; i < length; i++) {
    const code = SU.charCodeAt(key, i);
    if (code < 48 || code > 57) {
      return undefined;
    }
    if (i === 0 && length > 1 && code === 48) {
      return undefined;
    }
    value = value * 10 + (code - 48);
  }

  return value;
}

function readListIndex(list: ListValue, index: number): Value {
  return list.v.get(index) ?? NIL_VALUE;
}

function readStringIndex(source: string, index: number): Value {
  return index < SU.length(source) ? mkStringValue(SU.charAt(source, index)) : NIL_VALUE;
}

function listGetJs(list: ListValue, key: Value | undefined): Value {
  if (!key) return NIL_VALUE;

  if (key.t === NativeType.Number) {
    return isArrayIndexNumber(key.v) ? readListIndex(list, key.v) : NIL_VALUE;
  }

  if (key.t === NativeType.String) {
    if (key.v === "length") {
      return mkNumberValue(list.v.size());
    }

    const index = parseArrayIndexString(key.v);
    return index !== undefined ? readListIndex(list, index) : NIL_VALUE;
  }

  return NIL_VALUE;
}

function stringGetJs(source: string, key: Value | undefined): Value {
  if (!key) return NIL_VALUE;

  if (key.t === NativeType.Number) {
    return isArrayIndexNumber(key.v) ? readStringIndex(source, key.v) : NIL_VALUE;
  }

  if (key.t === NativeType.String) {
    if (key.v === "length") {
      return mkNumberValue(SU.length(source));
    }

    const index = parseArrayIndexString(key.v);
    return index !== undefined ? readStringIndex(source, index) : NIL_VALUE;
  }

  return NIL_VALUE;
}

export function registerElementAccessBuiltins(services: BrainServices) {
  const { functions } = services;

  functions.register(
    "$$list_get_js",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const list = args.v.get(0);
        if (!list || list.t !== NativeType.List) {
          return NIL_VALUE;
        }
        return listGetJs(list as ListValue, args.v.get(1));
      },
    },
    elementAccessCallDef
  );

  functions.register(
    "$$str_get_js",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const source = args.v.get(0);
        if (!source || source.t !== NativeType.String) {
          return NIL_VALUE;
        }
        return stringGetJs((source as StringValue).v, args.v.get(1));
      },
    },
    elementAccessCallDef
  );
}
