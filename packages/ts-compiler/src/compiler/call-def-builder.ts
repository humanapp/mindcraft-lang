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
import type { ExtractedArgSpec } from "./types.js";

/**
 * Build the runtime {@link BrainActionCallDef} for a user tile from the
 * descriptor's extracted arg specs. `actionId` is the tile's stable id; private
 * (bare) arg ids are scoped by it, matching the ids registration mints for the
 * same tile.
 */
export function buildCallDef(actionId: string, args: readonly ExtractedArgSpec[]): BrainActionCallDef {
  if (args.length === 0) {
    return mkCallDef(bag());
  }
  const items = args.map((spec) => lowerArgSpec(actionId, spec));
  return mkCallDef(bag(...items));
}

function lowerArgSpec(actionId: string, spec: ExtractedArgSpec): BrainActionCallSpec {
  switch (spec.kind) {
    case "modifier":
      return mod(spec.id.startsWith("modifier.") ? spec.id : `user.${actionId}.${spec.id}`);
    case "param": {
      const tileId = spec.anonymous
        ? `anon.${spec.type}`
        : spec.name.startsWith("parameter.")
          ? spec.name
          : `user.${actionId}.${spec.name}`;
      return param(tileId, { anonymous: spec.anonymous || undefined });
    }
    case "choice": {
      const items = spec.items.map((item) => lowerArgSpec(actionId, item));
      const result: BrainActionCallChoiceSpec = { type: "choice", name: spec.name, options: items };
      return result;
    }
    case "optional":
      return specOptional(lowerArgSpec(actionId, spec.item));
    case "repeated":
      return specRepeated(lowerArgSpec(actionId, spec.item), { min: spec.min, max: spec.max });
    case "conditional":
      return specConditional(
        spec.condition,
        lowerArgSpec(actionId, spec.thenItem),
        spec.elseItem ? lowerArgSpec(actionId, spec.elseItem) : undefined
      );
    case "seq":
      return specSeq(...spec.items.map((item) => lowerArgSpec(actionId, item)));
  }
}
