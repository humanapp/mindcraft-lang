import {
  ContextTypeIds,
  type ExecutionContext,
  getRuleVariable,
  List,
  type MindcraftModuleApi,
  mkCallDef,
  mkNativeStructValue,
  NIL_VALUE,
  type NumberValue,
  type StructValue,
  type Value,
  Vector2,
} from "@mindcraft-lang/core/app";
import { getActor, getTargetActor } from "@/brain/execution-context-types";
import { extractVector2, mkVector2Value, SimTypeIds } from "@/brain/type-system";

export function registerBrainContext(api: MindcraftModuleApi) {
  const { types, functions } = api.brainServices;

  const nullableActorRefTypeId = types.addNullableType(SimTypeIds.ActorRef);
  const nullableVector2TypeId = types.addNullableType(SimTypeIds.Vector2);

  types.addStructMethods(
    ContextTypeIds.BrainContext,
    List.from([
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
    "BrainContext.getTargetActor",
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
    "BrainContext.getTargetPosition",
    false,
    {
      exec: (ctx: ExecutionContext): Value => {
        const targetPosVar = getRuleVariable<StructValue>(ctx, "targetPos");
        if (targetPosVar) {
          const pos = extractVector2(targetPosVar);
          if (pos) return mkVector2Value(pos);
        }

        const targetActorVar = getRuleVariable<NumberValue>(ctx, "targetActor");
        const targetId = targetActorVar?.v;
        const target = targetId !== undefined ? getActor(ctx, targetId) : undefined;
        if (target) return mkVector2Value(new Vector2(target.sprite.x, target.sprite.y));

        return NIL_VALUE;
      },
    },
    emptyCallDef
  );
}
