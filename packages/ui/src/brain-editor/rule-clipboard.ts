import { List, logger, type ReadonlyList } from "@mindcraft-lang/core";
import {
  getBrainServices,
  getPageIdFromTileId,
  type IBrainTileDef,
  isPageTileId,
  mkPageTileId,
} from "@mindcraft-lang/core/brain";
import { type BrainDef, BrainRuleDef, type RuleJson } from "@mindcraft-lang/core/brain/model";
import { BrainTileMissingDef, type CatalogTileJson, TileCatalog } from "@mindcraft-lang/core/brain/tiles";
import { isClipboardLoggingEnabled } from "../settings";

/**
 * Serialized clipboard payload for copied rules.
 * Stored in a module-level variable so it persists across editor open/close
 * within the same browser tab.
 */
interface RuleClipboardData {
  ruleJsons: RuleJson[];
  catalogJson: ReadonlyList<CatalogTileJson>;
  /** Map of page tileId -> human-readable page name, captured at copy time.
   * Needed because page tile JSON only persists the pageId, so the visual
   * label is lost during the catalog round-trip. */
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
  const ruleJson = rule.toJson();

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
        if (isPageTileId(tileId) && tileDef.visual?.label) {
          pageNames.set(tileId, tileDef.visual.label);
        }
      }
    }
  }

  const catalogJson = tempCatalog.toJson();

  clipboardData = { ruleJsons: [ruleJson], catalogJson, pageNames };
  if (isClipboardLoggingEnabled()) {
    logger.info(
      "[clipboard] rule copied",
      JSON.stringify({ ruleJsons: clipboardData.ruleJsons, catalog: clipboardData.catalogJson.toArray() }, null, 2)
    );
  }
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
 * Deserialize a single rule from the clipboard into the destination brain.
 *
 * Before deserializing the rule, any brain-local tiles (literals, variables)
 * from the source are imported into the destination brain's catalog. Page tiles
 * that reference pages not present in the destination brain are replaced with
 * missing-tile placeholders.
 *
 * Returns the deserialized rule, or undefined if the clipboard is empty.
 */
export function deserializeRuleFromClipboard(destBrain: BrainDef): BrainRuleDef | undefined {
  const rules = deserializeAllRulesFromClipboard(destBrain);
  return rules.length > 0 ? rules[0] : undefined;
}

/**
 * Deserialize all rules from the clipboard into the destination brain.
 *
 * Returns an array of deserialized rules, or an empty array if the clipboard
 * is empty. Catalog import and page remapping are performed once for the
 * entire batch.
 */
export function deserializeAllRulesFromClipboard(destBrain: BrainDef): BrainRuleDef[] {
  if (!clipboardData) return [];

  const destCatalog = destBrain.catalog();

  const tempCatalog = new TileCatalog();
  tempCatalog.deserializeJson(clipboardData.catalogJson);

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

  const pageRemapTable = new Map<string, IBrainTileDef>();

  for (const tileDef of tempCatalog.getAll().toArray()) {
    if (destCatalog.has(tileDef.tileId)) {
      continue;
    }

    if (isPageTileId(tileDef.tileId)) {
      const pageId = getPageIdFromTileId(tileDef.tileId);
      if (pageId && destPageIds.has(pageId)) {
        continue;
      }

      const sourceName = clipboardData.pageNames.get(tileDef.tileId) || tileDef.visual?.label || "";
      const destPageTile = destPageByName.get(sourceName);
      if (destPageTile) {
        const placeholder = new BrainTileMissingDef(tileDef.tileId, "page", sourceName);
        destCatalog.registerTileDef(placeholder);
        pageRemapTable.set(tileDef.tileId, destPageTile);
      } else {
        const label = clipboardData.pageNames.get(tileDef.tileId) || tileDef.visual?.label || "page";
        const missingTile = new BrainTileMissingDef(tileDef.tileId, "page", label);
        destCatalog.registerTileDef(missingTile);
      }
    } else {
      destCatalog.registerTileDef(tileDef);
    }
  }

  const catalogs = List.from([destCatalog, getBrainServices().tiles]);
  const results: BrainRuleDef[] = [];

  for (const ruleJson of clipboardData.ruleJsons) {
    const newRule = new BrainRuleDef();
    // Include the global tile catalog so that registered tiles (sensors, actuators, etc.)
    // can be resolved even though they are not stored in the brain's local catalog.
    newRule.deserializeJson(ruleJson, catalogs);

    if (pageRemapTable.size > 0) {
      remapPageTiles(newRule, pageRemapTable);
    }

    results.push(newRule);
  }

  // Clean up placeholder tiles after all rules have been deserialized
  if (pageRemapTable.size > 0) {
    for (const sourceTileId of pageRemapTable.keys()) {
      destCatalog.delete(sourceTileId);
    }
  }

  return results;
}

// Plain-JSON shape that matches the serialized form inside brain fence blocks.
interface PlainRuleJson {
  version?: number;
  catalog?: CatalogTileJson[];
  when?: string[];
  do?: string[];
  children?: PlainRuleJson[];
}

function convertPlainRule(plain: PlainRuleJson): RuleJson {
  return {
    version: plain.version ?? 1,
    when: List.from(plain.when ?? []),
    do: List.from(plain.do ?? []),
    children: List.from((plain.children ?? []).map(convertPlainRule)),
  };
}

/**
 * Set the clipboard from a plain JSON rule array (e.g. from a brain fence block).
 *
 * All rules in the array are stored. Paste will insert them all sequentially.
 *
 * If any rule carries a `catalog` array (brain-local tiles such as variables
 * or literals), those entries are collected and stored in the clipboard so
 * they can be imported into the destination brain at paste time.
 * An additional `extraCatalog` parameter accepts top-level catalog entries
 * from the clipboard wrapper format.
 */
export function setClipboardFromJson(plainRules: unknown[], extraCatalog?: CatalogTileJson[]): void {
  if (plainRules.length === 0) return;
  const typedRules = plainRules as PlainRuleJson[];
  const ruleJsons = typedRules.map(convertPlainRule);

  // Collect catalog entries from extra (top-level) and per-rule sources.
  const catalogEntries: CatalogTileJson[] = extraCatalog ? [...extraCatalog] : [];
  for (const rule of typedRules) {
    if (rule.catalog) {
      catalogEntries.push(...rule.catalog);
    }
  }

  clipboardData = {
    ruleJsons,
    catalogJson: List.from<CatalogTileJson>(catalogEntries),
    pageNames: new Map(),
  };
  notifyClipboardChanged();
}
