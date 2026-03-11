import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List, type ReadonlyList } from "../../platform/list";
import { type IReadStream, type IWriteStream, MemoryStream } from "../../platform/stream";
import { StringUtils as SU } from "../../platform/string";
import { fourCC } from "../../primitives";
import { EventEmitter, type EventEmitterConsumer } from "../../util/event-emitter";
import { type OpResult, opFailure, opSuccess } from "../../util/op-result";
import {
  type BrainDefEvents,
  getPageIdFromTileId,
  type IBrain,
  type IBrainDef,
  type IBrainPageDef,
  type ITileCatalog,
  isPageTileId,
  mkPageTileId,
} from "../interfaces";
import { Brain } from "../runtime";
import { getBrainServices } from "../services";
import { type CatalogTileJson, TileCatalog } from "../tiles/catalog";
import { BrainTilePageDef } from "../tiles/pagetiles";
import { BrainPageDef, type PageJson } from "./pagedef";
import type { RuleJson } from "./ruledef";

export interface BrainJson {
  version: number;
  name: string;
  catalog: ReadonlyList<CatalogTileJson>;
  pages: ReadonlyList<PageJson>;
}

// Maximum allowed length for brain names.
// WARNING: This value must never be lowered, as it could invalidate existing saves. It may be safely increased.
export const kMaxBrainNameLength = 100; // never reduce this value!

// Maximum allowed number of pages in a brain.
// WARNING: This value must never be lowered, as it could invalidate existing saves. It may be safely increased.
export const kMaxBrainPageCount = 20; // never reduce this value!

export enum BrainDefWarningCode {
  MaxPagesExceeded = "MaxPagesExceeded",
  PageIndexOutOfBounds = "PageIndexOutOfBounds",
}

// Current serialization version -- shared by both binary and JSON codepaths.
const kVersion = 1;

// Serialization tags
const STags = {
  BRAN: fourCC("BRAN"), // Brain chunk
  NAME: fourCC("NAME"), // Brain name
  PGCT: fourCC("PGCT"), // Page count
};

// -- JSON plain-object conversion helpers ------------------------------------
// JSON.stringify serializes List<T> as T[] (via List.toJSON). When the result
// is read back with JSON.parse all collections are plain arrays, not List<T>.
// The exported brainJsonFromPlain converts the raw JSON.parse output into the
// List-based BrainJson expected by BrainDef.fromJson.

function convertPlainRule_(plain: unknown): RuleJson {
  const r = plain as { version: number; when: string[]; do: string[]; children: unknown[]; comment?: string };
  const plainChildren = List.from(r.children);
  const children = new List<RuleJson>();
  for (let i = 0; i < plainChildren.size(); i++) {
    children.push(convertPlainRule_(plainChildren.get(i)));
  }
  const json: RuleJson = { version: r.version, when: List.from(r.when), do: List.from(r.do), children };
  if (r.comment !== undefined) {
    json.comment = r.comment;
  }
  return json;
}

function convertPlainPage_(plain: unknown): PageJson {
  const p = plain as { version: number; pageId: string; name: string; rules: unknown[] };
  const plainRules = List.from(p.rules);
  const rules = new List<RuleJson>();
  for (let i = 0; i < plainRules.size(); i++) {
    rules.push(convertPlainRule_(plainRules.get(i)));
  }
  return { version: p.version, pageId: p.pageId, name: p.name, rules };
}

/**
 * Convert a plain JavaScript object produced by JSON.parse into the
 * List-based BrainJson required by BrainDef.fromJson.
 *
 * JSON.stringify serializes List<T> as a plain T[] array, so a JSON
 * round-trip through JSON.parse produces plain arrays rather than Lists.
 * Call this function on the JSON.parse output before passing it to fromJson.
 */
export function brainJsonFromPlain(plain: unknown): BrainJson {
  const obj = plain as { version: number; name: string; catalog: CatalogTileJson[]; pages: unknown[] };
  const catalog = List.from(obj.catalog);
  const plainPages = List.from(obj.pages);
  const pages = new List<PageJson>();
  for (let i = 0; i < plainPages.size(); i++) {
    pages.push(convertPlainPage_(plainPages.get(i)));
  }
  return { version: obj.version, name: obj.name, catalog, pages };
}

