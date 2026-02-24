import { List, stream } from "@mindcraft-lang/core";
import { getPageIdFromTileId, type IBrainTileDef, isPageTileId, mkPageTileId } from "@mindcraft-lang/core/brain";
import { type BrainDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileMissingDef, TileCatalog } from "@mindcraft-lang/core/brain/tiles";

/**
 * Serialized clipboard payload for a copied rule.
 * Stored in a module-level variable so it persists across editor open/close
 * within the same browser tab.
 */
interface RuleClipboardData {
  ruleBytes: Uint8Array;
  catalogBytes: Uint8Array;
  /** Map of page tileId -> human-readable page name, captured at copy time.
   * Needed because BrainTilePageDef.serialize() only persists the pageId,
   * so the visual label is lost during the catalog round-trip. */
  pageNames: Map<string, string>;
}

let clipboardData: RuleClipboardData | undefined;
let clipboardVersion = 0;
const clipboardListeners = new Set<() => void>();

function notifyClipboardChanged(): void {
  clipboardVersion++;
  for (const listener of clipboardListeners) {
    listener();
  }
}

/**
 * Subscribe to clipboard changes. Returns an unsubscribe function.
 */
export function onClipboardChanged(listener: () => void): () => void {
  clipboardListeners.add(listener);
  return () => {
    clipboardListeners.delete(listener);
  };
}

/**
 * Recursively collect all tile IDs referenced by a rule's WHEN/DO sides
 * and its children.
 */
function collectReferencedTileIds(rule: BrainRuleDef, out: Set<string>): void {
  for (const tile of rule.when().tiles().toArray()) {
    out.add(tile.tileId);
  }
  for (const tile of rule.do().tiles().toArray()) {
    out.add(tile.tileId);
  }
  for (const child of rule.children().toArray()) {
    collectReferencedTileIds(child as BrainRuleDef, out);
  }
}

/**
 * Copy a rule to the module-level clipboard.
 *
 * Serializes the rule and a subset of the source brain's local catalog
 * (only tiles referenced by this rule) so the clipboard is self-contained.
 */
export function copyRuleToClipboard(rule: BrainRuleDef): void {
  // Serialize the rule
  const ruleStream = new stream.MemoryStream();
  rule.serialize(ruleStream);
  const ruleBytes = stream.byteArrayToUint8Array(ruleStream.toBytes());

  // Collect brain-local tile defs referenced by this rule
  const referencedIds = new Set<string>();
  collectReferencedTileIds(rule, referencedIds);

  const brainCatalog = rule.brain()?.catalog();
  const tempCatalog = new TileCatalog();
  const pageNames = new Map<string, string>();
  if (brainCatalog) {
    for (const tileId of referencedIds) {
      const tileDef = brainCatalog.get(tileId);
      if (tileDef?.persist) {
        tempCatalog.add(tileDef);
        // Capture page names now, while the live tile still has its visual label
        if (isPageTileId(tileId) && tileDef.visual?.label) {
          pageNames.set(tileId, tileDef.visual.label);
        }
      }
    }
  }

  // Serialize the subset catalog
  const catalogStream = new stream.MemoryStream();
  tempCatalog.serialize(catalogStream);
  const catalogBytes = stream.byteArrayToUint8Array(catalogStream.toBytes());

  clipboardData = { ruleBytes, catalogBytes, pageNames };
  notifyClipboardChanged();
}

/**
 * Whether the clipboard contains a copied rule.
 */
export function hasRuleInClipboard(): boolean {
  return clipboardData !== undefined;
}

/**
 * Walk a rule's tile sets and replace any tiles whose tileId appears in the
 * remap table with the corresponding destination tile.
 */
function remapPageTiles(rule: BrainRuleDef, remapTable: Map<string, IBrainTileDef>): void {
  remapTileSet(rule.when(), remapTable);
  remapTileSet(rule.do(), remapTable);
  for (const child of rule.children().toArray()) {
    remapPageTiles(child as BrainRuleDef, remapTable);
  }
}

