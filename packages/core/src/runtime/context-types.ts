import type { BrainServices } from "../brain/services";
import { List, type ReadonlyList } from "../platform/list";
import { CoreFuncId, CoreTypeAtomId } from "./abi-ids";
import type { ExecutionContext } from "./context";
import { getRuleVariable, setRuleVariable } from "./context";
import { CoreTypeIds, mkTypeId } from "./core-types";
import { mkCallDef } from "./function-defs";
import { NativeType } from "./type-defs";
import { mkNativeStructValue, mkNumberValue, NIL_VALUE, type StringValue, type StructValue, type Value } from "./value";

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

/**
 * Numeric field ids for the {@link ContextTypeNames.Context} struct. Each value
 * is the field's durable id and its storage slot; it is the single source for
 * both the registered `fieldIndex` and the `fieldGetter` dispatch below.
 */
enum ContextField {
  Time = 0,
  Dt = 1,
  Tick = 2,
  Brain = 3,
  Engine = 4,
  Rule = 5,
}

/** Register the built-in context struct types and their host method bindings. */
export function registerContextTypes(services: BrainServices) {
  const { types, functions } = services.runtime;

  const brainContextTypeId = types.addStructType(ContextTypeNames.BrainContext, {
    atomId: CoreTypeAtomId.BrainContext,
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
    atomId: CoreTypeAtomId.EngineContext,
    fields: List.empty(),
    fieldGetter: () => undefined,
  });

  const ruleContextTypeId = types.addStructType(ContextTypeNames.RuleContext, {
    atomId: CoreTypeAtomId.RuleContext,
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
    atomId: CoreTypeAtomId.Context,
    fields: List.from([
      { name: "time", typeId: CoreTypeIds.Number, fieldIndex: ContextField.Time },
      { name: "dt", typeId: CoreTypeIds.Number, fieldIndex: ContextField.Dt },
      { name: "tick", typeId: CoreTypeIds.Number, fieldIndex: ContextField.Tick },
      { name: "brain", typeId: brainContextTypeId, fieldIndex: ContextField.Brain },
      { name: "engine", typeId: engineContextTypeId, fieldIndex: ContextField.Engine },
      { name: "rule", typeId: ruleContextTypeId, fieldIndex: ContextField.Rule },
    ]),
    fieldGetter: (source: StructValue, fieldId: number) => {
      const execCtx = source.native as ExecutionContext;
      switch (fieldId) {
        case ContextField.Time:
          return mkNumberValue(execCtx.time);
        case ContextField.Dt:
          return mkNumberValue(execCtx.dt);
        case ContextField.Tick:
          return mkNumberValue(execCtx.currentTick);
        case ContextField.Brain:
          return mkNativeStructValue(brainContextTypeId, execCtx);
        case ContextField.Engine:
          return mkNativeStructValue(engineContextTypeId, execCtx);
        case ContextField.Rule:
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
    CoreFuncId.BrainContextGetVariable,
    "BrainContext.getVariable",
    false,
    {
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const name = (args.get(1) as StringValue).v;
        return ctx.services.brain.brainVars.getByName(name);
      },
    },
    emptyCallDef
  );

  functions.register(
    CoreFuncId.BrainContextSetVariable,
    "BrainContext.setVariable",
    false,
    {
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const name = (args.get(1) as StringValue).v;
        const value = args.get(2) as Value;
        ctx.services.brain.brainVars.setByName(name, value);
        return NIL_VALUE;
      },
    },
    emptyCallDef
  );

  functions.register(
    CoreFuncId.RuleContextGetVariable,
    "RuleContext.getVariable",
    false,
    {
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const name = (args.get(1) as StringValue).v;
        return getRuleVariable(ctx, name);
      },
    },
    emptyCallDef
  );

  functions.register(
    CoreFuncId.RuleContextSetVariable,
    "RuleContext.setVariable",
    false,
    {
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const name = (args.get(1) as StringValue).v;
        const value = args.get(2) as Value;
        setRuleVariable(ctx, name, value);
        return NIL_VALUE;
      },
    },
    emptyCallDef
  );
}
