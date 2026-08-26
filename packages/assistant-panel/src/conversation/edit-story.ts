import type { EditOutcome, ProjectTile } from "@wendoo/assistant-bridge";

/** The rule side an editor command worked on, in the spelling the wire uses. */
export type EditSide = "when" | "do";

/** One editor command of an accepted proposal, as the receipt's fold tells it. */
export interface EditStoryRow {
  /** The editor command, under the `op` the call named it by. */
  readonly op: string;
  /** What the command did, for the reader. */
  readonly text: string;
  /** The rule side the command worked on; absent for a command that names none. */
  readonly side?: EditSide;
}

/** The editor commands one `propose_edit` input carries, in the order they run. */
export function editCommands(input: unknown): readonly unknown[] {
  if (typeof input !== "object" || input === null) return [];
  const held = input as { op?: unknown; commands?: unknown };
  if (held.op === "batch") return Array.isArray(held.commands) ? held.commands : [];
  return [input];
}

/** The `op` a command named, or `undefined` when it named none. */
function operation(command: unknown): string | undefined {
  if (typeof command !== "object" || command === null) return undefined;
  const op = (command as { op?: unknown }).op;
  return typeof op === "string" ? op : undefined;
}

/** The rule side a command named, or `undefined` when it names none. */
function commandSide(command: unknown): EditSide | undefined {
  if (typeof command !== "object" || command === null) return undefined;
  const side = (command as { side?: unknown }).side;
  return side === "when" || side === "do" ? side : undefined;
}

/** The insertion index a command named, or `undefined` when it left it to the end of the side. */
function commandPosition(command: unknown): number | undefined {
  const position = (command as { position?: unknown }).position;
  return typeof position === "number" ? position : undefined;
}

/** How many tiles a command puts on a side, and `0` for a command that puts none there. */
function tileCount(command: unknown, op: string): number {
  if (op === "placeTile" || op === "replaceTile") return 1;
  if (op !== "placeTiles") return 0;
  const tileIds = (command as { tileIds?: unknown }).tileIds;
  return Array.isArray(tileIds) ? tileIds.length : 0;
}

/**
 * The words the tiles a command placed read by, read off the rule the command
 * reported back. Empty when the command placed none, or when the rule it
 * reported cannot say which of its tiles the command put there.
 */
function placedWords(command: unknown, op: string, outcome: EditOutcome): string[] {
  const count = tileCount(command, op);
  const side = commandSide(command);
  if (count === 0 || side === undefined || !outcome.rule) return [];
  const tiles: readonly ProjectTile[] = outcome.rule[side];
  const start = commandPosition(command) ?? tiles.length - count;
  if (start < 0 || start + count > tiles.length) return [];
  return tiles.slice(start, start + count).map((tile) => tile.label);
}

/** How one command reads, given the words for the tiles it placed. */
function commandText(op: string, words: readonly string[], outcome: EditOutcome): string {
  switch (op) {
    case "addRule":
      return "added a rule";
    case "addChildRule":
      return "added a rule under it";
    case "addPage":
      return outcome.page ? `made the page ${outcome.page.name}` : "made a page";
    case "placeTile":
    case "placeTiles":
      return words.length > 0 ? `placed ${words.join(", ")}` : "placed tiles";
    case "replaceTile":
      return words.length > 0 ? `swapped in ${words[0]}` : "swapped a tile";
    case "deleteTile":
      return "took a tile out";
    case "deleteRule":
      return "took a rule out";
    case "deletePage":
      return "took a page out";
    default:
      return "changed the rules";
  }
}

/**
 * How one editor command of an accepted proposal reads, pairing the command as
 * the model wrote it with what it left behind. Returns `undefined` for a
 * command carrying no `op`.
 */
export function editStoryRow(command: unknown, outcome: EditOutcome): EditStoryRow | undefined {
  const op = operation(command);
  if (op === undefined) return undefined;
  const side = commandSide(command);
  return {
    op,
    text: commandText(op, placedWords(command, op, outcome), outcome),
    ...(side === undefined ? {} : { side }),
  };
}