function remapTileSet(
  tileSet: {
    tiles(): { toArray(): IBrainTileDef[] };
    replaceTileAtIndex(index: number, tileDef: IBrainTileDef): boolean;
  },
  remapTable: Map<string, IBrainTileDef>
): void {
  const tiles = tileSet.tiles().toArray();
  for (let i = 0; i < tiles.length; i++) {
    const replacement = remapTable.get(tiles[i].tileId);
    if (replacement) {
      tileSet.replaceTileAtIndex(i, replacement);
    }
  }
}

/**
 * Deserialize a rule from the clipboard into the destination brain.
 *
 * Before deserializing the rule, any brain-local tiles (literals, variables)
 * from the source are imported into the destination brain's catalog. Page tiles
 * that reference pages not present in the destination brain are replaced with
 * missing-tile placeholders.
 *
 * Returns the deserialized rule, or undefined if the clipboard is empty.
 */
export function deserializeRuleFromClipboard(destBrain: BrainDef): BrainRuleDef | undefined {
  if (!clipboardData) return undefined;

  const destCatalog = destBrain.catalog();

  // Deserialize the copied catalog into a temporary catalog so we can inspect
  // each tile before importing it into the destination.
  const tempCatalog = new TileCatalog();
  const catalogStream = new stream.MemoryStream(stream.byteArrayFromUint8Array(clipboardData.catalogBytes));
  tempCatalog.deserialize(catalogStream);

  // Build a set of pageIds that exist in the destination brain
  // and a map of page name -> destination page tile for name-based matching
  const destPageIds = new Set<string>();
  const destPageByName = new Map<string, IBrainTileDef>();
  for (const page of destBrain.pages().toArray()) {
    destPageIds.add(page.pageId());
    const pageTileId = mkPageTileId(page.pageId());
    const pageTile = destCatalog.get(pageTileId);
    if (pageTile) {
      destPageByName.set(page.name(), pageTile);
    }
  }

  // Track source page tileIds that were name-matched to a destination page
  // so we can swap them after deserialization.
  const pageRemapTable = new Map<string, IBrainTileDef>();

  // Import tiles from the temporary catalog into the destination brain's catalog
  for (const tileDef of tempCatalog.getAll().toArray()) {
    if (destCatalog.has(tileDef.tileId)) {
      continue;
    }

    if (isPageTileId(tileDef.tileId)) {
      const pageId = getPageIdFromTileId(tileDef.tileId);
      if (pageId && destPageIds.has(pageId)) {
        // Destination brain already has this page; its tile will be created by
        // syncPageTiles_ -- nothing to do.
        continue;
      }

      // Try to match by page name
      const sourceName = clipboardData.pageNames.get(tileDef.tileId) || tileDef.visual?.label || "";
      const destPageTile = destPageByName.get(sourceName);
      if (destPageTile) {
        // A destination page with the same name exists. Register a temporary
        // placeholder so the rule deserializer can resolve the source tileId,
        // then replace it with the real destination page tile afterward.
        const placeholder = new BrainTileMissingDef(tileDef.tileId, "page", sourceName);
        destCatalog.registerTileDef(placeholder);
        pageRemapTable.set(tileDef.tileId, destPageTile);
      } else {
        // No matching page in destination -> missing tile placeholder
        const label = clipboardData.pageNames.get(tileDef.tileId) || tileDef.visual?.label || "page";
        const missingTile = new BrainTileMissingDef(tileDef.tileId, "page", label);
        destCatalog.registerTileDef(missingTile);
      }
    } else {
      // Literal or variable tile -- import directly
      destCatalog.registerTileDef(tileDef);
    }
  }

  // Deserialize the rule using the destination brain's catalog
  const ruleStream = new stream.MemoryStream(stream.byteArrayFromUint8Array(clipboardData.ruleBytes));
  const newRule = new BrainRuleDef();
  newRule.deserialize(ruleStream, List.from([destCatalog]));

  // Replace name-matched page tile placeholders with real destination page tiles
  if (pageRemapTable.size > 0) {
    remapPageTiles(newRule, pageRemapTable);

    // Clean up temporary placeholders from the brain catalog
    for (const sourceTileId of pageRemapTable.keys()) {
      destCatalog.delete(sourceTileId);
    }
  }

  return newRule;
}
