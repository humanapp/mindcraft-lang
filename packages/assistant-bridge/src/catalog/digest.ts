import type { CatalogTile } from "../tools/read-catalog.js";

/** The catalog serialized for a model's context. */
export interface CatalogDigest {
  /** One line per tile, tiles in ascending tile-id order. */
  readonly text: string;
  /** Tiles the text carries a line for. */
  readonly tileCount: number;
  /** Fingerprint of {@link text} as eight lowercase hex digits. Equal hashes mean equal text. */
  readonly hash: string;
}

/** Render the rules of the tile language that hold for every target, as catalog-facing prose. */
export function languageGrammarLegend(): string {
  return `These rules hold whatever the tiles are:
- Every rule carries a trigger mode -- \`when\`, \`otherwise\`, or \`then\`, shown on the rule as WHEN, ELSE, and THEN. The mode says what arms the rule; the WHEN side stays an ordinary sensor expression, possibly empty, that gates firing once armed. The first rule at a level is always \`when\`; the other two read the rule above them at the same level. An empty WHEN side always fires, so a bare \`when\` rule fires every think it is scheduled.
- A rule side holds exactly one statement; two actions on one trigger need two rules. Sequence them as siblings: give the second rule the \`then\` mode, and it runs once the rule above it completes as a cluster -- that rule's DO finished, and every rule its firing spawned finished with it. A run of \`then\` rules plays out one step after another.
- A child rule is not sequencing: it elaborates one firing of the rule it sits under, running each time that rule finishes its DO, and it carries its own modes among its own siblings.
- A flat run of \`otherwise\` rules is an if / else-if / else ladder: each fires on a think when no earlier rule of the run fired that think and its own expression holds. An empty expression is the plain \`else\`.
- \`THEN when <sensor>\` filters at the completion moment rather than waiting: the sensor is read the moment the rule above completes, and a miss skips that completion. To wait for something after the completion, use a flag variable: the \`then\` sets it, and a separate \`when\` rule fires on the flag plus the awaited condition and clears it -- a child rule nested under the \`then\` does not wait, it is read once at that same moment.
- A \`then\` that skips -- its subject never fired, or its own expression did not hold -- takes the rest of the chain with it, so every \`then\` below it skips too. An \`otherwise\` after a \`then\` is the while-waiting branch: it fires on the thinks the \`then\` did not, including the thinks it is still waiting on its subject.
- An action's empty \`value:\` slot takes the next value expression placed, whatever its type; fill it before placing anything else.
- A sensor with its modifiers is a call, not an operand; reaching for parentheses around one is the signal to put the further condition in a child rule instead.
- A new variable already holds its type's empty value -- a number starts at 0, a yes/no at no, a text at "" -- so a rule may read one before anything has written to it.`;
}

/** Fingerprint `text` as eight lowercase hex digits, the same in every runtime. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Collapse a description to one line of digest text. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Render one tile as a single digest line. */
function digestLine(tile: CatalogTile): string {
  const fields: string[] = [tile.tileId, tile.label, tile.kind];
  if (tile.outputType) fields.push(`out=${tile.outputType}`);
  if (tile.placement.length > 0) fields.push(`place=${tile.placement.join("+")}`);
  if (tile.args) fields.push(`args=${tile.args}`);
  if (tile.requires.length > 0) fields.push(`needs=${tile.requires.join("+")}`);
  if (tile.provides.length > 0) fields.push(`gives=${tile.provides.join("+")}`);
  if (tile.outputs.length > 0) fields.push(`outputs=${tile.outputs.join("+")}`);
  if (tile.consumesWhenResult) fields.push(`whenResult=${tile.consumesWhenResult}`);
  if (tile.deprecated) fields.push("deprecated");
  if (tile.grammarNote) fields.push(`note=${oneLine(tile.grammarNote)}`);
  if (tile.description) fields.push(oneLine(tile.description));
  return fields.join(" | ");
}

/**
 * Serialize the catalog deterministically for the prompt prefix. Tiles the
 * editor hides from its pickers are omitted; the rest are sorted by tile id, so
 * the same catalog always produces the same bytes.
 */
export function catalogDigest(tiles: readonly CatalogTile[]): CatalogDigest {
  const listed = tiles
    .filter((tile) => !tile.hidden)
    .slice()
    .sort((a, b) => (a.tileId < b.tileId ? -1 : a.tileId > b.tileId ? 1 : 0));
  const text = listed.map(digestLine).join("\n");
  return { text, tileCount: listed.length, hash: fingerprint(text) };
}
