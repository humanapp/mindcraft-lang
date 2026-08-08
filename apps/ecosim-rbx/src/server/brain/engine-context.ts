import {
  ContextTypeIds,
  CoreTypeIds,
  type ExecutionContext,
  extractNumberValue,
  extractStringValue,
  List,
  type MindcraftModuleApi,
  mkCallDef,
  mkListValue,
  mkNativeStructValue,
  NIL_VALUE,
  type ReadonlyList,
  type Value,
} from "@mindcraft-lang/core/app";
import { EcosimFuncId } from "./abi-ids";
import type { Archetype } from "./actor";
import { getSelf } from "./execution-context-types";
import { EcosimTypeIds } from "./type-system";

const VALID_ARCHETYPES = new Set<string>(["carnivore", "herbivore", "plant"]);

/**
 * Adds the `getActorsByArchetype` and `getActorById` methods to the core
 * `EngineContext` struct and registers their host functions.
 *
 * @param api - The module registration API.
 */
export function registerEngineContext(api: MindcraftModuleApi) {
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
        const selfActor = getSelf(ctx);
        if (!selfActor) return mkListValue(actorRefListTypeId, List.empty());
        const archetypeStr = extractStringValue(args.get(1));
        if (archetypeStr === undefined || !VALID_ARCHETYPES.has(archetypeStr)) {
          return mkListValue(actorRefListTypeId, List.empty());
        }
        const actors = selfActor.engine.getActorsByArchetype(archetypeStr as Archetype);
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
        const selfActor = getSelf(ctx);
        if (!selfActor) return NIL_VALUE;
        const id = extractNumberValue(args.get(1));
        if (id === undefined) return NIL_VALUE;
        const actor = selfActor.engine.getActorById(id);
        if (!actor) return NIL_VALUE;
        return mkNativeStructValue(EcosimTypeIds.ActorRef, actor);
      },
    },
    emptyCallDef
  );
}
