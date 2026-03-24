import { List } from "../../platform/list";
import {
  CoreTypeIds,
  type ExecutionContext,
  type MapValue,
  mkCallDef,
  mkNativeStructValue,
  mkNumberValue,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type StringValue,
  type StructValue,
  type Value,
} from "../interfaces";
import { getBrainServices } from "../services";

export const ContextTypeNames = {
  Context: "Context",
  SelfContext: "SelfContext",
  EngineContext: "EngineContext",
};

export const ContextTypeIds = {
  Context: mkTypeId(NativeType.Struct, ContextTypeNames.Context),
  SelfContext: mkTypeId(NativeType.Struct, ContextTypeNames.SelfContext),
  EngineContext: mkTypeId(NativeType.Struct, ContextTypeNames.EngineContext),
};

export function registerContextTypes() {
  const { types, functions } = getBrainServices();

  const selfContextTypeId = types.addStructType(ContextTypeNames.SelfContext, {
    fields: List.empty(),
    fieldGetter: () => undefined,
    methods: List.from([
      {
        name: "getVariable",
        params: List.from([{ name: "name", typeId: CoreTypeIds.String }]),
        returnTypeId: CoreTypeIds.Any,
      },
      {
        name: "setVariable",
        params: List.from([
          { name: "name", typeId: CoreTypeIds.String },
          { name: "value", typeId: CoreTypeIds.Any },
        ]),
        returnTypeId: CoreTypeIds.Void,
      },
    ]),
  });

  const engineContextTypeId = types.addStructType(ContextTypeNames.EngineContext, {
    fields: List.empty(),
    fieldGetter: () => undefined,
  });

  types.addStructType(ContextTypeNames.Context, {
    fields: List.from([
      { name: "time", typeId: CoreTypeIds.Number },
      { name: "dt", typeId: CoreTypeIds.Number },
      { name: "tick", typeId: CoreTypeIds.Number },
      { name: "self", typeId: selfContextTypeId },
      { name: "engine", typeId: engineContextTypeId },
    ]),
    fieldGetter: (source: StructValue, fieldName: string) => {
      const execCtx = source.native as ExecutionContext;
      switch (fieldName) {
        case "time":
          return mkNumberValue(execCtx.time);
        case "dt":
          return mkNumberValue(execCtx.dt);
        case "tick":
          return mkNumberValue(execCtx.currentTick);
        case "self":
          return mkNativeStructValue(selfContextTypeId, execCtx);
        case "engine":
          return mkNativeStructValue(engineContextTypeId, execCtx);
        default:
          return undefined;
      }
    },
  });

  const emptyCallDef = mkCallDef({ type: "bag", items: [] });

  functions.register(
    "SelfContext.getVariable",
    false,
    {
      exec: (ctx: ExecutionContext, args: MapValue) => {
        const name = (args.v.get(1) as StringValue).v;
        return ctx.getVariable(name) ?? NIL_VALUE;
      },
    },
    emptyCallDef
  );

  functions.register(
    "SelfContext.setVariable",
    false,
    {
      exec: (ctx: ExecutionContext, args: MapValue) => {
        const name = (args.v.get(1) as StringValue).v;
        const value = args.v.get(2) as Value;
        ctx.setVariable(name, value);
        return NIL_VALUE;
      },
    },
    emptyCallDef
  );
}
