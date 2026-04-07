import {
  CoreOpId,
  CoreTypeIds,
  Dict,
  type ExecutionContext,
  List,
  type MapValue,
  type MindcraftModuleApi,
  mkCallDef,
  mkNumberValue,
  mkStructValue,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  type StructValue,
  TypeUtils,
  type Value,
  Vector2,
} from "@mindcraft-lang/core/app";
import type { Actor } from "./actor";

export const MyTypeNames = {
  ActorRef: "actorRef",
  Vector2: "vector2",
};

export const MyTypeIds = {
  ActorRef: mkTypeId(NativeType.Struct, MyTypeNames.ActorRef),
  Vector2: mkTypeId(NativeType.Struct, MyTypeNames.Vector2),
};

// -------------------------------------------------------
// Vector2 helpers
// -------------------------------------------------------

export function mkVector2Value(v: Vector2) {
  return mkStructValue(
    MyTypeIds.Vector2,
    new Dict([
      ["x", mkNumberValue(v.X)],
      ["y", mkNumberValue(v.Y)],
    ])
  );
}

export function extractVector2(value: StructValue): Vector2 | undefined {
  if (value.t !== NativeType.Struct || value.typeId !== MyTypeIds.Vector2) {
    return undefined;
  }
  const xField = value.v?.get("x") as NumberValue | undefined;
  const yField = value.v?.get("y") as NumberValue | undefined;
  if (xField && yField && xField.t === NativeType.Number && yField.t === NativeType.Number) {
    return new Vector2(xField.v, yField.v);
  }
  return undefined;
}

// -------------------------------------------------------
// ActorRef helpers
// -------------------------------------------------------

/**
 * Resolve the Actor from a native-backed actorRef StructValue.
 * The `native` field is either a resolver function `(ctx) => Actor | undefined`
 * or a direct `Actor` reference.
 */
export function resolveActor(source: StructValue, ctx: ExecutionContext): Actor | undefined {
  const raw = source.native;
  if (raw === undefined || raw === null) return undefined;
  if (TypeUtils.isFunction(raw)) {
    return (raw as (ctx: ExecutionContext) => Actor | undefined)(ctx);
  }
  return raw as Actor;
}

/**
 * Snapshot the native handle for actorRef during deep-copy (assignment).
 * If the native handle is a resolver function, call it to get the current Actor
 * and store the direct reference. This ensures that `$target = [it]` captures
 * the specific actor at assignment time rather than re-resolving lazily later.
 */
function actorRefSnapshotNative(source: StructValue, ctx: ExecutionContext): unknown {
  const raw = source.native;
  if (raw === undefined || raw === null) return raw;
  if (TypeUtils.isFunction(raw)) {
    // Resolve the function to get the concrete Actor
    const actor = (raw as (ctx: ExecutionContext) => Actor | undefined)(ctx);
    return actor ?? undefined;
  }
  // Already a direct Actor reference -- return as-is
  return raw;
}

/**
 * Field getter for the actorRef native struct type.
 */
function actorRefFieldGetter(source: StructValue, fieldName: string, ctx: ExecutionContext): Value | undefined {
  const actor = resolveActor(source, ctx);
  if (!actor) return undefined;
  switch (fieldName) {
    case "id":
      return mkNumberValue(actor.actorId);
    case "position":
      return mkVector2Value(new Vector2(actor.sprite.x, actor.sprite.y));
    case "energy pct":
      return mkNumberValue(actor.energy / actor.maxEnergy);
    default:
      return undefined;
  }
}

/**
 * Create an actorRef value backed by a resolver function.
 * The resolver is called with the ExecutionContext at field-access time,
 * so the value is always current and identity-correct across brain copies.
 *
 * Example: `mkActorRefResolver(getSelf)` for the [me] tile.
 */
export function mkActorRefResolver(resolver: (ctx: ExecutionContext) => Actor | undefined): StructValue {
  return mkStructValue(MyTypeIds.ActorRef, new Dict(), resolver);
}

/**
 * Create an actorRef value backed by a direct Actor reference.
 * Use this for literal actor tiles where the user picked a specific actor.
 */
export function mkActorRefDirect(actor: Actor): StructValue {
  return mkStructValue(MyTypeIds.ActorRef, new Dict(), actor);
}

export function registerTypes(api: MindcraftModuleApi) {
  api.defineType({
    coreType: NativeType.Struct,
    typeId: MyTypeIds.Vector2,
    name: MyTypeNames.Vector2,
    fields: List.from([
      { name: "x", typeId: CoreTypeIds.Number },
      { name: "y", typeId: CoreTypeIds.Number },
    ]),
  });

  api.defineType({
    coreType: NativeType.Struct,
    typeId: MyTypeIds.ActorRef,
    name: MyTypeNames.ActorRef,
    fields: List.from([
      { name: "id", typeId: CoreTypeIds.Number },
      { name: "position", typeId: MyTypeIds.Vector2 },
      { name: "energy pct", typeId: CoreTypeIds.Number },
    ]),
    fieldGetter: actorRefFieldGetter,
    snapshotNative: actorRefSnapshotNative,
  });

  api.registerOperator({
    spec: { id: CoreOpId.Assign, parse: { fixity: "infix", precedence: 0, assoc: "right" } },
    overloads: [
      {
        argTypes: [MyTypeIds.Vector2, MyTypeIds.Vector2],
        resultType: MyTypeIds.Vector2,
        fn: { exec: (_ctx: ExecutionContext, _args: MapValue) => NIL_VALUE },
      },
      {
        argTypes: [MyTypeIds.ActorRef, MyTypeIds.ActorRef],
        resultType: MyTypeIds.ActorRef,
        fn: { exec: (_ctx: ExecutionContext, _args: MapValue) => NIL_VALUE },
      },
    ],
  });

  const anonCallDef = mkCallDef({
    type: "arg",
    tileId: "",
    anonymous: true,
  });

  api.registerConversion({
    fromType: MyTypeIds.ActorRef,
    toType: CoreTypeIds.Number,
    cost: 2,
    fn: {
      exec: (ctx: ExecutionContext, args: MapValue) => {
        const value = args.v.get(0) as StructValue;
        const actor = resolveActor(value, ctx);
        return mkNumberValue(actor ? actor.actorId : 0);
      },
    },
    callDef: anonCallDef,
  });
  api.registerConversion({
    fromType: MyTypeIds.ActorRef,
    toType: MyTypeIds.Vector2,
    cost: 2,
    fn: {
      exec: (ctx: ExecutionContext, args: MapValue) => {
        const value = args.v.get(0) as StructValue;
        const actor = resolveActor(value, ctx);
        if (actor) {
          return mkVector2Value(new Vector2(actor.sprite.x, actor.sprite.y));
        }
        return mkVector2Value(new Vector2(0, 0));
      },
    },
    callDef: anonCallDef,
  });
  api.registerConversion({
    fromType: MyTypeIds.Vector2,
    toType: CoreTypeIds.String,
    cost: 3,
    fn: {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const value = args.v.get(0) as StructValue;
        const vec = extractVector2(value);
        return {
          t: NativeType.String,
          v: vec ? `(${vec.X.toFixed(2)}, ${vec.Y.toFixed(2)})` : "(invalid)",
        };
      },
    },
    callDef: anonCallDef,
  });
}
