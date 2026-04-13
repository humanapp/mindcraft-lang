import {
  ContextTypeIds,
  CoreTypeIds,
  Dict,
  type ExecutionContext,
  extractNumberValue,
  List,
  type MapValue,
  type MindcraftModuleApi,
  mkCallDef,
  mkNativeStructValue,
  mkNumberValue,
  mkStructValue,
  mkTypeId,
  NativeType,
  type NumberValue,
  type StructValue,
  TypeUtils,
  type Value,
  Vector2,
  VOID_VALUE,
} from "@mindcraft-lang/core/app";
import type { Actor } from "./actor";
import { getSelf } from "./execution-context-types";

export const SimTypeNames = {
  ActorRef: "ActorRef",
  Vector2: "Vector2",
};

export const SimTypeIds = {
  ActorRef: mkTypeId(NativeType.Struct, SimTypeNames.ActorRef),
  Vector2: mkTypeId(NativeType.Struct, SimTypeNames.Vector2),
};

// -------------------------------------------------------
// Vector2 helpers
// -------------------------------------------------------

export function mkVector2Value(v: Vector2) {
  return mkStructValue(
    SimTypeIds.Vector2,
    new Dict([
      ["x", mkNumberValue(v.X)],
      ["y", mkNumberValue(v.Y)],
    ])
  );
}

