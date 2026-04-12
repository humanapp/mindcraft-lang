import {
  ContextTypeIds,
  CoreTypeIds,
  type ExecutionContext,
  List,
  type MapValue,
  type MindcraftModuleApi,
  mkCallDef,
  mkNativeStructValue,
  NIL_VALUE,
  type StructValue,
  type Value,
  Vector2,
  VOID_VALUE,
} from "@mindcraft-lang/core/app";
import { getSelf, getTargetActor } from "@/brain/execution-context-types";
import { extractVector2, mkVector2Value, SimTypeIds } from "@/brain/type-system";

export function registerSelfContext(api: MindcraftModuleApi) {
  const { types, functions } = api.brainServices;

  const nullableActorRefTypeId = types.addNullableType(SimTypeIds.ActorRef);
  const nullableVector2TypeId = types.addNullableType(SimTypeIds.Vector2);

  types.addStructMethods(
    ContextTypeIds.SelfContext,
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
        name: "getTargetActor",
        params: List.empty(),
        returnTypeId: nullableActorRefTypeId,
      },
      {
        name: "getTargetPosition",
        params: List.empty(),
        returnTypeId: nullableVector2TypeId,
      },
    ])
  );

  const emptyCallDef = mkCallDef({ type: "bag", items: [] });

  functions.register(
    "SelfContext.getPosition",
    false,
    {
      exec: (ctx: ExecutionContext): Value => {
        const self = getSelf(ctx);
        if (!self) return VOID_VALUE;
        return mkVector2Value(new Vector2(self.sprite.x, self.sprite.y));
      },
    },
    emptyCallDef
  );

  functions.register(
    "SelfContext.setPosition",
    false,
    {
      exec: (ctx: ExecutionContext, args: MapValue): Value => {
        const self = getSelf(ctx);
        if (!self) return VOID_VALUE;
        const posValue = args.v.get(1) as StructValue;
        const vec = extractVector2(posValue);
        if (!vec) return VOID_VALUE;
        self.sprite.setPosition(vec.X, vec.Y);
        return VOID_VALUE;
      },
    },
    emptyCallDef
  );

  functions.register(
    "SelfContext.getTargetActor",
    false,
    {
      exec: (ctx: ExecutionContext): Value => {
        const actor = getTargetActor(ctx);
        if (!actor) return NIL_VALUE;
        return mkNativeStructValue(SimTypeIds.ActorRef, actor);
      },
    },
    emptyCallDef
  );

  functions.register(
    "SelfContext.getTargetPosition",
    false,
    {
      exec: (ctx: ExecutionContext): Value => {
        const actor = getTargetActor(ctx);
        if (!actor) return NIL_VALUE;
        return mkVector2Value(new Vector2(actor.sprite.x, actor.sprite.y));
      },
    },
    emptyCallDef
  );
}
