import { List, type ReadonlyList } from "../../platform/list";
import { TypeUtils } from "../../platform/types";
import {
  CoreTypeIds,
  type ExecutionContext,
  type MapTypeDef,
  type MapValue,
  mkCallDef,
  mkListValue,
  mkNumberValue,
  mkStringValue,
  type Value,
} from "../interfaces";
import type { BrainServices } from "../services";

const mapCallDef = mkCallDef({ type: "bag", items: [] });

/** Register the built-in map operations on `services.functions`. */
export function registerMapBuiltins(services: BrainServices) {
  const { functions, types } = services;

  functions.register(
    "$$map_keys",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const map = args.get(0) as MapValue;
        const mapDef = types.get(map.typeId) as MapTypeDef | undefined;
        const keyTypeId = mapDef?.keyTypeId ?? CoreTypeIds.String;
        const keyListTypeId = types.instantiate("List", List.from([keyTypeId]));
        const items = new List<Value>();
        const keys = map.v.keys();

        for (let i = 0; i < keys.size(); i++) {
          const key = keys.get(i);
          if (TypeUtils.isNumber(key)) {
            items.push(mkNumberValue(key));
          } else if (TypeUtils.isString(key)) {
            items.push(mkStringValue(key));
          }
        }

        return mkListValue(keyListTypeId, items);
      },
    },
    mapCallDef
  );

  functions.register(
    "$$map_values",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const map = args.get(0) as MapValue;
        const valueListTypeId = types.instantiate("List", List.from([CoreTypeIds.Any]));
        const items = new List<Value>();
        const values = map.v.values();

        for (let i = 0; i < values.size(); i++) {
          items.push(values.get(i));
        }

        return mkListValue(valueListTypeId, items);
      },
    },
    mapCallDef
  );

  functions.register(
    "$$map_size",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const map = args.get(0) as MapValue;
        return mkNumberValue(map.v.size());
      },
    },
    mapCallDef
  );

  functions.register(
    "$$map_clear",
    false,
    {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const map = args.get(0) as MapValue;
        map.v.clear();
        return map;
      },
    },
    mapCallDef
  );
}
