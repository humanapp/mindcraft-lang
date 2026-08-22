import { assertUnreachable } from "@wendoo/core";
import type { BrainServices } from "@wendoo/core/brain";
import type { ActionDescriptor, BytecodeResolvedAction } from "@wendoo/core/runtime";
import type { UserAuthoredProgram } from "../compiler/types.js";
import { buildStructTypeTiles, buildUserTileMetadata } from "./user-tile-metadata.js";

/** Register a program's derived struct-type tiles (accessors, variable factories) that are not yet registered. */
function registerStructTypeTiles(program: UserAuthoredProgram, services: BrainServices): void {
  const { tiles } = services.edit;
  for (const structTile of buildStructTypeTiles(program, services)) {
    if (!tiles.has(structTile.tileId)) {
      tiles.registerTileDef(structTile);
    }
  }
}

/**
 * Register a compiled user conversion into the brain services: its bytecode
 * action binding (the linkable convert entry) and its conversion registry
 * entry. The registry entry is register-if-absent: a pair another registration
 * already holds is kept, matching the compiler's conflict reporting.
 */
export function registerUserConversion(program: UserAuthoredProgram, services: BrainServices): void {
  const info = program.conversion;
  if (!info) {
    throw new Error(`Program "${program.key}" carries no conversion metadata`);
  }

  const descriptor: ActionDescriptor = {
    key: program.key,
    kind: program.kind,
    callDef: program.callDef,
    isAsync: program.isAsync,
    outputType: program.outputType,
  };

  services.runtime.actions.register({
    binding: "bytecode",
    descriptor,
    artifact: program,
    metadata: {
      key: program.key,
      kind: program.kind,
      callDef: program.callDef,
      outputType: program.outputType,
    },
  });

  const conversions = services.shared.conversions;
  if (!conversions.get(info.fromType, info.toType)) {
    conversions.register({
      binding: "bytecode",
      fromType: info.fromType,
      toType: info.toType,
      cost: info.cost,
      descriptor,
    });
  }

  registerStructTypeTiles(program, services);
}

/** Register a single compiled user tile (action descriptor, action tile, and parameter tiles) into the brain services. */
export function registerUserTile(program: UserAuthoredProgram, services: BrainServices): void {
  switch (program.kind) {
    case "conversion":
      registerUserConversion(program, services);
      return;
    case "sensor":
    case "actuator":
      break;
    default:
      assertUnreachable(program.kind);
  }

  const { actions } = services.runtime;
  const { tiles } = services.edit;
  const { types } = services.runtime;
  let unresolvedTypeName: string | undefined;
  const metadata = buildUserTileMetadata(program, (typeName) => {
    const typeId = types.resolveByName(typeName);
    if (!typeId && unresolvedTypeName === undefined) {
      unresolvedTypeName = typeName;
    }
    return typeId;
  });
  if (!metadata) {
    throw new Error(`Unknown parameter type "${unresolvedTypeName ?? "unknown"}" for "${program.key}"`);
  }

  const { actionDescriptor, actionTile, parameterTiles, modifierTiles } = metadata;
  const actionBinding: BytecodeResolvedAction = {
    binding: "bytecode",
    descriptor: actionDescriptor,
    artifact: program,
    metadata: {
      key: program.key,
      kind: program.kind,
      callDef: program.callDef,
      outputType: program.outputType,
    },
  };

  for (const parameterTile of parameterTiles) {
    if (!tiles.has(parameterTile.tileId)) {
      tiles.registerTileDef(parameterTile);
    }
  }

  for (const modifierTile of modifierTiles) {
    if (!tiles.has(modifierTile.tileId)) {
      tiles.registerTileDef(modifierTile);
    }
  }

  actions.register(actionBinding);

  if (!tiles.has(actionTile.tileId)) {
    tiles.registerTileDef(actionTile);
  }

  registerStructTypeTiles(program, services);
}
