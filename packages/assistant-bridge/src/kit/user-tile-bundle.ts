import type { CompiledActionArtifact, CompiledActionBundle, TileDefinitionInput } from "@wendoo/core/app";
import { Dict, List } from "@wendoo/core/app";
import { mkActuatorTileId } from "@wendoo/core/brain";
import { BrainTileActuatorDef } from "@wendoo/core/brain/tiles";
import { BYTECODE_VERSION, mkCallDef, mkNumberValue, Op } from "@wendoo/core/runtime";

/**
 * Action key of the compiled user actuator {@link userTileBundle} carries. It
 * names no target's own action, so a rehearsal of any target resolves it from
 * the bundle alone.
 */
export const USER_TILE_ACTION_KEY = "assistant-bridge.conformance::mark";

/** Tile id the compiled user actuator is placed under. */
export const USER_TILE_ID = mkActuatorTileId(USER_TILE_ACTION_KEY);

/** Namespace of the compilation root that owns the tile {@link userTileBundle} carries. */
export const USER_TILE_NAMESPACE = "wendoo-lang/assistant-bridge-conformance";

/** Revision {@link userTileBundle} reports. */
const revision = "assistant-bridge.conformance.rev1";

/** The user actuator takes no arguments. */
const callDef = mkCallDef({ type: "bag", items: [] });

/** A compiled actuator artifact whose body returns without acting. */
function artifact(): CompiledActionArtifact {
  return {
    version: BYTECODE_VERSION,
    functions: List.from([
      { code: List.from([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }]), numParams: 0, name: "entry" },
    ]),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.from([mkNumberValue(0)]),
    },
    variableNames: List.empty(),
    entryPoint: 0,
    key: USER_TILE_ACTION_KEY,
    kind: "actuator",
    callDef,
    isAsync: false,
    numStateSlots: 0,
    entryFuncId: 0,
    revisionId: `${USER_TILE_ACTION_KEY}.rev1`,
  };
}

/**
 * A compiled action bundle carrying one user-authored actuator, in the shape a
 * project compile produces: the tile names {@link USER_TILE_NAMESPACE} as its
 * owner, and the bundle reports that namespace as its one compilation root.
 * Apply it to an authoring environment with `replaceActionBundle`, place
 * {@link USER_TILE_ID} in a rule, and the run that rehearses that document must
 * carry the bundle for the tile to resolve.
 */
export function userTileBundle(): CompiledActionBundle {
  const actions = new Dict<string, CompiledActionArtifact>();
  actions.set(USER_TILE_ACTION_KEY, artifact());
  const tile: TileDefinitionInput = new BrainTileActuatorDef(USER_TILE_ACTION_KEY, {
    key: USER_TILE_ACTION_KEY,
    kind: "actuator",
    callDef,
    isAsync: false,
  });
  tile.provenance = { owners: [USER_TILE_NAMESPACE] };
  return {
    revision,
    actions,
    tiles: [tile],
    roots: [{ namespace: USER_TILE_NAMESPACE, closure: [] }],
  };
}
