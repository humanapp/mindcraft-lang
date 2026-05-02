import type { ReadonlyList } from "../../platform/list";
import { MathOps } from "../../platform/math";
import {
  CoreTypeIds,
  type ExecutionContext,
  mkCallDef,
  mkNumberValue,
  type NumberValue,
  type Value,
} from "../interfaces";
import type { BrainServices } from "../services";

const mathCallDef = mkCallDef({ type: "bag", items: [] });

function num(args: ReadonlyList<Value>, index: number): number {
  return (args.get(index) as NumberValue).v;
}

/** Register the built-in math functions on `services.functions`. */
export function registerMathBuiltins(services: BrainServices) {
  const { functions } = services;

  functions.register(
    "$$math_abs",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.abs(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_acos",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.acos(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_asin",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.asin(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_atan",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.atan(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_atan2",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) =>
        mkNumberValue(MathOps.atan2(num(args, 0), num(args, 1))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_ceil",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.ceil(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_cos",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.cos(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_exp",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.exp(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_floor",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.floor(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_log",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.log(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_max",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) =>
        mkNumberValue(MathOps.max(num(args, 0), num(args, 1))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_min",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) =>
        mkNumberValue(MathOps.min(num(args, 0), num(args, 1))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_pow",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) =>
        mkNumberValue(MathOps.pow(num(args, 0), num(args, 1))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_random",
    false,
    {
      exec: () => mkNumberValue(MathOps.random()),
    },
    mathCallDef
  );

  functions.register(
    "$$math_round",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.round(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_sin",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.sin(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_sqrt",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.sqrt(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    "$$math_tan",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.tan(num(args, 0))),
    },
    mathCallDef
  );
}
