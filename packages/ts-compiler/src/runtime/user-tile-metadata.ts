import { List } from "@mindcraft-lang/core";
import { CoreCapabilityBits, type ITileMetadata } from "@mindcraft-lang/core/brain";
import {
  BrainTileActuatorDef,
  BrainTileModifierDef,
  BrainTileOutputDef,
  BrainTileParameterDef,
  BrainTileSensorDef,
} from "@mindcraft-lang/core/brain/tiles";
import { type ActionDescriptor, mkModifierTileId, mkParameterTileId, type TypeId } from "@mindcraft-lang/core/runtime";
import { BitSet } from "@mindcraft-lang/core/util";
import { collectModifiers, collectParams } from "../compiler/arg-spec-utils.js";
import type { ExtractedModifier, ExtractedParam, UserAuthoredProgram } from "../compiler/types.js";

/** Resolve a parameter type name to a runtime `TypeId`, or `undefined` when the type is not registered. */
export type UserTileTypeResolver = (typeName: string) => TypeId | undefined;

/** Output of {@link buildUserTileMetadata}: the tile metadata pieces a brain needs to register a user tile. */
export interface BuiltUserTileMetadata {
  actionDescriptor: ActionDescriptor;
  actionTile: BrainTileActuatorDef | BrainTileSensorDef;
  parameterTiles: readonly BrainTileParameterDef[];
  /** Modifier tiles the tile's call spec places: private ones keyed `user.<id>.<modifier>`, shared ones by their unscoped `modifier.` id. */
  modifierTiles: readonly BrainTileModifierDef[];
  /** Inline output value-tiles derived from a sensor's `outputs` (empty for actuators or sensors without outputs). */
  outputTiles: readonly BrainTileOutputDef[];
}

function buildActionDescriptor(program: UserAuthoredProgram): ActionDescriptor {
  return {
    key: program.key,
    kind: program.kind,
    callDef: program.callDef,
    isAsync: program.isAsync,
    outputType: program.outputType,
  };
}

function getParameterId(actionId: string, param: ExtractedParam): string {
  if (param.anonymous) return `anon.${param.type}`;
  if (param.name.startsWith("parameter.")) return param.name;
  return `user.${actionId}.${param.name}`;
}

/** Resolve a modifier's tile id: shared `modifier.` ids stay unscoped; private ids are scoped by the stable action id. */
function getModifierId(actionId: string, modifier: ExtractedModifier): string {
  if (modifier.id.startsWith("modifier.")) return modifier.id;
  return `user.${actionId}.${modifier.id}`;
}

function buildParameterTiles(
  program: UserAuthoredProgram,
  resolveTypeId: UserTileTypeResolver
): readonly BrainTileParameterDef[] | undefined {
  const parameterTiles = new Map<string, BrainTileParameterDef>();

  for (const param of collectParams(program.args)) {
    const parameterId = getParameterId(program.id, param);
    const tileId = mkParameterTileId(parameterId);
    if (parameterTiles.has(tileId)) {
      continue;
    }

    const typeId = resolveTypeId(param.type);
    if (!typeId) {
      return undefined;
    }

    parameterTiles.set(tileId, new BrainTileParameterDef(parameterId, typeId));
  }

  return Array.from(parameterTiles.values());
}

/**
 * Build the modifier tiles a user tile's call spec places. Materializes private
 * modifiers (keyed `user.<id>.<modifier>`) and shared modifiers declared with a
 * label (keyed by their unscoped `modifier.` id). A bare shared reference (a
 * `modifier.` id with no label) references a modifier declared or registered
 * elsewhere and materializes nothing.
 */
function buildModifierTiles(program: UserAuthoredProgram): readonly BrainTileModifierDef[] {
  const modifierTiles = new Map<string, BrainTileModifierDef>();

  for (const modifier of collectModifiers(program.args)) {
    const isSharedReference = modifier.id.startsWith("modifier.") && modifier.label === "";
    if (isSharedReference) {
      continue;
    }
    const modifierId = getModifierId(program.id, modifier);
    const tileId = mkModifierTileId(modifierId);
    if (modifierTiles.has(tileId)) {
      continue;
    }
    const metadata: ITileMetadata = { label: modifier.label, iconUrl: modifier.icon };
    modifierTiles.set(tileId, new BrainTileModifierDef(modifierId, { metadata }));
  }

  return Array.from(modifierTiles.values());
}

/**
 * Build the inline output value-tiles for a sensor's declared outputs. Returns
 * undefined when an output's type cannot be resolved.
 */
function buildOutputTiles(
  program: UserAuthoredProgram,
  resolveTypeId: UserTileTypeResolver
): readonly BrainTileOutputDef[] | undefined {
  const outputTiles: BrainTileOutputDef[] = [];
  for (const output of program.outputs ?? []) {
    const typeId = resolveTypeId(output.type);
    if (!typeId) {
      return undefined;
    }
    const metadata: ITileMetadata = {
      label: output.label ?? output.name,
      iconUrl: output.icon,
      docsMarkdown: output.docs,
      tags: output.tags,
    };
    outputTiles.push(new BrainTileOutputDef(typeId, output.name, { metadata }));
  }
  return outputTiles;
}

/**
 * Build the action descriptor, action tile, parameter tiles, and output tiles for
 * a compiled user tile. Returns undefined when a parameter or output type cannot
 * be resolved.
 */
export function buildUserTileMetadata(
  program: UserAuthoredProgram,
  resolveTypeId: UserTileTypeResolver
): BuiltUserTileMetadata | undefined {
  const actionDescriptor = buildActionDescriptor(program);
  const parameterTiles = buildParameterTiles(program, resolveTypeId);
  if (!parameterTiles) {
    return undefined;
  }
  const modifierTiles = buildModifierTiles(program);

  const metadata: ITileMetadata = {
    label: program.label ?? program.name,
    iconUrl: program.iconUrl,
    docsMarkdown: program.docsMarkdown,
    tags: program.tags,
  };

  const userTileCaps = new BitSet().set(CoreCapabilityBits.UserTile);
  for (const capability of program.capabilities ?? []) {
    if (capability === "PresenceGated") {
      userTileCaps.set(CoreCapabilityBits.PresenceGated);
    }
  }

  let outputTiles: readonly BrainTileOutputDef[] = [];
  if (program.kind === "sensor") {
    const built = buildOutputTiles(program, resolveTypeId);
    if (!built) {
      return undefined;
    }
    outputTiles = built;
  }

  const providedOutputs = List.from(outputTiles.map((tile) => tile.outputKey));
  const actionTile =
    program.kind === "sensor"
      ? new BrainTileSensorDef(program.key, actionDescriptor, { metadata, capabilities: userTileCaps, providedOutputs })
      : new BrainTileActuatorDef(program.key, actionDescriptor, { metadata, capabilities: userTileCaps });

  return {
    actionDescriptor,
    actionTile,
    parameterTiles,
    modifierTiles,
    outputTiles,
  };
}
