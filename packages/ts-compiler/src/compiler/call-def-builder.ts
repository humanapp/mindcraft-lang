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
} from "@mindcraft-lang/core/brain";
import type { ExtractedArgSpec } from "./types.js";

export function buildCallDef(tileName: string, args: readonly ExtractedArgSpec[]): BrainActionCallDef {
  if (args.length === 0) {
    return mkCallDef(bag());
  }
  const items = args.map((spec) => lowerArgSpec(tileName, spec));
  return mkCallDef(bag(...items));
}

function lowerArgSpec(tileName: string, spec: ExtractedArgSpec): BrainActionCallSpec {
  switch (spec.kind) {
    case "modifier":
      return mod(spec.id.startsWith("modifier.") ? spec.id : `user.${tileName}.${spec.id}`);
    case "param": {
      const tileId = spec.anonymous
        ? `anon.${spec.type}`
        : spec.name.startsWith("parameter.")
          ? spec.name
          : `user.${tileName}.${spec.name}`;
      return param(tileId, { anonymous: spec.anonymous || undefined });
    }
    case "choice": {
      const items = spec.items.map((item) => lowerArgSpec(tileName, item));
      const result: BrainActionCallChoiceSpec = { type: "choice", name: spec.name, options: items };
      return result;
    }
    case "optional":
      return specOptional(lowerArgSpec(tileName, spec.item));
    case "repeated":
      return specRepeated(lowerArgSpec(tileName, spec.item), { min: spec.min, max: spec.max });
    case "conditional":
      return specConditional(
        spec.condition,
        lowerArgSpec(tileName, spec.thenItem),
        spec.elseItem ? lowerArgSpec(tileName, spec.elseItem) : undefined
      );
    case "seq":
      return specSeq(...spec.items.map((item) => lowerArgSpec(tileName, item)));
  }
}
