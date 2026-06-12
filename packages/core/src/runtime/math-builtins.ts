import type { BrainServices } from "../brain/services";
import type { ReadonlyList } from "../platform/list";
import { MathOps } from "../platform/math";
import { CoreFuncId } from "./abi-ids";
import type { ExecutionContext } from "./context";
import { CoreTypeIds } from "./core-types";
import { mkCallDef } from "./function-defs";
import { mkNumberValue, type NumberValue, type Value } from "./value";

const mathCallDef = mkCallDef({ type: "bag", items: [] });

function num(args: ReadonlyList<Value>, index: number): number {
  return (args.get(index) as NumberValue).v;
}

/**
 * Register the built-in math functions on `services.runtime.functions`.
 * Transcendental and square-root bodies capture `services.app.numerics`
 * and compute results at the profile's precision; the exact builtins
 * (abs, ceil, floor, round, min, max) stay on the platform math ops.
 */
export function registerMathBuiltins(services: BrainServices) {
  const { functions } = services.runtime;
  const numerics = services.app.numerics;

  functions.register(
    CoreFuncId.MathAbs,
    "$$math_abs",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.abs(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathAcos,
    "$$math_acos",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(numerics.acos(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathAsin,
    "$$math_asin",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(numerics.asin(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathAtan,
    "$$math_atan",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(numerics.atan(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathAtan2,
    "$$math_atan2",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) =>
        mkNumberValue(numerics.atan2(num(args, 0), num(args, 1))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathCeil,
    "$$math_ceil",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.ceil(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathCos,
    "$$math_cos",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(numerics.cos(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathExp,
    "$$math_exp",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(numerics.exp(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathFloor,
    "$$math_floor",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.floor(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathLog,
    "$$math_log",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(numerics.log(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathMax,
    "$$math_max",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) =>
        mkNumberValue(MathOps.max(num(args, 0), num(args, 1))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathMin,
    "$$math_min",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) =>
        mkNumberValue(MathOps.min(num(args, 0), num(args, 1))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathPow,
    "$$math_pow",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) =>
        mkNumberValue(numerics.pow(num(args, 0), num(args, 1))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathRandom,
    "$$math_random",
    false,
    {
      exec: () => mkNumberValue(MathOps.random()),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathRound,
    "$$math_round",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(MathOps.round(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathSin,
    "$$math_sin",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(numerics.sin(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathSqrt,
    "$$math_sqrt",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(numerics.sqrt(num(args, 0))),
    },
    mathCallDef
  );

  functions.register(
    CoreFuncId.MathTan,
    "$$math_tan",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => mkNumberValue(numerics.tan(num(args, 0))),
    },
    mathCallDef
  );
}
