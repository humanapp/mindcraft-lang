import {
  ContextTypeIds,
  CoreTypeIds,
  type ExecutionContext,
  extractNumberValue,
  extractStringValue,
  List,
  mkCallDef,
  mkListValue,
  mkNativeStructValue,
  NIL_VALUE,
  type ReadonlyList,
  type Value,
  type WendooModuleApi,
} from "@wendoo/core/app";
import { EcosimFuncId } from "./abi-ids";
import type { Archetype } from "./actor";
import { getSelf } from "./execution-context-types";
import { EcosimTypeIds } from "./type-system";

const VALID_ARCHETYPES = new Set<string>(["carnivore", "herbivore", "plant"]);

export function registerEngineContext(api: WendooModuleApi) {
  const { types, functions } = api.brainServices.runtime;

  const actorRefListTypeId = types.instantiate("List", List.from([EcosimTypeIds.ActorRef]));

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
        returnTypeId: EcosimTypeIds.ActorRef,
      },
    ])
  );

  const emptyCallDef = mkCallDef({ type: "bag", items: [] });

  functions.register(
    EcosimFuncId.EngineContextGetActorsByArchetype,
    "EngineContext.getActorsByArchetype",
    false,
    {
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>): Value => {
        const self = getSelf(ctx);
        if (!self) return mkListValue(actorRefListTypeId, List.empty());
        const archetypeStr = extractStringValue(args.at(1));
        if (!archetypeStr || !VALID_ARCHETYPES.has(archetypeStr)) {
          return mkListValue(actorRefListTypeId, List.empty());
        }
        const actors = self.engine.getActorsByArchetype(archetypeStr as Archetype);
        const refs = List.from(actors.map((actor) => mkNativeStructValue(EcosimTypeIds.ActorRef, actor)));
        return mkListValue(actorRefListTypeId, refs);
      },
    },
    emptyCallDef
  );

  functions.register(
    EcosimFuncId.EngineContextGetActorById,
    "EngineContext.getActorById",
    false,
    {
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>): Value => {
        const self = getSelf(ctx);
        if (!self) return NIL_VALUE;
        const id = extractNumberValue(args.at(1));
        if (id === undefined) return NIL_VALUE;
        const actor = self.engine.getActorById(id);
        if (!actor) return NIL_VALUE;
        return mkNativeStructValue(EcosimTypeIds.ActorRef, actor);
      },
    },
    emptyCallDef
  );
}