export class BrainDef implements IBrainDef {
  private name_: string = "Unnamed Brain"; // TODO: i18n
  private readonly pages_ = new List<BrainPageDef>();
  private readonly emitter_ = new EventEmitter<BrainDefEvents>();
  private readonly pageSubscriptions_ = new Dict<BrainPageDef, () => void>();
  private readonly catalog_ = new TileCatalog();

  static emptyBrainDef(name?: string): BrainDef {
    const brainDef = new BrainDef();
    if (name) {
      brainDef.setName(name);
    }
    brainDef.appendNewPage();
    return brainDef;
  }

  pages(): List<IBrainPageDef> {
    return this.pages_ as unknown as List<IBrainPageDef>;
  }

  events(): EventEmitterConsumer<BrainDefEvents> {
    return this.emitter_.consumer();
  }

  name(): string {
    return this.name_;
  }

  catalog(): ITileCatalog {
    return this.catalog_;
  }

  setName(newName: string) {
    newName = newName || "Unnamed Brain"; // TODO: i18n
    if (newName === this.name_) {
      return;
    }
    if (SU.length(newName) > kMaxBrainNameLength) {
      newName = SU.substring(newName, 0, kMaxBrainNameLength);
    }
    const oldName = this.name_;
    this.name_ = newName;
    this.emitter_.emit("name_changed", { oldName, newName });
  }

  typecheck(): void {
    this.pages_.forEach((page) => {
      page.typecheck();
    });
  }

  compile(): IBrain {
    return new Brain(this);
  }

  appendNewPage(): OpResult<{ page: BrainPageDef; index: number }> {
    const page = new BrainPageDef();
    const addPageResult = this.addPage(page);
    if (!addPageResult.success) {
      return opFailure(BrainDefWarningCode.MaxPagesExceeded);
    }
    // Add a blank rule to the new page
    const rule = page.appendNewRule();
    const index = this.pages_.size() - 1;
    this.emitter_.emit("brain_changed", { what: "page_added" });
    rule.typecheck();
    return opSuccess({ page, index });
  }

  addPage(page: BrainPageDef): OpResult<{ page: BrainPageDef; index: number }> {
    if (this.pages_.size() >= kMaxBrainPageCount) {
      return opFailure(BrainDefWarningCode.MaxPagesExceeded);
    }
    this.pages_.push(page);
    page.setBrain(this);
    this.subscribeToPage_(page);
    const index = this.pages_.size() - 1;
    this.syncPageTiles_();
    this.emitter_.emit("brain_changed", { what: "page_added" });
    page.typecheck();
    return opSuccess({ page, index });
  }

  removePageAtIndex(index: number): OpResult<boolean> {
    const page = this.pages_.get(index);
    if (page) {
      this.unsubscribeFromPage_(page);
      page.setBrain(undefined);
      this.pages_.remove(index);
      this.syncPageTiles_();
      this.emitter_.emit("brain_changed", { what: "page_removed" });
      return opSuccess(true);
    }
    return opFailure(BrainDefWarningCode.PageIndexOutOfBounds);
  }

  insertPageAtIndex(index: number, page: BrainPageDef): OpResult<{ page: BrainPageDef; index: number }> {
    if (this.pages_.size() >= kMaxBrainPageCount) {
      return opFailure(BrainDefWarningCode.MaxPagesExceeded);
    }
    this.pages_.insert(index, page);
    page.setBrain(this);
    this.subscribeToPage_(page);
    this.syncPageTiles_();
    this.emitter_.emit("brain_changed", { what: "page_added" });
    page.typecheck();
    return opSuccess({ page, index });
  }

  insertNewPageAtIndex(index: number): OpResult<{ page: BrainPageDef; index: number }> {
    const page = new BrainPageDef();
    // Add a blank rule to the new page
    page.appendNewRule();
    return this.insertPageAtIndex(index, page);
  }

