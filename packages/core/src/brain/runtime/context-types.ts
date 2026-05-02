import { List, type ReadonlyList } from "../../platform/list";
import {
  CoreTypeIds,
  type ExecutionContext,
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
import type { BrainServices } from "../services";

/** Stable type-system names for the built-in context structs. */
export const ContextTypeNames = {
  Context: "Context",
  BrainContext: "BrainContext",
  EngineContext: "EngineContext",
  RuleContext: "RuleContext",
};

/** Resolved {@link TypeId}s of the built-in context struct types. */
export const ContextTypeIds = {
  Context: mkTypeId(NativeType.Struct, ContextTypeNames.Context),
  BrainContext: mkTypeId(NativeType.Struct, ContextTypeNames.BrainContext),
  EngineContext: mkTypeId(NativeType.Struct, ContextTypeNames.EngineContext),
  RuleContext: mkTypeId(NativeType.Struct, ContextTypeNames.RuleContext),
};

/** Register the built-in context struct types and their host method bindings. */
export function registerContextTypes(services: BrainServices) {
  const { types, functions } = services;

  const brainContextTypeId = types.addStructType(ContextTypeNames.BrainContext, {
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

  const ruleContextTypeId = types.addStructType(ContextTypeNames.RuleContext, {
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

  types.addStructType(ContextTypeNames.Context, {
    fields: List.from([
      { name: "time", typeId: CoreTypeIds.Number },
      { name: "dt", typeId: CoreTypeIds.Number },
      { name: "tick", typeId: CoreTypeIds.Number },
      { name: "brain", typeId: brainContextTypeId },
      { name: "engine", typeId: engineContextTypeId },
      { name: "rule", typeId: ruleContextTypeId },
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
        case "brain":
          return mkNativeStructValue(brainContextTypeId, execCtx);
        case "engine":
          return mkNativeStructValue(engineContextTypeId, execCtx);
        case "rule":
          return mkNativeStructValue(ruleContextTypeId, execCtx);
        default:
          return undefined;
      }
    },
  });

  const emptyCallDef = mkCallDef({ type: "bag", items: [] });

  // Struct method calling convention: the emitter pushes the struct value itself as
  // arg index 0 (the receiver). User-visible arguments start at index 1.
  functions.register(
    "BrainContext.getVariable",
    false,
    {
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const name = (args.get(1) as StringValue).v;
        return ctx.getVariable(name) ?? NIL_VALUE;
      },
    },
    emptyCallDef
  );

  functions.register(
    "BrainContext.setVariable",
    false,
    {
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const name = (args.get(1) as StringValue).v;
        const value = args.get(2) as Value;
        ctx.setVariable(name, value);
        return NIL_VALUE;
      },
    },
    emptyCallDef
  );

  functions.register(
    "RuleContext.getVariable",
    false,
    {
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const name = (args.get(1) as StringValue).v;
        return ctx.rule?.getVariable(name) ?? NIL_VALUE;
      },
    },
    emptyCallDef
  );

  functions.register(
    "RuleContext.setVariable",
    false,
    {
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const name = (args.get(1) as StringValue).v;
        const value = args.get(2) as Value;
        ctx.rule?.setVariable(name, value);
        return NIL_VALUE;
      },
    },
    emptyCallDef
  );
}
