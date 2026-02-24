import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List } from "../../platform/list";
import { type IReadStream, type IWriteStream, MemoryStream } from "../../platform/stream";
import { task, type thread } from "../../platform/task";
import { fourCC } from "../../primitives";
import { EventEmitter, type EventEmitterConsumer } from "../../util";
import { parseRule } from "../compiler";
import {
  type BrainRuleDefEvents,
  type IBrainDef,
  type IBrainPageDef,
  type IBrainRuleDef,
  type IBrainTileSet,
  type ITileCatalog,
  RuleSide,
} from "../interfaces";
import { getBrainServices } from "../services";
import { BrainTileSet } from "./tileset";

// Maximum allowed depth for rules in the tree
// WARNING: This value must never be lowered, as it could invalidate existing saves. It may be safely increased.
export const kMaxBrainRuleDepth = 20; // never reduce this value!

// Serialization tags
const STags = {
  RUL1: fourCC("RUL1"), // Brain rule chunk
  RUL2: fourCC("RUL2"), // Brain rule chunk -- this level only
  RUL3: fourCC("RUL3"), // Brain rule chunk -- without children
  WHCT: fourCC("WHCT"), // When tile count
  DOCT: fourCC("DOCT"), // Do tile count
  CRCT: fourCC("CRCT"), // Child rule count
};

export class BrainRuleDef implements IBrainRuleDef {
  private page_?: IBrainPageDef;
  private ancestor_?: BrainRuleDef; // Next rule up in the tree, if any
  private readonly children_ = new List<BrainRuleDef>();
  private readonly emitter_ = new EventEmitter<BrainRuleDefEvents>();
  private when_: BrainTileSet;
  private do_: BrainTileSet;
  private readonly tileSetSubscriptions_ = new Dict<BrainTileSet, () => void>();
  private readonly childRuleSubscriptions_ = new Dict<BrainRuleDef, () => void>();
  private dirtyChangedDebounceThread_?: thread;

  constructor() {
    this.when_ = new BrainTileSet(this, RuleSide.When);
    this.do_ = new BrainTileSet(this, RuleSide.Do);
    this.subscribeToTileSet_(this.when_);
    this.subscribeToTileSet_(this.do_);
  }

  /**
   * Clean up all subscriptions. Called when rule is being destroyed.
   */
  private dispose_(): void {
    // Cancel any pending debounced emissions
    if (this.dirtyChangedDebounceThread_) {
      task.cancel(this.dirtyChangedDebounceThread_);
      this.dirtyChangedDebounceThread_ = undefined;
    }
    // Unsubscribe from tilesets
    this.unsubscribeFromTileSet_(this.when_);
    this.unsubscribeFromTileSet_(this.do_);
    // Unsubscribe from all children
    this.children_.forEach((child) => {
      this.unsubscribeFromChildRule_(child);
    });
  }

  when(): BrainTileSet {
    return this.when_;
  }

  do(): BrainTileSet {
    return this.do_;
  }

  side(side: RuleSide): IBrainTileSet {
    if (side === RuleSide.When) {
      return this.when_;
    } else if (side === RuleSide.Do) {
      return this.do_;
    }
    throw new Error(`Invalid RuleSide: ${side}`);
  }

  children(): List<IBrainRuleDef> {
    return this.children_ as unknown as List<IBrainRuleDef>;
  }

  events(): EventEmitterConsumer<BrainRuleDefEvents> {
    return this.emitter_.consumer();
  }

  ancestor(): IBrainRuleDef | undefined {
    return this.ancestor_ as unknown as IBrainRuleDef | undefined;
  }

  setAncestor(ancestor: IBrainRuleDef | undefined): void {
    this.ancestor_ = ancestor as BrainRuleDef | undefined;
  }

  isDirty(): boolean {
    if (this.when_.isDirty() || this.do_.isDirty()) {
      return true;
    }
    if (this.children_.some((child) => child.isDirty())) {
      return true;
    }
    return false;
  }

