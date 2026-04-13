import { type BrainActionCallDef, bag, mkCallDef, optional, param } from "@mindcraft-lang/core/brain";
import type { ExtractedParam } from "./types.js";

export function buildCallDef(tileName: string, params: readonly ExtractedParam[]): BrainActionCallDef {
  if (params.length === 0) {
    return mkCallDef(bag());
  }

  const items = params.map((p) => {
    const tileId = p.anonymous ? `anon.${p.type}` : `user.${tileName}.${p.name}`;
    const argSpec = param(tileId, { anonymous: p.anonymous || undefined });
    return p.required ? argSpec : optional(argSpec);
  });

  return mkCallDef(bag(...items));
}