  containsTileId(tileId: string): boolean {
    for (let i = 0; i < this.pages_.size(); i++) {
      const page = this.pages_.get(i);
      if (page.containsTileId(tileId)) {
        return true;
      }
    }
    return false;
  }

  purgeUnusedTiles(): void {
    const allTiles = this.catalog_.getAll();
    const tilesToRemove = new List<string>();

    for (let i = 0; i < allTiles.size(); i++) {
      const tile = allTiles.get(i);
      if (!this.containsTileId(tile.tileId)) {
        tilesToRemove.push(tile.tileId);
      }
    }

    for (let i = 0; i < tilesToRemove.size(); i++) {
      const tileId = tilesToRemove.get(i);
      this.catalog_.delete(tileId);
    }

    // Re-sync page tiles after purge to ensure all living pages have tiles
    this.syncPageTiles_();
  }

  clone(): BrainDef {
    const stream = new MemoryStream();
    this.serialize(stream);
    const newBrain = new BrainDef();
    newBrain.deserialize(stream);
    return newBrain;
  }

  /**
   * Replace all content of this brain in-place with the content of the source
   * brain. The replacement is performed via a JSON round-trip so the resulting
   * data is fully independent of the source.
   *
   * Emits a single "brain_changed" event with what="brain_replaced" rather
   * than per-page events, so callers can update UI state in one shot.
   */
  replaceContentFrom(source: BrainDef): void {
    this.replaceContentFromJson(source.toJson());
  }

  /**
   * Replace all content of this brain in-place using the provided JSON
   * snapshot. Equivalent to replaceContentFrom but avoids an extra toJson()
   * call when the caller already holds a BrainJson (e.g. undo/redo commands).
   */
  replaceContentFromJson(json: BrainJson): void {
    // Unsubscribe and detach all existing pages.
    const pageCount = this.pages_.size();
    for (let i = 0; i < pageCount; i++) {
      const page = this.pages_.get(i);
      this.unsubscribeFromPage_(page);
      page.setBrain(undefined);
    }
    this.pages_.clear();

    // Clear catalog (page tiles, literals, variables, etc.).
    this.catalog_.clear();

    this.setName(json.name);
    this.catalog_.deserializeJson(json.catalog);

    const catalogs = new List<ITileCatalog>();
    catalogs.push(this.catalog_);
    catalogs.push(getBrainServices().tiles);

    for (let i = 0; i < json.pages.size(); i++) {
      const pageJson = json.pages.get(i);
      const page = new BrainPageDef(pageJson.pageId);
      this.pages_.push(page);
      page.setBrain(this);
      this.subscribeToPage_(page);
      page.deserializeJson(pageJson, catalogs);
    }

    this.syncPageTiles_();
    this.pages_.forEach((page) => {
      page.typecheck();
    });
    this.emitter_.emit("brain_changed", { what: "brain_replaced" });
  }

  toJson(): BrainJson {
    const pages = new List<PageJson>();
    for (let i = 0; i < this.pages_.size(); i++) {
      pages.push(this.pages_.get(i).toJson());
    }

    return { version: kVersion, name: this.name_, catalog: this.catalog_.toJson(), pages };
  }

  static fromJson(json: BrainJson): BrainDef {
    if (json.version !== kVersion) {
      throw new Error(`BrainDef.fromJson: unsupported version ${json.version}`);
    }

    const brain = new BrainDef();
    brain.setName(json.name);

    // Restore the local catalog first so tile references can be resolved
    brain.catalog_.deserializeJson(json.catalog);

    // Build the catalog chain: local catalog + global catalog
    const catalogs = new List<ITileCatalog>();
    catalogs.push(brain.catalog_);
    catalogs.push(getBrainServices().tiles);

    // Restore pages
    for (let i = 0; i < json.pages.size(); i++) {
      const pageJson = json.pages.get(i);
      const page = new BrainPageDef(pageJson.pageId);
      brain.addPage(page);
      page.deserializeJson(pageJson, catalogs);
    }

    return brain;
  }

