import {
  ContextTypeIds,
  CoreTypeIds,
  type ExecutionContext,
  extractNumberValue,
  extractStringValue,
  List,
  type MapValue,
  type MindcraftModuleApi,
  mkCallDef,
  mkListValue,
  mkNativeStructValue,
  NIL_VALUE,
  type Value,
} from "@mindcraft-lang/core/app";
import type { Archetype } from "./actor";
import { getSelf } from "./execution-context-types";
import { MyTypeIds } from "./type-system";

const VALID_ARCHETYPES = new Set<string>(["carnivore", "herbivore", "plant"]);

export function registerEngineContext(api: MindcraftModuleApi) {
  const { types, functions } = api.brainServices;

  const actorRefListTypeId = types.instantiate("List", List.from([MyTypeIds.ActorRef]));

  types.addStructMethods(
    ContextTypeIds.EngineContext,
    List.from([
      {
        name: "getActorsByArchetype",
        params: List.from([{ name: "archetype", typeId: CoreTypeIds.String }]),
        returnTypeId: actorRefListTypeId,
      },
      {
        name: "getActorById",
        params: List.from([{ name: "id", typeId: CoreTypeIds.Number }]),
        returnTypeId: MyTypeIds.ActorRef,
      },
    ])
  );

  const emptyCallDef = mkCallDef({ type: "bag", items: [] });

  functions.register(
    "EngineContext.getActorsByArchetype",
    false,
    {
      exec: (ctx: ExecutionContext, args: MapValue): Value => {
        const self = getSelf(ctx);
        if (!self) return mkListValue(actorRefListTypeId, List.empty());
        const archetypeStr = extractStringValue(args.v.get(1));
        if (!archetypeStr || !VALID_ARCHETYPES.has(archetypeStr)) {
          return mkListValue(actorRefListTypeId, List.empty());
        }
        const actors = self.engine.getActorsByArchetype(archetypeStr as Archetype);
        const refs = List.from(actors.map((actor) => mkNativeStructValue(MyTypeIds.ActorRef, actor)));
        return mkListValue(actorRefListTypeId, refs);
      },
    },
    emptyCallDef
  );

  functions.register(
    "EngineContext.getActorById",
    false,
    {
      exec: (ctx: ExecutionContext, args: MapValue): Value => {
        const self = getSelf(ctx);
        if (!self) return NIL_VALUE;
        const id = extractNumberValue(args.v.get(1));
        if (id === undefined) return NIL_VALUE;
        const actor = self.engine.getActorById(id);
        if (!actor) return NIL_VALUE;
        return mkNativeStructValue(MyTypeIds.ActorRef, actor);
      },
    },
    emptyCallDef
  );
}
