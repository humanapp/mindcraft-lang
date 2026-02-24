import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List } from "../../platform/list";
import { INFINITY, MathOps } from "../../platform/math";
import { StringUtils as SU } from "../../platform/string";
import { UniqueSet } from "../../platform/uniqueset";
import {
  type BooleanValue,
  CoreTypeIds,
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
import { getBrainServices } from "../services";

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
    const conversion = conv as unknown as Conversion;
    const name = `$$conv_${conversion.fromType}_to_${conversion.toType}`;
    const existing = this.functions.get(name);
    if (existing) {
      throw new Error(
        `ConversionRegistry.register: conversion from ${conversion.fromType} to ${conversion.toType} already exists`
      );
    }
    const funcEntry = this.functions.register(name, false, conversion.fn, conversion.callDef);
    conversion.id = funcEntry.id;

    // Store in conversions map for pathfinding
    if (!this.conversions.has(conversion.fromType)) {
      this.conversions.set(conversion.fromType, new Dict());
    }
    this.conversions.get(conversion.fromType)!.set(conversion.toType, conversion);

    return conversion;
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
   * @param fromType - The source type ID to convert from
   * @param toType - The target type ID to convert to
   * @param maxDepth - Optional maximum path depth to limit the search
   * @returns A list of conversions representing the optimal path, or undefined if no path exists
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

const anonNumberCallDef = mkCallDef({
  type: "arg",
  tileId: "",
  anonymous: true,
});

const anonStringCallDef = mkCallDef({
  type: "arg",
  tileId: "",
  anonymous: true,
});

const anonBooleanCallDef = mkCallDef({
  type: "arg",
  tileId: "",
  anonymous: true,
});

export function registerCoreConversions() {
  const conversionRegistry = getBrainServices().conversions;
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
    callDef: anonNumberCallDef,
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
    callDef: anonStringCallDef,
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
    callDef: anonNumberCallDef,
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
    callDef: anonBooleanCallDef,
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
    callDef: anonStringCallDef,
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
    callDef: anonBooleanCallDef,
  });
}