  serialize(stream: IWriteStream): void {
    stream.pushChunk(STags.BRAN, kVersion);
    stream.writeTaggedString(STags.NAME, this.name_);
    this.catalog_.serialize(stream);
    stream.writeTaggedU32(STags.PGCT, this.pages_.size());
    this.pages_.forEach((page) => {
      page.serialize(stream);
    });
    stream.popChunk();
  }

  deserialize(stream: IReadStream): void {
    if (this.pages_.size() > 0) {
      throw new Error(`BrainDef.deserialize: BrainDef must be empty before deserializing`);
    }
    const version = stream.enterChunk(STags.BRAN);
    if (version !== kVersion) {
      throw new Error(`BrainDef.deserialize: unsupported version ${version}`);
    }
    try {
      const name = stream.readTaggedString(STags.NAME);
      this.setName(name);
      this.catalog_.deserialize(stream);
      const pageCount = stream.readTaggedU32(STags.PGCT);
      for (let i = 0; i < pageCount; i++) {
        const page = new BrainPageDef();
        this.addPage(page); // add before deserializing to set up brain associateion, so rules can read local catalog
        page.deserialize(stream);
      }
      // Reconcile page tiles after all pages are loaded (handles v1 saves that
      // lack page tiles, and ensures visual labels match deserialized page names)
      this.syncPageTiles_();
    } catch (e) {
      // Clean up partially deserialized pages
      this.pages_.forEach((page) => {
        this.unsubscribeFromPage_(page);
        page.setBrain(undefined);
      });
      this.pages_.clear();
      throw e;
    } finally {
      try {
        stream.leaveChunk();
      } catch {}
    }
  }

  /**
   * Ensures that every living page has a corresponding BrainTilePageDef in the
   * local catalog with an up-to-date display label, and that tiles whose pages
   * no longer exist are marked hidden.
   */
  private syncPageTiles_(): void {
    // Collect the set of pageIds that currently exist
    const livingPageIds = new Dict<string, BrainPageDef>();
    for (let i = 0; i < this.pages_.size(); i++) {
      const page = this.pages_.get(i);
      livingPageIds.set(page.pageId(), page);
    }

    // Ensure each living page has a tile; update label if needed
    const pageIds = livingPageIds.keys();
    for (let i = 0; i < pageIds.size(); i++) {
      const pageId = pageIds.get(i);
      const page = livingPageIds.get(pageId)!;
      const tileId = mkPageTileId(pageId);

      const existing = this.catalog_.get(tileId) as BrainTilePageDef | undefined;
      if (existing && existing.kind === "page") {
        // Update label and unhide
        if (existing.visual) {
          existing.visual.label = page.name();
        }
        existing.hidden = false;
      } else {
        // Create a new page tile
        const tileDef = new BrainTilePageDef(pageId, page.name());
        this.catalog_.registerTileDef(tileDef);
      }
    }

    // Hide orphaned page tiles (page was removed)
    const allTiles = this.catalog_.getAll();
    for (let i = 0; i < allTiles.size(); i++) {
      const tile = allTiles.get(i);
      if (isPageTileId(tile.tileId)) {
        const tilePageId = getPageIdFromTileId(tile.tileId);
        if (tilePageId !== undefined && !livingPageIds.has(tilePageId)) {
          tile.hidden = true;
        }
      }
    }
  }

  private subscribeToPage_(page: BrainPageDef): void {
    // Unsubscribe first if already subscribed (safety)
    this.unsubscribeFromPage_(page);

    const unsubPageChanged = page.events().on("page_changed", (data) => {
      this.emitter_.emit("brain_changed", {
        what: "page_changed",
        pageWhat: data.what,
        ruleWhat: data.ruleWhat,
      });
    });
    const unsubNameChanged = page.events().on("name_changed", () => {
      this.syncPageTiles_();
    });
    const unsubscribe = () => {
      unsubPageChanged();
      unsubNameChanged();
    };
    this.pageSubscriptions_.set(page, unsubscribe);
  }

  private unsubscribeFromPage_(page: BrainPageDef): void {
    const unsubscribe = this.pageSubscriptions_.get(page);
    if (unsubscribe) {
      unsubscribe();
      this.pageSubscriptions_.delete(page);
    }
  }
}