  markDirty(): void {
    this.when_.markDirty();
    this.do_.markDirty();
    this.children_.forEach((child) => {
      child.markDirty();
    });
  }

  private gatherCatalogs(): List<ITileCatalog> {
    const catalogs = List.empty<ITileCatalog>();
    // push global catalog
    catalogs.push(getBrainServices().tiles);
    // push brain catalog
    const brainCatalog = this.page()?.brain()?.catalog();
    if (brainCatalog) {
      catalogs.push(brainCatalog);
    }
    // FUTURE: push ancestor rule catalogs
    let currentRule: IBrainRuleDef | undefined = this.ancestor_;
    while (currentRule) {
      currentRule = currentRule.ancestor();
    }
    return catalogs;
  }

  typecheck(): void {
    // Compile this rule if either side is dirty
    if (this.when_.isDirty() || this.do_.isDirty()) {
      const catalogs = this.gatherCatalogs();
      const whenTiles = this.when_.tiles();
      const doTiles = this.do_.tiles();

      // Compile both sides together
      const typecheckResult = parseRule(whenTiles, doTiles, catalogs);

      // Update both tilesets with the result
      this.when_.setTypecheckResult(typecheckResult);
      this.do_.setTypecheckResult(typecheckResult);
    }

    // Compile children
    this.children_.forEach((child) => {
      child.typecheck();
    });
  }

  page(): IBrainPageDef | undefined {
    if (this.ancestor_) {
      return this.ancestor_.page();
    }
    return this.page_;
  }

  setPage(page: IBrainPageDef | undefined): void {
    this.page_ = page;
  }

  brain(): IBrainDef | undefined {
    const page = this.page();
    return page?.brain();
  }

  /**
   * Get the index of this rule in its parent's children list or page's children list.
   * Returns -1 if not found.
   */
  private myIndex_(): number {
    if (this.ancestor_) {
      return this.ancestor_.children_.indexOf(this);
    }
    const page = this.page();
    if (!page) return -1;
    return page.children().indexOf(this);
  }

  myDepth(): number {
    let depth = 0;
    let current = this.ancestor_;
    while (current) {
      depth++;
      current = current.ancestor_;
    }
    return depth;
  }

  /**
   * Returns a human-readable location path for this rule within the brain.
   * Format: "Page Name/Rule N/Rule M/Rule K"
   * Example: "My Page/Rule 2/Rule 3" means the third child of the second root-level rule in the page named "My Page".
   * Returns empty string if the rule is not attached to a page.
   */
  getLocationPath(): string {
    const page = this.page();
    if (!page) {
      return "";
    }

    // Build the path from root to this rule
    const pathParts = new List<string>();
    let current: BrainRuleDef | undefined = this;

    while (current) {
      const index = current.myIndex_();
      if (index < 0) {
        // Rule not properly attached
        return "";
      }
      // Add 1 to convert from 0-based to 1-based index
      pathParts.insert(0, `Rule ${index + 1}`);
      current = current.ancestor_;
    }

    // Build the final path string
    const pageName = page.name();
    pathParts.insert(0, pageName);
    return pathParts.toArray().join("/");
  }

  maxDepth(): number {
    if (this.children_.size() === 0) return 0;
    let maxDepth = 0;
    // Find max depth among children
    this.children_.forEach((child) => {
      const childDepth = child.maxDepth();
      if (childDepth > maxDepth) {
        maxDepth = childDepth;
      }
    });
    return 1 + maxDepth;
  }

  canMoveUp(): boolean {
    const index = this.myIndex_();
    return index > 0;
  }

  canMoveDown(): boolean {
    const index = this.myIndex_();
    if (index < 0) return false;
    const siblingCount = this.ancestor_ ? this.ancestor_.children_.size() : (this.page()?.children().size() ?? 0);
    return index < siblingCount - 1;
  }

