/**
 * Composable factory functions for building BrainActionCallSpec trees.
 *
 * These replace deeply nested object literals with concise, readable function calls:
 *
 * ```ts
 * // Before:
 * mkCallDef({ type: "bag", items: [
 *   { type: "choice", options: [
 *     { type: "arg", tileId: mkModifierTileId(SomeId) },
 *     { type: "arg", tileId: mkModifierTileId(OtherId) },
 *   ]},
 *   { type: "arg", tileId: mkParameterTileId(ParamId) },
 * ]});
 *
 * // After:
 * mkCallDef(bag(
 *   choice(mod(SomeId), mod(OtherId)),
 *   param(ParamId),
 * ));
 * ```
 */

import type {
  BrainActionCallArgSpec,
  BrainActionCallBagSpec,
  BrainActionCallChoiceSpec,
  BrainActionCallConditionalSpec,
  BrainActionCallOptionalSpec,
  BrainActionCallRepeatSpec,
  BrainActionCallSeqSpec,
  BrainActionCallSpec,
} from "./functions";
import { mkModifierTileId, mkParameterTileId } from "./tiles";

/** Creates a modifier arg spec. Wraps the tileId with `mkModifierTileId`. */
export function mod(tileId: string): BrainActionCallArgSpec {
  return { type: "arg", tileId: mkModifierTileId(tileId) };
}

/** Creates a parameter arg spec. Wraps the tileId with `mkParameterTileId`. */
export function param(
  tileId: string,
  opts?: { name?: string; required?: boolean; anonymous?: boolean }
): BrainActionCallArgSpec {
  return {
    type: "arg",
    tileId: mkParameterTileId(tileId),
    name: opts?.name,
    required: opts?.required,
    anonymous: opts?.anonymous,
  };
}

/** Unordered set -- items can appear in any order. */
export function bag(...items: BrainActionCallSpec[]): BrainActionCallBagSpec {
  return { type: "bag", items };
}

/** Exactly one of the given options must be chosen. */
export function choice(...options: BrainActionCallSpec[]): BrainActionCallChoiceSpec {
  return { type: "choice", options };
}

/** All items must appear in sequence. */
export function seq(...items: BrainActionCallSpec[]): BrainActionCallSeqSpec {
  return { type: "seq", items };
}

/** Zero or one occurrence. */
export function optional(item: BrainActionCallSpec): BrainActionCallOptionalSpec {
  return { type: "optional", item };
}

/** Repetition with optional min/max bounds. */
export function repeated(item: BrainActionCallSpec, opts?: { min?: number; max?: number }): BrainActionCallRepeatSpec {
  return { type: "repeat", item, min: opts?.min, max: opts?.max };
}

/** Conditional spec -- includes `thenSpec` (and optionally `elseSpec`) based on whether a named spec matched. */
export function conditional(
  condition: string,
  thenSpec: BrainActionCallSpec,
  elseSpec?: BrainActionCallSpec
): BrainActionCallConditionalSpec {
  return { type: "conditional", condition, then: thenSpec, else: elseSpec };
}
