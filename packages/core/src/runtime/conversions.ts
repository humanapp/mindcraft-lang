import type { BrainServices } from "../brain/services";
import { Dict } from "../platform/dict";
import { Error } from "../platform/error";
import { List, type ReadonlyList } from "../platform/list";
import { INFINITY } from "../platform/math";
import { StringUtils as SU } from "../platform/string";
import { TypeUtils } from "../platform/types";
import { UniqueSet } from "../platform/uniqueset";
import { CoreFuncId } from "./abi-ids";
import type { ExecutionContext } from "./context";
import type { Conversion, IConversionRegistry } from "./conversion-defs";
import { isBytecodeConversion, isSharedHostFnConversion } from "./conversion-defs";
import { CoreTypeIds } from "./core-types";
import type { IFunctionRegistry } from "./function-defs";
import { mkCallDef } from "./function-defs";
import { type EnumPrimitiveValue, type EnumTypeDef, NativeType, type TypeId } from "./type-defs";
import type { BooleanValue, NumberValue, StringValue, Value } from "./value";

/** Build the host function name used to register a conversion from `fromType` to `toType`. */
export function conversionFnName(fromType: TypeId, toType: TypeId): string {
  return `$$conv_${fromType}_to_${toType}`;
}

/**
 * Registry for managing type conversions in the tile system.
 * Provides methods to register conversions and find optimal conversion paths between types.
 */
export class ConversionRegistry implements IConversionRegistry {
  private conversions = new Dict<TypeId, Dict<TypeId, Conversion>>();

  constructor(private readonly functions: IFunctionRegistry) {}

  /**
   * Registers a new conversion in the registry.
   * @param conv - The conversion to register, defining how to convert from one type to another
   */
  register(conv: Conversion): Conversion {
    if (this.conversions.get(conv.fromType)?.get(conv.toType)) {
      throw new Error(`ConversionRegistry.register: conversion from ${conv.fromType} to ${conv.toType} already exists`);
    }
    if (isSharedHostFnConversion(conv)) {
      if (!this.functions.getSyncById(conv.id)) {
        throw new Error(
          `ConversionRegistry.register: conversion from ${conv.fromType} to ${conv.toType} references unregistered shared host function ${conv.id}`
        );
      }
    } else if (!isBytecodeConversion(conv)) {
      const name = conversionFnName(conv.fromType, conv.toType);
      const callDef = conv.callDef ?? anonConversionCallDef;
      this.functions.register(conv.id, name, false, conv.fn, callDef);
    }
    const conversion: Conversion = { ...conv };

    // Store in conversions map for pathfinding
    if (!this.conversions.has(conversion.fromType)) {
      this.conversions.set(conversion.fromType, new Dict());
    }
    this.conversions.get(conversion.fromType)!.set(conversion.toType, conversion);

    return conversion;
  }

  remove(fromType: TypeId, toType: TypeId): boolean {
    const fromDict = this.conversions.get(fromType);
    const existing = fromDict?.get(toType);
    if (!fromDict || !existing) {
      return false;
    }

    fromDict.delete(toType);
    if (fromDict.isEmpty()) {
      this.conversions.delete(fromType);
    }

    // Shared host functions outlive the conversion entries referencing them.
    if (!isBytecodeConversion(existing) && !isSharedHostFnConversion(existing)) {
      this.functions.unregister(conversionFnName(fromType, toType));
    }
    return true;
  }

  forEach(callback: (conv: Conversion) => void): void {
    this.conversions.forEach((toDict) => {
      toDict.forEach((conversion) => {
        callback(conversion);
      });
    });
  }

  get(fromType: TypeId, toType: TypeId): Conversion | undefined {
    const fromDict = this.conversions.get(fromType);
    if (fromDict) {
      return fromDict.get(toType);
    }
    return undefined;
  }

