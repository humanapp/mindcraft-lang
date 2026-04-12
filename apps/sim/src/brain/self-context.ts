import {
  ContextTypeIds,
  CoreTypeIds,
  type ExecutionContext,
  List,
  type MapValue,
  type MindcraftModuleApi,
  mkCallDef,
  type StructValue,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/app";
import { getSelf } from "@/brain/execution-context-types";
import { extractVector2, SimTypeIds } from "@/brain/type-system";

export function registerSelfContext(api: MindcraftModuleApi) {
  const { types, functions } = api.brainServices;

  types.addStructMethods(
    ContextTypeIds.SelfContext,
    List.from([
      {
        name: "setPosition",
        params: List.from([{ name: "pos", typeId: SimTypeIds.Vector2 }]),
        returnTypeId: CoreTypeIds.Void,
      },
    ])
  );

  const emptyCallDef = mkCallDef({ type: "bag", items: [] });

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
}
