import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List, type ReadonlyList } from "../../platform/list";
import { StringUtils as SU } from "../../platform/string";
import { task, type thread } from "../../platform/task";
import { EventEmitter, type EventEmitterConsumer } from "../../util";
import { parseRule } from "../compiler";
import {
  type BrainRuleDefEvents,
  type IBrainDef,
  type IBrainPageDef,
  type IBrainRuleDef,
  type IBrainTileSet,
  type IConversionRegistry,
  type ITileCatalog,
  RuleSide,
} from "../interfaces";
import type { BrainPageDef } from "./pagedef";
import { BrainTileSet } from "./tileset";

export interface RuleJson {
  version: number;
  when: ReadonlyList<string>;
  do: ReadonlyList<string>;
  children: ReadonlyList<RuleJson>;
  comment?: string;
}

// Maximum allowed depth for rules in the tree
// WARNING: This value must never be lowered, as it could invalidate existing saves. It may be safely increased.
export const kMaxBrainRuleDepth = 20; // never reduce this value!

// Maximum allowed length for a rule comment.
// WARNING: This value must never be lowered, as it could invalidate existing saves. It may be safely increased.
export const kMaxBrainRuleCommentLength = 500; // never reduce this value!

// JSON serialization version.
const kVersion = 1;

// Module-scoped counter for assigning stable, process-unique ids to rules.
// Used by UI layers as a React key so that structural moves do not unmount
// the dragged rule mid-drag.
let nextRuleId_ = 1;

export class BrainRuleDef implements IBrainRuleDef {
  private readonly id_: number;
  private page_?: IBrainPageDef;
  private ancestor_?: BrainRuleDef; // Next rule up in the tree, if any
  private readonly children_ = new List<BrainRuleDef>();
  private readonly emitter_ = new EventEmitter<BrainRuleDefEvents>();
  private when_: BrainTileSet;
  private do_: BrainTileSet;
  private comment_?: string;
  private readonly tileSetSubscriptions_ = new Dict<BrainTileSet, () => void>();
  private readonly childRuleSubscriptions_ = new Dict<BrainRuleDef, () => void>();
  private dirtyChangedDebounceThread_?: thread;

  constructor() {
    this.id_ = nextRuleId_++;
    this.when_ = new BrainTileSet(this, RuleSide.When);
    this.do_ = new BrainTileSet(this, RuleSide.Do);
    this.subscribeToTileSet_(this.when_);
    this.subscribeToTileSet_(this.do_);
  }