  canIndent(): boolean {
    const index = this.myIndex_();
    if (index <= 0) return false;
    // If we would exceed max depth, can't indent
    const myDepth = this.myDepth();
    const maxDepth = this.maxDepth();
    return myDepth + 1 + maxDepth <= kMaxBrainRuleDepth;
  }

  canOutdent(): boolean {
    // Can only outdent if we have an ancestor
    return this.ancestor_ !== undefined;
  }

  moveUp(): boolean {
    if (!this.canMoveUp()) return false;
    const index = this.myIndex_();
    if (index <= 0) return false; // Safety check

    if (this.ancestor_) {
      this.ancestor_.children_.remove(index);
      this.ancestor_.children_.insert(index - 1, this);
    } else {
      const page = this.page();
      if (!page) return false;
      page.children().remove(index);
      page.children().insert(index - 1, this);
    }
    this.markDirty();
    return true;
  }

  moveDown(): boolean {
    if (!this.canMoveDown()) return false;
    const index = this.myIndex_();
    if (index < 0) return false; // Safety check

    if (this.ancestor_) {
      this.ancestor_.children_.remove(index);
      this.ancestor_.children_.insert(index + 1, this);
    } else {
      const page = this.page();
      if (!page) return false;
      page.children().remove(index);
      page.children().insert(index + 1, this);
    }
    this.markDirty();
    return true;
  }

  indent(): boolean {
    if (!this.canIndent()) return false;

    const index = this.myIndex_();
    if (index <= 0) return false; // Safety check

    // Get the previous sibling that will become our new parent
    const newParent = this.ancestor_
      ? this.ancestor_.children_.get(index - 1)
      : this.page()
          ?.children()
          .get(index - 1);

    if (!newParent) return false;

    // Double-check depth constraint
    const newDepth = newParent.myDepth() + 1;
    if (newDepth + this.maxDepth() > kMaxBrainRuleDepth) return false;

    // Remove from current parent/page
    if (this.ancestor_) {
      this.ancestor_.children_.remove(index);
      this.ancestor_.unsubscribeFromChildRule_(this);
    } else {
      const page = this.page();
      if (!page) return false;
      page.children().remove(index);
    }

    // Add to new parent (cast is safe - we know it's a BrainRuleDef internally)
    const newParentImpl = newParent as BrainRuleDef;
    newParentImpl.children_.push(this);
    newParentImpl.subscribeToChildRule_(this);
    this.setAncestor(newParent);
    this.markDirty();
    return true;
  }

  outdent(): boolean {
    if (!this.canOutdent()) return false;
    if (!this.ancestor_) return false; // Safety check (redundant with canOutdent but explicit)

    const parent = this.ancestor_;
    const index = this.myIndex_();
    if (index < 0) return false; // Safety check

    // Remove from current parent
    parent.children_.remove(index);
    parent.unsubscribeFromChildRule_(this);

    const grandParent = parent.ancestor_;
    if (grandParent) {
      // Insert right after the parent in grandparent's children
      const parentIndex = grandParent.children_.indexOf(parent);
      if (parentIndex < 0) return false; // Safety check
      grandParent.children_.insert(parentIndex + 1, this);
      grandParent.subscribeToChildRule_(this);
      this.setAncestor(grandParent);
    } else {
      // Outdenting to page level
      const page = this.page();
      if (!page) return false;
      const parentIndex = page.children().indexOf(parent);
      if (parentIndex < 0) return false; // Safety check
      page.children().insert(parentIndex + 1, this);
      this.setAncestor(undefined);
    }

    this.markDirty();
    return true;
  }

