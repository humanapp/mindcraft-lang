import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List } from "../../platform/list";
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
import { TileCatalog } from "../tiles/catalog";
import { BrainTilePageDef } from "../tiles/pagetiles";
import { BrainPageDef } from "./pagedef";

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

// Serialization tags
const STags = {
  BRAN: fourCC("BRAN"), // Brain chunk
  NAME: fourCC("NAME"), // Brain name
  PGCT: fourCC("PGCT"), // Page count
};

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
      // Never purge page tiles -- they are managed by syncPageTiles_
      if (isPageTileId(tile.tileId)) continue;
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

  serialize(stream: IWriteStream): void {
    stream.pushChunk(STags.BRAN, 1); // version
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
    if (version !== 1) {
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