  /**
   * Returns a stable, process-unique numeric id for this rule.
   * Useful as a React key during structural mutations.
   */
  id(): number {
    return this.id_;
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

  comment(): string | undefined {
    return this.comment_;
  }

  setComment(comment: string | undefined): void {
    if (comment !== undefined && SU.length(comment) > kMaxBrainRuleCommentLength) {
      comment = SU.substring(comment, 0, kMaxBrainRuleCommentLength);
    }
    this.comment_ = comment || undefined;
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
    const brain = this.page()?.brain();
    if (brain) {
      catalogs.push(brain.servicesTiles());
    }
    const brainCatalog = brain?.catalog();
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
      const brain = this.page()?.brain();
      const conversions = brain?.servicesConversions();

      if (conversions) {
        const typecheckResult = parseRule(whenTiles, doTiles, catalogs, conversions);
        this.when_.setTypecheckResult(typecheckResult);
        this.do_.setTypecheckResult(typecheckResult);
      }
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

  /**
   * Re-parent this rule to an arbitrary location within the same page.
   *
   * Exactly one of `newParent` or `newPage` must be provided. `newParent`
   * places the rule as a child of another rule; `newPage` places it at
   * page level. The rule is inserted at `newIndex` in the destination
   * children list. Children of this rule move with it as a subtree.
   *
   * Returns false (no-op) when:
   * - both/neither destination provided
   * - the move would exceed `kMaxBrainRuleDepth`
   * - `newParent` is this rule or one of its descendants
   * - the rule is not currently attached to a page
   *
   * Returns true on a successful move OR when the rule is already at the
   * requested location.
   */
  moveTo(newParent: BrainRuleDef | undefined, newPage: IBrainPageDef | undefined, newIndex: number): boolean {
    if ((newParent === undefined) === (newPage === undefined)) {
      return false;
    }

    // Cannot move under self/descendant
    if (newParent) {
      let cursor: BrainRuleDef | undefined = newParent;
      while (cursor) {
        if (cursor === this) return false;
        cursor = cursor.ancestor_;
      }
    }

    const newDepth = newParent ? newParent.myDepth() + 1 : 0;
    if (newDepth + this.maxDepth() > kMaxBrainRuleDepth) {
      return false;
    }

    const oldParent = this.ancestor_;
    const oldPage = oldParent ? undefined : (this.page() as IBrainPageDef | undefined);
    if (!oldParent && !oldPage) return false;
    const oldIndex = this.myIndex_();
    if (oldIndex < 0) return false;

    // Determine list relationship for no-op detection. `newIndex` is interpreted
    // as the final position in the destination list AFTER removal of this rule.
    const sameList = oldParent === newParent && oldPage === newPage;
    let targetIndex = newIndex;

    // No-op fast path: moving to the exact same slot.
    if (sameList && oldIndex === targetIndex) {
      return true;
    }

    // Remove from current location.
    if (oldParent) {
      oldParent.children_.remove(oldIndex);
      oldParent.unsubscribeFromChildRule_(this);
    } else if (oldPage) {
      oldPage.children().remove(oldIndex);
      (oldPage as BrainPageDef).unsubscribeFromRule_(this);
    }

    // Clamp to the destination list size after removal.
    if (newParent) {
      const size = newParent.children_.size();
      if (targetIndex < 0) targetIndex = 0;
      if (targetIndex > size) targetIndex = size;
      newParent.children_.insert(targetIndex, this);
      newParent.subscribeToChildRule_(this);
      this.setAncestor(newParent);
    } else if (newPage) {
      const pageChildren = newPage.children();
      const size = pageChildren.size();
      if (targetIndex < 0) targetIndex = 0;
      if (targetIndex > size) targetIndex = size;
      pageChildren.insert(targetIndex, this);
      this.setAncestor(undefined);
      (newPage as BrainPageDef).subscribeToRule_(this);
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
    const json = this.toJson();
    const brain = this.brain();
    const page = this.page();
    if (!brain || !page) {
      const newRule = new BrainRuleDef();
      return newRule;
    }
    return BrainRuleDef.fromJson(json, page, brain);
  }

  // -- JSON serialization ----------------------------------------------------

  toJson(): RuleJson {
    const childRules = new List<RuleJson>();
    for (let i = 0; i < this.children_.size(); i++) {
      childRules.push(this.children_.get(i).toJson());
    }

    const json: RuleJson = {
      version: kVersion,
      when: this.when_.toJson(),
      do: this.do_.toJson(),
      children: childRules,
    };
    if (this.comment_ !== undefined) {
      json.comment = this.comment_;
    }
    return json;
  }

  static fromJson(json: RuleJson, page: IBrainPageDef, brain: IBrainDef): BrainRuleDef {
    const catalogs = brain.deserializationCatalogs();
    const rule = new BrainRuleDef();
    rule.setPage(page);
    rule.deserializeJson(json, catalogs);
    return rule;
  }

  deserializeJson(json: RuleJson, catalogs: List<ITileCatalog>): void {
    if (json.version !== kVersion) {
      throw new Error(`BrainRuleDef.deserializeJson: unsupported version ${json.version}`);
    }
    this.when_.deserializeJson(json.when, catalogs);
    this.do_.deserializeJson(json.do, catalogs);
    this.comment_ = json.comment || undefined;

    // Recursively deserialize child rules
    for (let i = 0; i < json.children.size(); i++) {
      const child = new BrainRuleDef();
      child.setPage(this.page());
      child.deserializeJson(json.children.get(i), catalogs);
      this.children_.push(child);
      child.ancestor_ = this;
      this.subscribeToChildRule_(child);
    }
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