  /**
   * Finds the best (lowest cost) conversion path between two types using breadth-first search.
   * Returns an empty list if the types are the same, or undefined if no path exists.
   *
   * This is a graph search where types are nodes and registered conversions are edges.
   * Each edge has a cost; BFS explores all paths by cost to find the cheapest.
   */
  findBestPath(fromType: TypeId, toType: TypeId, maxDepth?: number): List<Conversion> | undefined {
    if (fromType === toType) {
      return new List<Conversion>();
    }

    // BFS with cost tracking to find the shortest/cheapest path
    interface PathNode {
      type: TypeId;
      path: List<Conversion>;
      cost: number;
    }

    const queue = new List<PathNode>();
    const visited = new UniqueSet<TypeId>();
    const costs = new Dict<TypeId, number>();

    queue.push({ type: fromType, path: new List<Conversion>(), cost: 0 });
    visited.add(fromType);
    costs.set(fromType, 0);

    let bestPath: List<Conversion> | undefined;
    let bestCost = INFINITY;

    while (queue.size() > 0) {
      const current = queue.shift()!;

      // If we found the target, check if it's better than previous paths
      if (current.type === toType) {
        if (current.cost < bestCost) {
          bestCost = current.cost;
          bestPath = current.path;
        }
        continue;
      }

      // Check if we've exceeded max depth -- don't explore further
      if (maxDepth !== undefined && current.path.size() >= maxDepth) {
        continue;
      }

      // Explore neighbors
      const neighbors = this.conversions.get(current.type);
      if (neighbors) {
        const entries = neighbors.entries();
        for (let i = 0; i < entries.size(); i++) {
          const [nextType, conversion] = entries.get(i);
          const newCost = current.cost + (conversion.cost ?? 1);
          const existingCost = costs.get(nextType);

          // Only visit if we haven't visited or found a cheaper path
          if (!visited.has(nextType) || (existingCost !== undefined && newCost < existingCost)) {
            const newPath = new List<Conversion>();
            for (let j = 0; j < current.path.size(); j++) {
              newPath.push(current.path.get(j));
            }
            newPath.push(conversion);

            queue.push({ type: nextType, path: newPath, cost: newCost });
            visited.add(nextType);
            costs.set(nextType, newCost);
          }
        }
      }
    }

    return bestPath;
  }
}

const anonConversionCallDef = mkCallDef({
  type: "arg",
  tileId: "",
  anonymous: true,
});

/**
 * Register the conversion entries for an enum type (enum->string, and
 * enum->number for numeric-valued enums). Both entries reference the shared
 * core enum-conversion host functions (`CoreFuncId.ConvEnumToString` /
 * `CoreFuncId.ConvEnumToNumber`), which resolve the symbol's primitive value
 * at runtime.
 */
export function registerEnumConversions(typeId: TypeId, services: BrainServices) {
  const enumType = services.runtime.types.get(typeId);
  if (!enumType || enumType.coreType !== NativeType.Enum) {
    throw new Error(`registerEnumConversions: type ${typeId} is not an enum`);
  }

  const enumDef = enumType as EnumTypeDef;
  const firstSymbol = enumDef.symbols.at(0);
  if (!firstSymbol) {
    return;
  }

  if (!services.shared.conversions.get(typeId, CoreTypeIds.String)) {
    const stringCost = TypeUtils.isNumber(firstSymbol.value) ? 2 : 1;
    services.shared.conversions.register({
      binding: "sharedHostFn",
      id: CoreFuncId.ConvEnumToString,
      fromType: typeId,
      toType: CoreTypeIds.String,
      cost: stringCost,
    });
  }

  if (TypeUtils.isNumber(firstSymbol.value) && !services.shared.conversions.get(typeId, CoreTypeIds.Number)) {
    services.shared.conversions.register({
      binding: "sharedHostFn",
      id: CoreFuncId.ConvEnumToNumber,
      fromType: typeId,
      toType: CoreTypeIds.Number,
      cost: 1,
    });
  }
}

/**
 * Resolve an enum value's declared primitive value: through the runtime type
 * registry for registered (core/target and compile-session) enum types, else
 * through the loaded program's type table for program-local enums. Throws
 * when the operand is not an enum value or its symbol resolves nowhere.
 */
