import type { Localizer } from "../../localization/localizer";
import type { List, ReadonlyList } from "../../platform/list";
import type { IConversionRegistry } from "../../runtime/conversion-defs";
import type { IBrain } from "../../runtime/host-bindings";
import type { IOperatorOverloads } from "../../runtime/operator-defs";
import type { IRngServices } from "../../runtime/services";
import type { ITypeRegistry } from "../../runtime/type-defs";
import type { EventEmitterConsumer } from "../../util/event-emitter";
import type { OpResult } from "../../util/op-result";
import type { ITileCatalog } from "./catalog";
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
  /** Stable, unique identifier for this brain. Assigned at creation and preserved across serialization. */
  id(): string;
  name(): string;
  setName(newName: string): void;
  pages(): ReadonlyList<IBrainPageDef>;
  events(): EventEmitterConsumer<BrainDefEvents>;
  catalog(): ITileCatalog;
  servicesTiles(): ITileCatalog;
  deserializationCatalogs(): List<ITileCatalog>;
  servicesConversions(): IConversionRegistry;
  servicesTypeRegistry(): ITypeRegistry;
  servicesOperatorOverloads(): IOperatorOverloads;
  /** The display-time localizer edit-time code renders user-visible text through. */
  servicesLocalizer(): Localizer;
  /** The environment's random stream, which this document's brain, page, and rule ids are minted from. */
  servicesRng(): IRngServices;
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
  /** Id this rule is addressed by, stable across every structural edit around it. */
  ruleId(): string;
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