  delete(): boolean {
    const parent = this.ancestor_;
    if (parent) {
      const index = parent.children_.indexOf(this);
      if (index >= 0) {
        parent.children_.remove(index);
        parent.unsubscribeFromChildRule_(this);
      }
      // Signal structural change so it propagates up to the page
      parent.emitDirtyChangedDebounced_();
    } else {
      // We're at page level
      const page = this.page();
      if (!page) return false;
      const index = page.children().indexOf(this);
      if (index >= 0) {
        page.children().remove(index);
      }
    }

    // Clean up this rule's state
    this.ancestor_ = undefined;
    this.emitter_.emit("rule_deleted", {});

    // Dispose of all subscriptions
    this.dispose_();

    // Delete children recursively after cleanup (to help GC)
    this.children_.forEach((child) => {
      child.delete();
    });

    return true;
  }

  appendNewRule(): BrainRuleDef {
    const rule = new BrainRuleDef();
    this.children_.push(rule);
    rule.ancestor_ = this;
    this.subscribeToChildRule_(rule);
    rule.markDirty();
    return rule;
  }

  addRuleAtIndex(index: number, rule: BrainRuleDef): void {
    this.children_.insert(index, rule);
    rule.ancestor_ = this;
    this.subscribeToChildRule_(rule);
    rule.markDirty();
  }

  removeRuleAtIndex(index: number): BrainRuleDef | undefined {
    const rule = this.children_.get(index);
    if (rule) {
      this.children_.remove(index);
      this.unsubscribeFromChildRule_(rule);
      rule.ancestor_ = undefined;
      rule.markDirty();
      return rule;
    }
    return undefined;
  }

  containsTileId(tileId: string): boolean {
    if (this.when_.containsTileId(tileId)) {
      return true;
    }
    if (this.do_.containsTileId(tileId)) {
      return true;
    }
    // Check child rules recursively
    for (let i = 0; i < this.children_.size(); i++) {
      if (this.children_.get(i).containsTileId(tileId)) {
        return true;
      }
    }
    return false;
  }

  isEmpty(inclChildren: boolean = false): boolean {
    // recursively check if children are empty too
    if (inclChildren) {
      for (let i = 0; i < this.children_.size(); i++) {
        const child = this.children_.get(i);
        if (child && !child.isEmpty(true)) {
          return false;
        }
      }
    }
    return this.when_.isEmpty() && this.do_.isEmpty();
  }

  clone(): BrainRuleDef {
    const stream = new MemoryStream();
    this.serialize(stream);
    stream.resetRead(); // Reset stream read position to beginning
    const newRule = new BrainRuleDef();
    // pass in brain's local catalog for deserialization of full-save tiles (like literals and variables)
    newRule.deserialize(stream, this.brain()?.catalog() ? List.from([this.brain()!.catalog()]) : undefined);
    // Note: new rule is unpaged (page_ is undefined) and has fresh subscriptions
    return newRule;
  }

  serialize(stream: IWriteStream): void {
    stream.writeTaggedU8(STags.RUL1, 1); // version of this chunk
    this.serializeThisLevelOnly(stream);
    // write child rules
    stream.writeTaggedU32(STags.CRCT, this.children_.size());
    this.children_.forEach((child) => {
      child.serialize(stream);
    });
  }

  serializeThisLevelOnly(stream: IWriteStream): void {
    stream.writeTaggedU8(STags.RUL2, 1); // version of this chunk
    this.when_.serialize(stream);
    this.do_.serialize(stream);
  }

  serializeWithoutChildren(stream: IWriteStream): void {
    stream.writeTaggedU8(STags.RUL3, 1); // version of this chunk
    this.serializeThisLevelOnly(stream);
    stream.writeTaggedU32(STags.CRCT, 0); // zero child rules
  }

  deserialize(stream: IReadStream, catalogs?: List<ITileCatalog>): void {
    const version = stream.readTaggedU8(STags.RUL1);
    if (version !== 1) {
      throw new Error(`Unsupported BrainRuleDef version: ${version}`);
    }
    this.deserializeThisLevelOnly(stream, catalogs);

    // read child rules
    const childCount = stream.readTaggedU32(STags.CRCT);
    for (let i = 0; i < childCount; i++) {
      const child = new BrainRuleDef();
      child.setPage(this.page());
      child.deserialize(stream, catalogs);
      this.children_.push(child);
      child.ancestor_ = this;
      this.subscribeToChildRule_(child);
    }
  }

