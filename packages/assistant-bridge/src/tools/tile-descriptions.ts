import { coreTileDocs } from "@wendoo/core/docs";
import { tileContent } from "@wendoo/core/docs/en";

/** Info string of the fenced block a tile's documentation carries its assistant section in. */
const ASSISTANT_FENCE_INFO = "assistant";

/**
 * The author's one-paragraph description of a tile, taken from its
 * documentation: the prose between the title heading and the first rule or
 * subheading below it. Returns `undefined` when the document carries none.
 */
export function descriptionFromMarkdown(markdown: string): string | undefined {
  const lines = markdown.split("\n");
  const titleIndex = lines.findIndex((line) => line.startsWith("# "));
  if (titleIndex < 0) return undefined;

  const collected: string[] = [];
  for (const line of lines.slice(titleIndex + 1)) {
    const trimmed = line.trim();
    if (trimmed === "---" || trimmed.startsWith("## ") || trimmed.startsWith("```")) break;
    if (trimmed.length > 0) collected.push(trimmed);
  }
  const description = collected.join(" ").trim();
  return description.length > 0 ? description : undefined;
}

/**
 * The backtick run a line opens a fenced block with and the info string that
 * follows it, empty for a fence carrying none. `undefined` for a line that
 * opens no fence.
 */
function fenceOpening(line: string): { readonly marker: string; readonly info: string } | undefined {
  const trimmed = line.trim();
  const marker = /^`{3,}/.exec(trimmed)?.[0];
  if (marker === undefined) return undefined;
  return { marker, info: trimmed.slice(marker.length).trim() };
}

/**
 * The teaching prose a tile's documentation reserves for the model: the content
 * of the first fenced block whose info string is `assistant`, with the blank
 * lines around it dropped. Returns `undefined` when the document carries no
 * such block, or carries one holding nothing.
 */
export function assistantSectionFromMarkdown(markdown: string): string | undefined {
  let opened: string | undefined;
  const collected: string[] = [];
  for (const line of markdown.split("\n")) {
    const fence = fenceOpening(line);
    if (opened === undefined) {
      if (fence?.info === ASSISTANT_FENCE_INFO) opened = fence.marker;
      continue;
    }
    if (fence !== undefined && fence.info === "" && fence.marker.length >= opened.length) break;
    collected.push(line);
  }
  if (opened === undefined) return undefined;
  const section = collected.join("\n").trim();
  return section.length > 0 ? section : undefined;
}

/** The text a session serves from the documentation of the tiles it sees, each keyed by tile id. */
export interface SessionTileDocs {
  /** The author's description of each tile; a tile whose documentation opens with none is absent. */
  readonly descriptions: ReadonlyMap<string, string>;
  /** The assistant section of each tile; a tile whose documentation carries none is absent. */
  readonly assistantSections: ReadonlyMap<string, string>;
}

/**
 * The documentation text of every documented tile a session sees: the built-in
 * core tiles, plus the target's own tiles from the markdown it ships, each
 * keyed by tile id. A target's text overrides a core one for the same tile id,
 * field by field.
 */
export function sessionTileDocs(targetTileDocs: ReadonlyMap<string, string>): SessionTileDocs {
  const descriptions = new Map<string, string>();
  const assistantSections = new Map<string, string>();
  const collect = (tileId: string, markdown: string): void => {
    const description = descriptionFromMarkdown(markdown);
    if (description) descriptions.set(tileId, description);
    const assistant = assistantSectionFromMarkdown(markdown);
    if (assistant) assistantSections.set(tileId, assistant);
  };
  for (const entry of coreTileDocs) {
    const markdown = tileContent[entry.contentKey];
    if (markdown) collect(entry.tileId, markdown);
  }
  for (const [tileId, markdown] of targetTileDocs) collect(tileId, markdown);
  return { descriptions, assistantSections };
}