export function extractVector2(value: StructValue): Vector2 | undefined {
  if (value.t !== NativeType.Struct || value.typeId !== SimTypeIds.Vector2) {
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

function actorRefFieldSetter(source: StructValue, fieldName: string, value: Value, ctx: ExecutionContext): boolean {
  const actor = resolveActor(source, ctx);
  if (!actor) return false;
  switch (fieldName) {
    case "position": {
      const vec = extractVector2(value as StructValue);
      if (!vec) return false;
      actor.sprite.setPosition(vec.X, vec.Y);
      return true;
    }
    default:
      return false;
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
  return mkStructValue(SimTypeIds.ActorRef, new Dict(), resolver);
}

/**
 * Create an actorRef value backed by a direct Actor reference.
 * Use this for literal actor tiles where the user picked a specific actor.
 */
export function mkActorRefDirect(actor: Actor): StructValue {
  return mkStructValue(SimTypeIds.ActorRef, new Dict(), actor);
}

export function registerTypes(api: MindcraftModuleApi) {
  api.defineType({
    coreType: NativeType.Struct,
    typeId: SimTypeIds.Vector2,
    name: SimTypeNames.Vector2,
    fields: List.from([
      { name: "x", typeId: CoreTypeIds.Number },
      { name: "y", typeId: CoreTypeIds.Number },
    ]),
    accessors: true,
    variableFactory: true,
  });

  api.defineType({
    coreType: NativeType.Struct,
    typeId: SimTypeIds.ActorRef,
    name: SimTypeNames.ActorRef,
    fields: List.from([
      { name: "id", typeId: CoreTypeIds.Number },
      { name: "position", typeId: SimTypeIds.Vector2 },
      { name: "energy pct", typeId: CoreTypeIds.Number },
    ]),
    fieldGetter: actorRefFieldGetter,
    fieldSetter: actorRefFieldSetter,
    snapshotNative: actorRefSnapshotNative,
    accessors: { readOnly: ["id", "energy pct"] },
    variableFactory: true,
  });

  api.registerConversion({
    fromType: SimTypeIds.ActorRef,
    toType: CoreTypeIds.Number,
    cost: 2,
    fn: {
      exec: (ctx: ExecutionContext, args: MapValue) => {
        const value = args.v.get(0) as StructValue;
        const actor = resolveActor(value, ctx);
        return mkNumberValue(actor ? actor.actorId : 0);
      },
    },
  });
  api.registerConversion({
    fromType: SimTypeIds.ActorRef,
    toType: SimTypeIds.Vector2,
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
  });
  api.registerConversion({
    fromType: SimTypeIds.Vector2,
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
  });

  // -------------------------------------------------------
  // Vector2 methods
  // -------------------------------------------------------

  const { types, functions } = api.brainServices;
  const emptyCallDef = mkCallDef({ type: "bag", items: [] });

  types.addStructMethods(
    SimTypeIds.Vector2,
    List.from([
      {
        name: "add",
        params: List.from([{ name: "other", typeId: SimTypeIds.Vector2 }]),
        returnTypeId: SimTypeIds.Vector2,
      },
      {
        name: "sub",
        params: List.from([{ name: "other", typeId: SimTypeIds.Vector2 }]),
        returnTypeId: SimTypeIds.Vector2,
      },
      {
        name: "mul",
        params: List.from([{ name: "scalar", typeId: CoreTypeIds.Number }]),
        returnTypeId: SimTypeIds.Vector2,
      },
      {
        name: "div",
        params: List.from([{ name: "scalar", typeId: CoreTypeIds.Number }]),
        returnTypeId: SimTypeIds.Vector2,
      },
      {
        name: "dot",
        params: List.from([{ name: "other", typeId: SimTypeIds.Vector2 }]),
        returnTypeId: CoreTypeIds.Number,
      },
      {
        name: "cross",
        params: List.from([{ name: "other", typeId: SimTypeIds.Vector2 }]),
        returnTypeId: CoreTypeIds.Number,
      },
      {
        name: "magnitude",
        params: List.empty(),
        returnTypeId: CoreTypeIds.Number,
      },
      {
        name: "normalize",
        params: List.empty(),
        returnTypeId: SimTypeIds.Vector2,
      },
      {
        name: "distance",
        params: List.from([{ name: "other", typeId: SimTypeIds.Vector2 }]),
        returnTypeId: CoreTypeIds.Number,
      },
      {
        name: "lerp",
        params: List.from([
          { name: "goal", typeId: SimTypeIds.Vector2 },
          { name: "alpha", typeId: CoreTypeIds.Number },
        ]),
        returnTypeId: SimTypeIds.Vector2,
      },
      {
        name: "angle",
        params: List.from([{ name: "other", typeId: SimTypeIds.Vector2 }]),
        returnTypeId: CoreTypeIds.Number,
      },
      {
        name: "rotate",
        params: List.from([{ name: "angle", typeId: CoreTypeIds.Number }]),
        returnTypeId: SimTypeIds.Vector2,
      },
    ])
  );

  functions.register(
    "Vector2.add",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue): Value => {
        const self = extractVector2(args.v.get(0) as StructValue);
        const other = extractVector2(args.v.get(1) as StructValue);
        if (!self || !other) return VOID_VALUE;
        return mkVector2Value(self.add(other));
      },
    },
    emptyCallDef
  );

  functions.register(
    "Vector2.sub",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue): Value => {
        const self = extractVector2(args.v.get(0) as StructValue);
        const other = extractVector2(args.v.get(1) as StructValue);
        if (!self || !other) return VOID_VALUE;
        return mkVector2Value(self.sub(other));
      },
    },
    emptyCallDef
  );

  functions.register(
    "Vector2.mul",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue): Value => {
        const self = extractVector2(args.v.get(0) as StructValue);
        const scalar = extractNumberValue(args.v.get(1));
        if (!self || scalar === undefined) return VOID_VALUE;
        return mkVector2Value(self.mul(scalar));
      },
    },
    emptyCallDef
  );

  functions.register(
    "Vector2.div",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue): Value => {
        const self = extractVector2(args.v.get(0) as StructValue);
        const scalar = extractNumberValue(args.v.get(1));
        if (!self || scalar === undefined) return VOID_VALUE;
        return mkVector2Value(self.div(scalar));
      },
    },
    emptyCallDef
  );

  functions.register(
    "Vector2.dot",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue): Value => {
        const self = extractVector2(args.v.get(0) as StructValue);
        const other = extractVector2(args.v.get(1) as StructValue);
        if (!self || !other) return VOID_VALUE;
        return mkNumberValue(self.Dot(other));
      },
    },
    emptyCallDef
  );

  functions.register(
    "Vector2.cross",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue): Value => {
        const self = extractVector2(args.v.get(0) as StructValue);
        const other = extractVector2(args.v.get(1) as StructValue);
        if (!self || !other) return VOID_VALUE;
        return mkNumberValue(self.Cross(other));
      },
    },
    emptyCallDef
  );

  functions.register(
    "Vector2.magnitude",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue): Value => {
        const self = extractVector2(args.v.get(0) as StructValue);
        if (!self) return VOID_VALUE;
        return mkNumberValue(self.Magnitude);
      },
    },
    emptyCallDef
  );

  functions.register(
    "Vector2.normalize",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue): Value => {
        const self = extractVector2(args.v.get(0) as StructValue);
        if (!self) return VOID_VALUE;
        return mkVector2Value(self.Unit);
      },
    },
    emptyCallDef
  );

  functions.register(
    "Vector2.distance",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue): Value => {
        const self = extractVector2(args.v.get(0) as StructValue);
        const other = extractVector2(args.v.get(1) as StructValue);
        if (!self || !other) return VOID_VALUE;
        return mkNumberValue(self.sub(other).Magnitude);
      },
    },
    emptyCallDef
  );

  functions.register(
    "Vector2.lerp",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue): Value => {
        const self = extractVector2(args.v.get(0) as StructValue);
        const goal = extractVector2(args.v.get(1) as StructValue);
        const alpha = extractNumberValue(args.v.get(2));
        if (!self || !goal || alpha === undefined) return VOID_VALUE;
        return mkVector2Value(self.Lerp(goal, alpha));
      },
    },
    emptyCallDef
  );

  functions.register(
    "Vector2.angle",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue): Value => {
        const self = extractVector2(args.v.get(0) as StructValue);
        const other = extractVector2(args.v.get(1) as StructValue);
        if (!self || !other) return VOID_VALUE;
        return mkNumberValue(self.Angle(other));
      },
    },
    emptyCallDef
  );

  functions.register(
    "Vector2.rotate",
    false,
    {
      exec: (_ctx: ExecutionContext, args: MapValue): Value => {
        const self = extractVector2(args.v.get(0) as StructValue);
        const angle = extractNumberValue(args.v.get(1));
        if (!self || angle === undefined) return VOID_VALUE;
        return mkVector2Value(self.rotate(angle));
      },
    },
    emptyCallDef
  );

  // -------------------------------------------------------
  // ActorRef methods
  // -------------------------------------------------------

  types.addStructMethods(
    SimTypeIds.ActorRef,
    List.from([
      {
        name: "getPosition",
        params: List.empty(),
        returnTypeId: SimTypeIds.Vector2,
      },
      {
        name: "setPosition",
        params: List.from([{ name: "pos", typeId: SimTypeIds.Vector2 }]),
        returnTypeId: CoreTypeIds.Void,
      },
      {
        name: "getRotation",
        params: List.empty(),
        returnTypeId: CoreTypeIds.Number,
      },
      {
        name: "setRotation",
        params: List.from([{ name: "angle", typeId: CoreTypeIds.Number }]),
        returnTypeId: CoreTypeIds.Void,
      },
      {
        name: "getFacingVector",
        params: List.empty(),
        returnTypeId: SimTypeIds.Vector2,
      },
    ])
  );

  functions.register(
    "ActorRef.getPosition",
    false,
    {
      exec: (ctx: ExecutionContext, args: MapValue): Value => {
        const actor = resolveActor(args.v.get(0) as StructValue, ctx);
        if (!actor) return VOID_VALUE;
        return mkVector2Value(new Vector2(actor.sprite.x, actor.sprite.y));
      },
    },
    emptyCallDef
  );

  functions.register(
    "ActorRef.setPosition",
    false,
    {
      exec: (ctx: ExecutionContext, args: MapValue): Value => {
        const actor = resolveActor(args.v.get(0) as StructValue, ctx);
        if (!actor) return VOID_VALUE;
        const posValue = args.v.get(1) as StructValue;
        const vec = extractVector2(posValue);
        if (!vec) return VOID_VALUE;
        actor.sprite.setPosition(vec.X, vec.Y);
        return VOID_VALUE;
      },
    },
    emptyCallDef
  );

  functions.register(
    "ActorRef.getRotation",
    false,
    {
      exec: (ctx: ExecutionContext, args: MapValue): Value => {
        const actor = resolveActor(args.v.get(0) as StructValue, ctx);
        if (!actor) return VOID_VALUE;
        return mkNumberValue(actor.sprite.rotation);
      },
    },
    emptyCallDef
  );

  functions.register(
    "ActorRef.setRotation",
    false,
    {
      exec: (ctx: ExecutionContext, args: MapValue): Value => {
        const actor = resolveActor(args.v.get(0) as StructValue, ctx);
        if (!actor) return VOID_VALUE;
        const angle = extractNumberValue(args.v.get(1));
        if (angle === undefined) return VOID_VALUE;
        actor.sprite.setRotation(angle);
        return VOID_VALUE;
      },
    },
    emptyCallDef
  );

  functions.register(
    "ActorRef.getFacingVector",
    false,
    {
      exec: (ctx: ExecutionContext, args: MapValue): Value => {
        const actor = resolveActor(args.v.get(0) as StructValue, ctx);
        if (!actor) return VOID_VALUE;
        const r = actor.sprite.rotation;
        return mkVector2Value(new Vector2(Math.cos(r), Math.sin(r)));
      },
    },
    emptyCallDef
  );

  // -------------------------------------------------------
  // Context.self field (ActorRef backed by executing actor)
  // -------------------------------------------------------

  types.addStructFields(
    ContextTypeIds.Context,
    List.from([{ name: "self", typeId: SimTypeIds.ActorRef }]),
    (source: StructValue, fieldName: string, ctx: ExecutionContext) => {
      if (fieldName !== "self") return undefined;
      const actor = getSelf(ctx);
      if (!actor) return undefined;
      return mkNativeStructValue(SimTypeIds.ActorRef, actor);
    }
  );
}