function resolveEnumSymbolValue(ctx: ExecutionContext, value: Value): EnumPrimitiveValue {
  if (value.t !== NativeType.Enum) {
    throw new Error("Enum conversion expected an enum value");
  }

  const symbol = ctx.services.runtime.types.getEnumSymbol(value.typeId, value.v);
  if (symbol) {
    return symbol.value;
  }

  const programValue = ctx.services.brain.program.getEnumSymbolValue(value.typeId, value.v);
  if (programValue === undefined) {
    throw new Error(`Unknown enum key ${value.v} for type ${value.typeId}`);
  }
  return programValue;
}

/**
 * Register the built-in conversions between core primitive types
 * (number<->string, boolean<->number, etc.) and the shared enum-conversion
 * host functions referenced by every enum type's conversion entries.
 */
export function registerCoreConversions(services: BrainServices) {
  const conversionRegistry = services.shared.conversions;
  const numerics = services.app.numerics;

  // Shared host functions for enum->string / enum->number: every enum type's
  // conversion entries dispatch to these two ids. The symbol's declared
  // primitive value resolves at runtime through the executing VM's registry
  // or the loaded program's type table.
  services.runtime.functions.register(
    CoreFuncId.ConvEnumToString,
    "$$conv_enum_to_string",
    false,
    {
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const value = resolveEnumSymbolValue(ctx, args.get(0));
        return {
          t: NativeType.String,
          v: TypeUtils.isString(value) ? value : ctx.services.app.numerics.formatNumber(value),
        };
      },
    },
    anonConversionCallDef
  );
  services.runtime.functions.register(
    CoreFuncId.ConvEnumToNumber,
    "$$conv_enum_to_number",
    false,
    {
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const value = resolveEnumSymbolValue(ctx, args.get(0));
        if (!TypeUtils.isNumber(value)) {
          throw new Error(`Enum conversion to number expected a numeric value, got key ${value}`);
        }
        return {
          t: NativeType.Number,
          v: ctx.services.app.numerics.round(value),
        };
      },
    },
    anonConversionCallDef
  );
  // Number -> String conversion
  conversionRegistry.register({
    id: CoreFuncId.ConvNumberToString,
    fromType: CoreTypeIds.Number,
    toType: CoreTypeIds.String,
    cost: 2,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const numVal = args.get(0) as NumberValue;
        return {
          t: NativeType.String,
          v: numerics.formatNumber(numVal.v),
        };
      },
    },
  });
  // String -> Number conversion
  conversionRegistry.register({
    id: CoreFuncId.ConvStringToNumber,
    fromType: CoreTypeIds.String,
    toType: CoreTypeIds.Number,
    cost: 2,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const strVal = args.get(0) as StringValue;
        return {
          t: NativeType.Number,
          v: numerics.parseNumber(strVal.v),
        };
      },
    },
  });
  // Number -> Boolean conversion
  conversionRegistry.register({
    id: CoreFuncId.ConvNumberToBoolean,
    fromType: CoreTypeIds.Number,
    toType: CoreTypeIds.Boolean,
    cost: 1,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const numVal = args.get(0) as NumberValue;
        return {
          t: NativeType.Boolean,
          v: numVal.v !== 0,
        };
      },
    },
  });
  // Boolean -> Number conversion
  conversionRegistry.register({
    id: CoreFuncId.ConvBooleanToNumber,
    fromType: CoreTypeIds.Boolean,
    toType: CoreTypeIds.Number,
    cost: 1,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const boolVal = args.get(0) as BooleanValue;
        return {
          t: NativeType.Number,
          v: boolVal.v ? 1 : 0,
        };
      },
    },
  });
  // String -> Boolean conversion
  conversionRegistry.register({
    id: CoreFuncId.ConvStringToBoolean,
    fromType: CoreTypeIds.String,
    toType: CoreTypeIds.Boolean,
    cost: 2,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const strVal = args.get(0) as StringValue;
        return {
          t: NativeType.Boolean,
          v: SU.length(SU.trim(strVal.v)) > 0,
        };
      },
    },
  });
  // Boolean -> String conversion
  conversionRegistry.register({
    id: CoreFuncId.ConvBooleanToString,
    fromType: CoreTypeIds.Boolean,
    toType: CoreTypeIds.String,
    cost: 1,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const boolVal = args.get(0) as BooleanValue;
        return {
          t: NativeType.String,
          v: boolVal.v ? "true" : "false",
        };
      },
    },
  });
}
