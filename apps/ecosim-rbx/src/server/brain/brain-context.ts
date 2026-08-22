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
import { EcosimFuncId } from "./abi-ids";
import { getActor, getTargetActor } from "./execution-context-types";
import { EcosimTypeIds, extractVector2, mkVector2Value } from "./type-system";

/**
 * Adds the `getTargetActor` and `getTargetPosition` methods to the core
 * `BrainContext` struct and registers their host functions.
 *
 * @param api - The module registration API.
 */
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
