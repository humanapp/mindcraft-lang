import type { BrainTileLiteralDef } from "@wendoo/core/brain/tiles";
import type { ArmedTargetMode, LiteralCreationSeed } from "./ArmedTargetContext";
import { literalWord, unusedNumberedName } from "./literal-naming";

/** What a command chip does to the literal the armed position stands on. */
export const StripCommandKinds = {
  /** Opens the value editor on that literal, which every placement of it follows. */
  Edit: "edit",
  /** Opens the value editor seeded for a new literal of its own. */
  Duplicate: "duplicate",
} as const;

/** One of {@link StripCommandKinds}. */
export type StripCommandKind = (typeof StripCommandKinds)[keyof typeof StripCommandKinds];

/** One command the offering leads with, drawn as a chip beside the tiles it offers. */
export interface StripCommand {
  /** Identity of the chip within one offering, distinct from every candidate key. */
  readonly key: string;
  /** What choosing the chip does. */
  readonly kind: StripCommandKind;
}

const editCommand: StripCommand = { key: "command:edit", kind: StripCommandKinds.Edit };
const duplicateCommand: StripCommand = { key: "command:duplicate", kind: StripCommandKinds.Duplicate };

/** What the commands of one armed position are read from. */
export interface StripCommandContext {
  /** How the armed position consumes the tile it is given. */
  readonly mode: ArmedTargetMode;
  /**
   * True when the position stands on a literal the host supplies an editor for
   * and a registered factory mints, which is the only tile these commands act
   * on.
   */
  readonly standsOnLiteral: boolean;
  /**
   * True when the brain's own catalog holds that literal, so a new value may be
   * put on it.
   */
  readonly literalIsEditable: boolean;
  /**
   * True when the armed position takes a literal of that literal's value type
   * as it stands, which is what a command producing a tile there needs.
   */
  readonly positionTakesType: boolean;
}

/**
 * The commands `context` offers, in the order they lead the offering. A
 * position standing on no custom-typed literal offers none.
 *
 * Replacing the literal offers editing it, which a literal the brain's own
 * catalog does not hold takes no part in. Every mode offers duplicating it,
 * which produces a tile and so needs the armed position to take one.
 */
export function stripCommands(context: StripCommandContext): StripCommand[] {
  const { mode, standsOnLiteral, literalIsEditable, positionTakesType } = context;
  if (!standsOnLiteral) return [];
  const commands: StripCommand[] = [];
  const isReplace = mode === "replace";
  if (isReplace && literalIsEditable) commands.push(editCommand);
  if (isReplace || positionTakesType) commands.push(duplicateCommand);
  return commands;
}

/**
 * The seed a fork of `literalDef` opens its editor on: that literal's own
 * value, and the smallest numbered name free of `taken` built from the word it
 * reads by (a fork of "image 1" is offered "image 2").
 */
export function literalForkSeed(literalDef: BrainTileLiteralDef, taken: ReadonlySet<string>): LiteralCreationSeed {
  return { value: literalDef.value, displayName: unusedNumberedName(literalWord(literalDef), taken) };
}
