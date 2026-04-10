import { List } from "../../platform/list";
import { StringUtils as SU } from "../../platform/string";
import { TypeUtils } from "../../platform/types";
import {
  CoreTypeIds,
  type ExecutionContext,
  type MapValue,
  mkCallDef,
  mkListValue,
  mkNumberValue,
  mkStringValue,
  type Value,
} from "../interfaces";
import type { BrainServices } from "../services";

const mapCallDef = mkCallDef({ type: "bag", items: [] });

export function registerMapBuiltins(services: BrainServices) {
  const { functions, types } = services;

  functions.register(
    "$$map_keys",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const map = args.v.get(0) as MapValue;
        const keyListTypeId = types.instantiate("List", List.from([CoreTypeIds.String]));
        const items = new List<Value>();
        const keys = map.v.keys();

        for (let i = 0; i < keys.size(); i++) {
          const key = keys.get(i);
          if (TypeUtils.isString(key)) {
            items.push(mkStringValue(key));
          } else if (TypeUtils.isNumber(key)) {
            items.push(mkStringValue(SU.toString(key)));
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
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const map = args.v.get(0) as MapValue;
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
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const map = args.v.get(0) as MapValue;
        return mkNumberValue(map.v.size());
      },
    },
    mapCallDef
  );

  functions.register(
    "$$map_clear",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const map = args.v.get(0) as MapValue;
        map.v.clear();
        return map;
      },
    },
    mapCallDef
  );
}