  deserializeThisLevelOnly(stream: IReadStream, catalogs_?: List<ITileCatalog>): void {
    const version = stream.readTaggedU8(STags.RUL2);
    if (version !== 1) {
      throw new Error(`Unsupported BrainRuleDef (this level only) version: ${version}`);
    }
    const catalogs = new List<ITileCatalog>();
    if (catalogs_) {
      catalogs.push(...catalogs_.toArray());
    }
    const brain = this.brain();
    if (brain?.catalog()) {
      catalogs.push(brain.catalog());
    }
    catalogs.push(getBrainServices().tiles); // global catalog
    this.when_.deserialize(stream, catalogs);
    this.do_.deserialize(stream, catalogs);
  }

  /**
   * Emit the rule_dirtyChanged event with debouncing.
   * Cancels any pending emission and schedules a new one.
   */
  private emitDirtyChangedDebounced_(): void {
    // Cancel any pending emission
    if (this.dirtyChangedDebounceThread_) {
      task.cancel(this.dirtyChangedDebounceThread_);
    }
    // Schedule new emission with a small delay (0.05 seconds / 50ms)
    this.dirtyChangedDebounceThread_ = task.delay(0.05, () => {
      this.dirtyChangedDebounceThread_ = undefined;
      this.emitter_.emit("rule_dirtyChanged", { isDirty: this.isDirty() });
    });
  }

  private subscribeToTileSet_(tileSet: BrainTileSet): void {
    // Unsubscribe first if already subscribed (safety)
    this.unsubscribeFromTileSet_(tileSet);

    const unsubTileSetChanged = tileSet.events().on("tileSet_dirtyChanged", (data) => {
      if (data.isDirty && data.side === RuleSide.When) {
        // DO side may have dependencies on WHEN side, so mark it dirty too
        this.do_.markDirty();
        // Similarly, mark all children dirty
        this.children_.forEach((child) => {
          child.markDirty();
        });
      }
      this.emitDirtyChangedDebounced_();
    });
    const unsubTileSetTypechecked = tileSet.events().on("tileSet_typechecked", (data) => {
      // Don't emit anything here for now
    });

    const unsubscribeAll = () => {
      unsubTileSetChanged();
      unsubTileSetTypechecked();
    };

    this.tileSetSubscriptions_.set(tileSet, unsubscribeAll);
  }

  private unsubscribeFromTileSet_(tileSet: BrainTileSet): void {
    const unsubscribe = this.tileSetSubscriptions_.get(tileSet);
    if (unsubscribe) {
      unsubscribe();
      this.tileSetSubscriptions_.delete(tileSet);
    }
  }

  private subscribeToChildRule_(childRule: BrainRuleDef): void {
    // Unsubscribe first if already subscribed (safety)
    this.unsubscribeFromChildRule_(childRule);

    const unsubRuleDeleted = childRule.events().on("rule_deleted", () => {
      // Child rule deleted event can be used to clean up or propagate
      // For now, we just listen to it
    });
    const unsubRuleMarkedDirty = childRule.events().on("rule_dirtyChanged", ({ isDirty }) => {
      // Propagate dirty state up to parent
      this.emitDirtyChangedDebounced_();
    });

    const unsubscribeAll = () => {
      unsubRuleDeleted();
      unsubRuleMarkedDirty();
    };

    this.childRuleSubscriptions_.set(childRule, unsubscribeAll);
  }

  private unsubscribeFromChildRule_(childRule: BrainRuleDef): void {
    const unsubscribe = this.childRuleSubscriptions_.get(childRule);
    if (unsubscribe) {
      unsubscribe();
      this.childRuleSubscriptions_.delete(childRule);
    }
  }
}
