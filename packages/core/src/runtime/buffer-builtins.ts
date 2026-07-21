import type { BrainServices } from "../brain/services";
import type { ReadonlyList } from "../platform/list";
import { byteArrayFromStringLatin1 } from "../platform/stream";
import { StringUtils as SU } from "../platform/string";
import { CoreFuncId } from "./abi-ids";
import type { ExecutionContext } from "./context";
import { mkCallDef } from "./function-defs";
import { NativeType } from "./type-defs";
import {
  type BufferValue,
  bufferByteAt,
  bufferLength,
  mkBufferValue,
  mkBufferValueFromHex,
  mkNumberValue,
  NIL_VALUE,
  type NumberValue,
  type StringValue,
  type Value,
} from "./value";

const bufferCallDef = mkCallDef({ type: "bag", items: [] });

function buf(args: ReadonlyList<Value>, index: number): BufferValue {
  return args.get(index) as BufferValue;
}

function num(args: ReadonlyList<Value>, index: number): number {
  return (args.get(index) as NumberValue).v;
}

function str(args: ReadonlyList<Value>, index: number): string {
  return (args.get(index) as StringValue).v;
}

/** Register the built-in buffer constructors and accessors (`$$buf_from`, etc.) on `services.runtime.functions`. */
export function registerBufferBuiltins(services: BrainServices) {
  const { functions } = services.runtime;

  functions.register(
    CoreFuncId.BufferFrom,
    "$$buf_from",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const list = args.get(0);
        let latin1 = "";
        if (list && list.t === NativeType.List) {
          list.v.forEach((item) => {
            const byte = item.t === NativeType.Number ? item.v & 0xff : 0;
            latin1 += SU.fromCharCode(byte);
          });
        }
        return mkBufferValue(byteArrayFromStringLatin1(latin1));
      },
    },
    bufferCallDef
  );

  functions.register(
    CoreFuncId.BufferFromHex,
    "$$buf_fromHex",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkBufferValueFromHex(str(args, 0)),
    },
    bufferCallDef
  );

  functions.register(
    CoreFuncId.BufferFromString,
    "$$buf_fromString",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) =>
        mkBufferValue(byteArrayFromStringLatin1(str(args, 0))),
    },
    bufferCallDef
  );

  functions.register(
    CoreFuncId.BufferLength,
    "$$buf_length",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(bufferLength(buf(args, 0))),
    },
    bufferCallDef
  );

  functions.register(
    CoreFuncId.BufferGet,
    "$$buf_get",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const byte = bufferByteAt(buf(args, 0), num(args, 1));
        return byte === undefined ? NIL_VALUE : mkNumberValue(byte);
      },
    },
    bufferCallDef
  );
}
