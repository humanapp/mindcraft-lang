import { Error } from "../../platform/error";
import { List, type ReadonlyList } from "../../platform/list";
import { logger } from "../../platform/logger";
import type { IReadStream, IWriteStream } from "../../platform/stream";
import { fourCC } from "../../primitives";
import { EventEmitter, type EventEmitterConsumer } from "../../util";
import type { TypecheckResult } from "../compiler";
import { printExpr } from "../compiler/expr-printer";
import type { Expr } from "../compiler/types";
import {
  type BrainTileSetEvents,
  type IBrainRuleDef,
  type IBrainTileDef,
  type IBrainTileSet,
  type ITileCatalog,
  RuleSide,
} from "../interfaces";
import { getBrainServices } from "../services";

// Maximum allowed number of tiles in a tileset.
// WARNING: This value must never be lowered, as it could invalidate existing saves. It may be safely increased.
export const kMaxTileSetSize = 20; // never reduce this value!

// Serialization tags
const STags = {
  TSET: fourCC("TSET"), // TileSet chunk
  TCNT: fourCC("TCNT"), // Tile count
};

export class BrainTileSet implements IBrainTileSet {
  private readonly tiles_ = new List<IBrainTileDef>();
  private readonly emitter_ = new EventEmitter<BrainTileSetEvents>();
  private typecheckResult: TypecheckResult | undefined;
  private sideExpr_: Expr | undefined;
  private dirty: boolean = false; // dirty = needs recompilation

  constructor(
    private readonly rule_: IBrainRuleDef | undefined,
    private readonly side_: RuleSide
  ) {}

  tiles(): ReadonlyList<IBrainTileDef> {
    return this.tiles_.asReadonly();
  }

  events(): EventEmitterConsumer<BrainTileSetEvents> {
    return this.emitter_.consumer();
  }

  /**
   * Returns the parsed expression for this side, or undefined if no typecheck
   * has been performed yet or the tileset is dirty.
   */
  expr(): Expr | undefined {
    if (this.dirty) return undefined;
    return this.sideExpr_;
  }

  rule(): IBrainRuleDef | undefined {
    return this.rule_;
  }

  side(): RuleSide {
    return this.side_;
  }

  isDirty(): boolean {
    // Marked dirty locally
    if (this.dirty) return true;

    // Ancestor's 'When' side is dirty (we might rely on output tiles from it)
    if (this.rule()?.ancestor()?.when().isDirty()) return true;

    // 'Do' side is also dirty if its 'When' side is dirty (same reason)
    if (this.side_ === RuleSide.Do && this.rule()?.when().isDirty()) return true;

    return false;
  }

  markDirty(): void {
    this.dirty = true;
    this.emitter_.emit("tileSet_dirtyChanged", { side: this.side_, isDirty: true });
  }

  markClean(): void {
    this.dirty = false;
    this.emitter_.emit("tileSet_dirtyChanged", { side: this.side_, isDirty: false });
  }

  gatherCatalogs(): List<ITileCatalog> {
    const catalogs = List.empty<ITileCatalog>();
    // push global catalog
    catalogs.push(getBrainServices().tiles);
    // push brain catalog
    const brainCatalog = this.rule_?.page()?.brain()?.catalog();
    if (brainCatalog) {
      catalogs.push(brainCatalog);
    }
    // FUTURE: push ancestor rule catalogs
    let currentRule: IBrainRuleDef | undefined = this.rule_;
    while (currentRule) {
      currentRule = currentRule.ancestor();
    }
    return catalogs;
  }

  /**
   * Set the compile result for this tileset. Called from BrainRuleDef.compile().
   * @param result The combined compile result for both WHEN and DO sides
   */
  setTypecheckResult(result: TypecheckResult): void {
    this.typecheckResult = result;

    // Extract per-side expression
    const sideResult = this.side_ === RuleSide.When ? result.whenParseResult : result.doParseResult;
    this.sideExpr_ = sideResult.exprs.size() > 0 ? sideResult.exprs.get(0) : undefined;

    if (logger.isDebugEnabled()) {
      const locationPath =
        (this.side_ === RuleSide.When ? "WHEN: " : "DO: ") + (this.rule_ ? this.rule_.getLocationPath() : "<unruled>");
      logger.debug(`${locationPath}\n${printExpr(this.typecheckResult.parseResult.exprs)}`);
      // Log diagnostics
      this.typecheckResult.parseResult.diags.forEach((diag) => {
        logger.debug(`  PARSE DIAG: ${diag.message} (from ${diag.span.from} to ${diag.span.to})`);
      });
      this.typecheckResult.typeInfo.diags.forEach((diag) => {
        logger.debug(`  TYPE DIAG: ${diag.message} (node #${diag.nodeId})`);
      });
    }

    this.dirty = false;
    this.emitter_.emit("tileSet_typechecked", { side: this.side_, typecheckResult: this.typecheckResult });
    this.emitter_.emit("tileSet_dirtyChanged", { side: this.side_, isDirty: false });
  }

  appendTile(tileDef: IBrainTileDef): void {
    this.tiles_.push(tileDef);
    this.markDirty();
  }

  insertTileAtIndex(index: number, tileDef: IBrainTileDef): void {
    this.tiles_.insert(index, tileDef);
    this.markDirty();
  }

  replaceTileAtIndex(index: number, tileDef: IBrainTileDef): boolean {
    if (index < 0 || index >= this.tiles_.size()) {
      return false;
    }
    this.tiles_.set(index, tileDef);
    this.markDirty();
    return true;
  }

  removeTileAtIndex(index: number): void {
    if (index < 0 || index >= this.tiles_.size()) {
      return;
    }
    this.tiles_.remove(index);
    this.markDirty();
  }

  containsTileId(tileId: string): boolean {
    for (let i = 0; i < this.tiles_.size(); i++) {
      const tileDef = this.tiles_.get(i);
      if (tileDef.tileId === tileId) {
        return true;
      }
    }
    return false;
  }

  isEmpty(): boolean {
    return this.tiles_.size() === 0;
  }

  serialize(stream: IWriteStream): void {
    stream.pushChunk(STags.TSET, 1); // version
    try {
      stream.writeTaggedU32(STags.TCNT, this.tiles_.size());
      this.tiles_.forEach((tileDef) => {
        stream.writeString(tileDef.tileId);
      });
    } finally {
      stream.popChunk();
    }
  }

  deserialize(stream: IReadStream, catalogs?: List<ITileCatalog>): void {
    if (this.tiles_.size() > 0) {
      throw new Error("BrainTileSet.deserialize: tileset is not empty");
    }
    const version = stream.enterChunk(STags.TSET);
    try {
      if (version !== 1) {
        throw new Error(`BrainTileSet.deserialize: unsupported version ${version}`);
      }
      const tileCount = stream.readTaggedU32(STags.TCNT);
      for (let i = 0; i < tileCount; i++) {
        const tileId = stream.readString();
        let tileDef: IBrainTileDef | undefined;
        if (catalogs) {
          for (let j = 0; j < catalogs.size(); j++) {
            const catalog = catalogs.get(j);
            tileDef = catalog.get(tileId) as IBrainTileDef | undefined;
            if (tileDef) break;
          }
        }
        if (!tileDef) {
          throw new Error(`BrainTileSet.deserialize: tileId '${tileId}' not found in provided catalogs`);
        }
        this.tiles_.push(tileDef);
      }
    } finally {
      stream.leaveChunk();
    }
  }
}
