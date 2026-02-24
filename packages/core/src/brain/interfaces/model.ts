import type { List, ReadonlyList } from "../../platform/list";
import type { IReadStream, IWriteStream } from "../../platform/stream";
import type { EventEmitterConsumer } from "../../util/event-emitter";
import type { OpResult } from "../../util/op-result";
import type { ITileCatalog } from "./catalog";
import type { IBrain } from "./runtime";
import type { IBrainTileDef, RuleSide } from "./tiles";

// ----------------------------------------------------
// Brain, Page, Rule, and Tile Definitions
// ----------------------------------------------------

export type BrainDefEvents = {
  name_changed: { oldName: string; newName: string };
  brain_changed: { what: string; pageWhat?: unknown; ruleWhat?: unknown };
};

export interface IBrainDef {
  name(): string;
  setName(newName: string): void;
  pages(): ReadonlyList<IBrainPageDef>;
  events(): EventEmitterConsumer<BrainDefEvents>;
  catalog(): ITileCatalog;
  typecheck(): void;
  compile(): IBrain;
  appendNewPage(): OpResult<{ page: IBrainPageDef; index: number }>;
  addPage(page: IBrainPageDef): OpResult<{ page: IBrainPageDef; index: number }>;
  removePageAtIndex(index: number): OpResult<boolean>;
  insertPageAtIndex(index: number, page: IBrainPageDef): OpResult<{ page: IBrainPageDef; index: number }>;
  insertNewPageAtIndex(index: number): OpResult<{ page: IBrainPageDef; index: number }>;
  containsTileId(tileId: string): boolean;
  purgeUnusedTiles(): void;
}

export type BrainPageDefEvents = {
  name_changed: { oldName: string; newName: string };
  page_changed: { what: string; ruleWhat?: unknown };
};

export interface IBrainPageDef {
  pageId(): string;
  name(): string;
  setName(newName: string): void;
  brain(): IBrainDef | undefined;
  children(): List<IBrainRuleDef>;
  events(): EventEmitterConsumer<BrainPageDefEvents>;
  clone(): IBrainPageDef;
  typecheck(): void;
  serialize(stream: IWriteStream): void;
  deserialize(stream: IReadStream): void;
  appendNewRule(): IBrainRuleDef | undefined;
  addRuleAtIndex(index: number, rule: IBrainRuleDef): void;
  removeRuleAtIndex(index: number): IBrainRuleDef | undefined;
  containsTileId(tileId: string): boolean;
}

export type BrainRuleDefEvents = {
  rule_deleted: {};
  rule_dirtyChanged: { isDirty: boolean };
};

export interface IBrainRuleDef {
  page(): IBrainPageDef | undefined;
  setPage(page: IBrainPageDef | undefined): void;
  ancestor(): IBrainRuleDef | undefined;
  setAncestor(ancestor: IBrainRuleDef | undefined): void;
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
  serialize(stream: IWriteStream): void;
  deserialize(stream: IReadStream, catalogs?: List<ITileCatalog>): void;
}

export type BrainTileSetEvents = {
  tileSet_dirtyChanged: { side: RuleSide; isDirty: boolean };
  tileSet_typechecked: { side: RuleSide; typecheckResult?: unknown };
};

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
  serialize(stream: IWriteStream): void;
  deserialize(stream: IReadStream, catalogs?: List<ITileCatalog>): void;
}
