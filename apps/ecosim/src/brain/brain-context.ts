import {
  ContextTypeIds,
  type ExecutionContext,
  getRuleVariable,
  List,
  mkCallDef,
  mkNativeStructValue,
  NIL_VALUE,
  type NumberValue,
  type StructValue,
  type Value,
  Vector2,
  type WendooModuleApi,
} from "@wendoo/core/app";
import { getActor, getTargetActor } from "@/brain/execution-context-types";
import { EcosimTypeIds, extractVector2, mkVector2Value } from "@/brain/type-system";
import { EcosimFuncId } from "./abi-ids";

export function registerBrainContext(api: WendooModuleApi) {
  const { types, functions } = api.brainServices.runtime;

  const nullableActorRefTypeId = types.addNullableType(EcosimTypeIds.ActorRef);
  const nullableVector2TypeId = types.addNullableType(EcosimTypeIds.Vector2);

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
    EcosimFuncId.BrainContextGetTargetActor,
    "BrainContext.getTargetActor",
    false,
    {
      exec: (ctx: ExecutionContext): Value => {
        const actor = getTargetActor(ctx);
        if (!actor) return NIL_VALUE;
        return mkNativeStructValue(EcosimTypeIds.ActorRef, actor);
      },
    },
    emptyCallDef
  );

  functions.register(
    EcosimFuncId.BrainContextGetTargetPosition,
    "BrainContext.getTargetPosition",
    false,
    {
      exec: (ctx: ExecutionContext): Value => {
        const targetPosVar = getRuleVariable<StructValue>(ctx, "targetPos");
        if (targetPosVar && targetPosVar.typeId === EcosimTypeIds.Vector2) {
          const pos = extractVector2(ctx, targetPosVar);
          if (pos) return mkVector2Value(ctx, pos);
        }

        const targetActorVar = getRuleVariable<NumberValue>(ctx, "targetActor");
        const targetId = targetActorVar?.v;
        const target = targetId !== undefined ? getActor(ctx, targetId) : undefined;
        if (target) return mkVector2Value(ctx, new Vector2(target.sprite.x, target.sprite.y));

        return NIL_VALUE;
      },
    },
    emptyCallDef
  );
}
