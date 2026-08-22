import { coreTileDocs } from "@wendoo/core/docs";
import { tileContent } from "@wendoo/core/docs/en";

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
 * Pair each documented tile with the description its markdown carries, keyed by
 * tile id. `contentByKey` maps a manifest entry's `contentKey` to its markdown.
 */
function descriptionsFromManifest(
  entries: readonly { readonly tileId: string; readonly contentKey: string }[],
  contentByKey: Readonly<Record<string, string>>
): Map<string, string> {
  const descriptions = new Map<string, string>();
  for (const entry of entries) {
    const markdown = contentByKey[entry.contentKey];
    if (!markdown) continue;
    const description = descriptionFromMarkdown(markdown);
    if (description) descriptions.set(entry.tileId, description);
  }
  return descriptions;
}

/**
 * Author descriptions for every documented tile a session sees: the built-in
 * core tiles, plus the target's own tiles from the markdown it ships, keyed by
 * tile id. A target description overrides a core one for the same tile id.
 */
export function sessionTileDescriptions(targetTileDocs: ReadonlyMap<string, string>): Map<string, string> {
  const descriptions = descriptionsFromManifest(coreTileDocs, tileContent);
  for (const [tileId, markdown] of targetTileDocs) {
    const description = descriptionFromMarkdown(markdown);
    if (description) descriptions.set(tileId, description);
  }
  return descriptions;
}
