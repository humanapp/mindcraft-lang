import {
  type BrainActionCallChoiceSpec,
  type BrainActionCallDef,
  type BrainActionCallSpec,
  bag,
  mkCallDef,
  mod,
  param,
  conditional as specConditional,
  optional as specOptional,
  repeated as specRepeated,
  seq as specSeq,
} from "@mindcraft-lang/core/runtime";
import { privateArgTileId } from "./symbol-keys.js";
import type { ExtractedArgSpec } from "./types.js";

/**
 * Build the runtime {@link BrainActionCallDef} for a user tile from the
 * descriptor's extracted arg specs. `actionId` is the tile's stable id; private
 * (bare) arg ids are scoped by it under `projectNamespace`, matching the ids
 * registration mints for the same tile.
 */
export function buildCallDef(
  projectNamespace: string,
  actionId: string,
  args: readonly ExtractedArgSpec[]
): BrainActionCallDef {
  if (args.length === 0) {
    return mkCallDef(bag());
  }
  const items = args.map((spec) => lowerArgSpec(projectNamespace, actionId, spec));
  return mkCallDef(bag(...items));
}

function lowerArgSpec(projectNamespace: string, actionId: string, spec: ExtractedArgSpec): BrainActionCallSpec {
  switch (spec.kind) {
    case "modifier":
      return mod(spec.id.startsWith("modifier.") ? spec.id : privateArgTileId(projectNamespace, actionId, spec.id));
    case "param": {
      const tileId = spec.anonymous
        ? `anon.${spec.type}`
        : spec.name.startsWith("parameter.")
          ? spec.name
          : privateArgTileId(projectNamespace, actionId, spec.name);
      return param(tileId, { anonymous: spec.anonymous || undefined });
    }
    case "choice": {
      const items = spec.items.map((item) => lowerArgSpec(projectNamespace, actionId, item));
      const result: BrainActionCallChoiceSpec = { type: "choice", name: spec.name, options: items };
      return result;
    }
    case "optional":
      return specOptional(lowerArgSpec(projectNamespace, actionId, spec.item));
    case "repeated":
      return specRepeated(lowerArgSpec(projectNamespace, actionId, spec.item), { min: spec.min, max: spec.max });
    case "conditional":
      return specConditional(
        spec.condition,
        lowerArgSpec(projectNamespace, actionId, spec.thenItem),
        spec.elseItem ? lowerArgSpec(projectNamespace, actionId, spec.elseItem) : undefined
      );
    case "seq":
      return specSeq(...spec.items.map((item) => lowerArgSpec(projectNamespace, actionId, item)));
  }
}
