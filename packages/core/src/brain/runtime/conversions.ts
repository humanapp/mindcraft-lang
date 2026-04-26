import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List } from "../../platform/list";
import { INFINITY, MathOps } from "../../platform/math";
import { StringUtils as SU } from "../../platform/string";
import { TypeUtils } from "../../platform/types";
import { UniqueSet } from "../../platform/uniqueset";
import {
  type BooleanValue,
  CoreTypeIds,
  type EnumTypeDef,
  type EnumValue,
  type ExecutionContext,
  type MapValue,
  mkCallDef,
  NativeType,
  type NumberValue,
  type StringValue,
  Value,
} from "../interfaces";
import type { Conversion, IConversionRegistry } from "../interfaces/conversions";
import type { IFunctionRegistry } from "../interfaces/functions";
import type { TypeId } from "../interfaces/type-system";
import type { BrainServices } from "../services";

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
   * @param conversion - The conversion to register, defining how to convert from one type to another
   */
  register(conv: Omit<Conversion, "id">): Conversion {
    const name = conversionFnName(conv.fromType, conv.toType);
    const existing = this.functions.get(name);
    if (existing) {
      throw new Error(`ConversionRegistry.register: conversion from ${conv.fromType} to ${conv.toType} already exists`);
    }
    const callDef = conv.callDef ?? anonConversionCallDef;
    const funcEntry = this.functions.register(name, false, conv.fn, callDef);
    const conversion: Conversion = { ...conv, id: funcEntry.id };

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

    this.functions.unregister(conversionFnName(fromType, toType));
    return true;
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

/** Register the implicit/explicit conversions for an enum type (string<->enum, number<->enum). */
export function registerEnumConversions(typeId: TypeId, services: BrainServices) {
  const enumType = services.types.get(typeId);
  if (!enumType || enumType.coreType !== NativeType.Enum) {
    throw new Error(`registerEnumConversions: type ${typeId} is not an enum`);
  }

  const enumDef = enumType as EnumTypeDef;
  const firstSymbol = enumDef.symbols.get(0);
  if (!firstSymbol) {
    return;
  }

  if (!services.conversions.get(typeId, CoreTypeIds.String)) {
    const stringCost = TypeUtils.isNumber(firstSymbol.value) ? 2 : 1;
    services.conversions.register({
      fromType: typeId,
      toType: CoreTypeIds.String,
      cost: stringCost,
      fn: {
        exec: (_ctx: ExecutionContext, args: MapValue) => {
          const value = resolveEnumPrimitiveValue(typeId, args, services);
          return {
            t: NativeType.String,
            v: TypeUtils.isString(value) ? value : SU.toString(value),
          };
        },
      },
    });
  }

  if (TypeUtils.isNumber(firstSymbol.value) && !services.conversions.get(typeId, CoreTypeIds.Number)) {
    services.conversions.register({
      fromType: typeId,
      toType: CoreTypeIds.Number,
      cost: 1,
      fn: {
        exec: (_ctx: ExecutionContext, args: MapValue) => {
          const value = resolveEnumPrimitiveValue(typeId, args, services);
          if (!TypeUtils.isNumber(value)) {
            throw new Error(`Enum conversion ${typeId} -> ${CoreTypeIds.Number} expected a numeric value`);
          }
          return {
            t: NativeType.Number,
            v: value,
          };
        },
      },
    });
  }
}

function resolveEnumPrimitiveValue(typeId: TypeId, args: MapValue, services: BrainServices): string | number {
  const enumValue = args.v.get(0) as EnumValue;
  if (enumValue.t !== NativeType.Enum || enumValue.typeId !== typeId) {
    throw new Error(`Enum conversion expected value of type ${typeId}`);
  }

  const symbol = services.types.getEnumSymbol(typeId, enumValue.v);
  if (!symbol) {
    throw new Error(`Unknown enum key ${enumValue.v} for type ${typeId}`);
  }

  return symbol.value;
}

/** Register the built-in conversions between core primitive types (number<->string, boolean<->number, etc.). */
export function registerCoreConversions(services: BrainServices) {
  const conversionRegistry = services.conversions;
  // Number -> String conversion
  conversionRegistry.register({
    fromType: CoreTypeIds.Number,
    toType: CoreTypeIds.String,
    cost: 2,
    fn: {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const numVal = args.v.get(0) as NumberValue;
        return {
          t: NativeType.String,
          v: SU.toString(numVal.v),
        };
      },
    },
  });
  // String -> Number conversion
  conversionRegistry.register({
    fromType: CoreTypeIds.String,
    toType: CoreTypeIds.Number,
    cost: 2,
    fn: {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const strVal = args.v.get(0) as StringValue;
        const num = MathOps.parseFloat(strVal.v);
        return {
          t: NativeType.Number,
          v: MathOps.isNaN(num) ? 0 : num,
        };
      },
    },
  });
  // Number -> Boolean conversion
  conversionRegistry.register({
    fromType: CoreTypeIds.Number,
    toType: CoreTypeIds.Boolean,
    cost: 1,
    fn: {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const numVal = args.v.get(0) as NumberValue;
        return {
          t: NativeType.Boolean,
          v: numVal.v !== 0,
        };
      },
    },
  });
  // Boolean -> Number conversion
  conversionRegistry.register({
    fromType: CoreTypeIds.Boolean,
    toType: CoreTypeIds.Number,
    cost: 1,
    fn: {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const boolVal = args.v.get(0) as BooleanValue;
        return {
          t: NativeType.Number,
          v: boolVal.v ? 1 : 0,
        };
      },
    },
  });
  // String -> Boolean conversion
  conversionRegistry.register({
    fromType: CoreTypeIds.String,
    toType: CoreTypeIds.Boolean,
    cost: 2,
    fn: {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const strVal = args.v.get(0) as StringValue;
        return {
          t: NativeType.Boolean,
          v: SU.length(SU.trim(strVal.v)) > 0,
        };
      },
    },
  });
  // Boolean -> String conversion
  conversionRegistry.register({
    fromType: CoreTypeIds.Boolean,
    toType: CoreTypeIds.String,
    cost: 1,
    fn: {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const boolVal = args.v.get(0) as BooleanValue;
        return {
          t: NativeType.String,
          v: boolVal.v ? "true" : "false",
        };
      },
    },
  });
}
