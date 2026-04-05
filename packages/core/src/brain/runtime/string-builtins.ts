import { List } from "../../platform/list";
import { StringUtils as SU } from "../../platform/string";
import {
  CoreTypeIds,
  type ExecutionContext,
  type MapValue,
  mkCallDef,
  mkListValue,
  mkNumberValue,
  mkStringValue,
  NativeType,
  type NumberValue,
  type StringValue,
  type Value,
} from "../interfaces";
import type { BrainServices } from "../services";

const strCallDef = mkCallDef({ type: "bag", items: [] });

function str(args: MapValue, index: number): string {
  return (args.v.get(index) as StringValue).v;
}

function num(args: MapValue, index: number): number {
  return (args.v.get(index) as NumberValue).v;
}

function optNum(args: MapValue, index: number): number | undefined {
  const val = args.v.get(index);
  if (val === undefined || val.t === NativeType.Nil) return undefined;
  return (val as NumberValue).v;
}

export function registerStringBuiltins(services: BrainServices) {
  const { functions, types } = services;

  functions.register(
    "$$str_length",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => mkNumberValue(SU.length(str(args, 0))),
    },
    strCallDef
  );

  functions.register(
    "$$str_charAt",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => mkStringValue(SU.charAt(str(args, 0), num(args, 1))),
    },
    strCallDef
  );

  functions.register(
    "$$str_charCodeAt",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => mkNumberValue(SU.charCodeAt(str(args, 0), num(args, 1))),
    },
    strCallDef
  );

  functions.register(
    "$$str_indexOf",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) =>
        mkNumberValue(SU.indexOf(str(args, 0), str(args, 1), optNum(args, 2))),
    },
    strCallDef
  );

  functions.register(
    "$$str_lastIndexOf",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) =>
        mkNumberValue(SU.lastIndexOf(str(args, 0), str(args, 1), optNum(args, 2))),
    },
    strCallDef
  );

  functions.register(
    "$$str_slice",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) =>
        mkStringValue(SU.slice(str(args, 0), optNum(args, 1), optNum(args, 2))),
    },
    strCallDef
  );

  functions.register(
    "$$str_substring",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) =>
        mkStringValue(SU.substring(str(args, 0), num(args, 1), optNum(args, 2))),
    },
    strCallDef
  );

  functions.register(
    "$$str_toLowerCase",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => mkStringValue(SU.toLowerCase(str(args, 0))),
    },
    strCallDef
  );

  functions.register(
    "$$str_toUpperCase",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => mkStringValue(SU.toUpperCase(str(args, 0))),
    },
    strCallDef
  );

  functions.register(
    "$$str_trim",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => mkStringValue(SU.trim(str(args, 0))),
    },
    strCallDef
  );

  functions.register(
    "$$str_split",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const parts = SU.split(str(args, 0), str(args, 1), optNum(args, 2));
        const listTypeId = types.instantiate("List", List.from([CoreTypeIds.String]));
        const items = new List<Value>();
        for (const part of parts) {
          items.push(mkStringValue(part));
        }
        return mkListValue(listTypeId, items);
      },
    },
    strCallDef
  );

  functions.register(
    "$$str_concat",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        let result = str(args, 0);
        let i = 1;
        let arg = args.v.get(i);
        while (arg !== undefined && arg.t !== NativeType.Nil) {
          result += (arg as StringValue).v;
          i++;
          arg = args.v.get(i);
        }
        return mkStringValue(result);
      },
    },
    strCallDef
  );
}
