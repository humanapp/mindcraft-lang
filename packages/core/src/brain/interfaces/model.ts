import type { List, ReadonlyList } from "../../platform/list";
import type { EventEmitterConsumer } from "../../util/event-emitter";
import type { OpResult } from "../../util/op-result";
import type { ITileCatalog } from "./catalog";
import type { IConversionRegistry } from "./conversions";
import type { IBrain } from "./runtime";
import type { IBrainTileDef, RuleSide } from "./tiles";

// ----------------------------------------------------
// Brain, Page, Rule, and Tile Definitions
// ----------------------------------------------------

/** Events emitted by an {@link IBrainDef}. */
export type BrainDefEvents = {
  name_changed: { oldName: string; newName: string };
  brain_changed: { what: string; pageWhat?: unknown; ruleWhat?: unknown };
};

/** Definition of a brain: name, pages, catalogs, and conversion registry. Compile to an {@link IBrain} via `compile()`. */
export interface IBrainDef {
  name(): string;
  setName(newName: string): void;
  pages(): ReadonlyList<IBrainPageDef>;
  events(): EventEmitterConsumer<BrainDefEvents>;
  catalog(): ITileCatalog;
  servicesTiles(): ITileCatalog;
  deserializationCatalogs(): List<ITileCatalog>;
  servicesConversions(): IConversionRegistry;
  typecheck(): void;
  compile(): IBrain;
  appendNewPage(): OpResult<{ page: IBrainPageDef; index: number }>;
  addPage(page: IBrainPageDef): OpResult<{ page: IBrainPageDef; index: number }>;
  removePageAtIndex(index: number): OpResult<boolean>;
  insertPageAtIndex(index: number, page: IBrainPageDef): OpResult<{ page: IBrainPageDef; index: number }>;
  insertNewPageAtIndex(index: number): OpResult<{ page: IBrainPageDef; index: number }>;
  containsTileId(tileId: string): boolean;
  purgeUnusedTiles(): void;
  toJson(): unknown;
}

/** Events emitted by an {@link IBrainPageDef}. */
export type BrainPageDefEvents = {
  name_changed: { oldName: string; newName: string };
  page_changed: { what: string; ruleWhat?: unknown };
};

/** Definition of a single page in a brain: an ordered list of rules. */
export interface IBrainPageDef {
  pageId(): string;
  name(): string;
  setName(newName: string): void;
  brain(): IBrainDef | undefined;
  children(): List<IBrainRuleDef>;
  events(): EventEmitterConsumer<BrainPageDefEvents>;
  clone(): IBrainPageDef;
  typecheck(): void;
  appendNewRule(): IBrainRuleDef | undefined;
  addRuleAtIndex(index: number, rule: IBrainRuleDef): void;
  removeRuleAtIndex(index: number): IBrainRuleDef | undefined;
  containsTileId(tileId: string): boolean;
}

/** Events emitted by an {@link IBrainRuleDef}. */
export type BrainRuleDefEvents = {
  rule_deleted: {};
  rule_dirtyChanged: { isDirty: boolean };
};

/** Definition of a single rule within a page: a `when` tile-set and a `do` tile-set, plus child rules and metadata. */
export interface IBrainRuleDef {
  id(): number;
  page(): IBrainPageDef | undefined;
  setPage(page: IBrainPageDef | undefined): void;
  ancestor(): IBrainRuleDef | undefined;
  setAncestor(ancestor: IBrainRuleDef | undefined): void;
  comment(): string | undefined;
  setComment(comment: string | undefined): void;
  isDirty(): boolean;
  markDirty(): void;
  typecheck(): void;
  when(): IBrainTileSet;
  do(): IBrainTileSet;
  side(side: RuleSide): IBrainTileSet;
  children(): List<IBrainRuleDef>;
  events(): EventEmitterConsumer<BrainRuleDefEvents>;
  myDepth(): number;
  maxDepth(): number;
  getLocationPath(): string;
  canMoveUp(): boolean;
  canMoveDown(): boolean;
  canIndent(): boolean;
  canOutdent(): boolean;
  moveUp(): void;
  moveDown(): void;
  indent(): void;
  outdent(): void;
  isEmpty(inclChildren: boolean): boolean;
  clone(): IBrainRuleDef;
}

/** Events emitted by an {@link IBrainTileSet}. */
export type BrainTileSetEvents = {
  tileSet_dirtyChanged: { side: RuleSide; isDirty: boolean };
  tileSet_typechecked: { side: RuleSide; typecheckResult?: unknown };
};

/** Ordered set of tiles backing one side (`when` or `do`) of a rule. */
export interface IBrainTileSet {
  rule(): IBrainRuleDef | undefined;
  side(): RuleSide;
  tiles(): ReadonlyList<IBrainTileDef>;
  events(): EventEmitterConsumer<BrainTileSetEvents>;
  isDirty(): boolean;
  markDirty(): void;
  appendTile(tileDef: IBrainTileDef): void;
  insertTileAtIndex(index: number, tileDef: IBrainTileDef): void;
  replaceTileAtIndex(index: number, tileDef: IBrainTileDef): boolean;
  removeTileAtIndex(index: number): void;
  containsTileId(tileId: string): boolean;
  isEmpty(): boolean;
}
