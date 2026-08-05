import type { IBrainDef, IBrainTileDef, RuleSide } from "../../interfaces";
import type { BrainRuleDef } from "../ruledef";
import type { BrainCommand } from "./BrainCommand";

/**
 * Command to add a tile to a rule.
 */
export class AddTileCommand implements BrainCommand {
  constructor(
    private rule: BrainRuleDef,
    private side: RuleSide,
    private tileDef: IBrainTileDef
  ) {}

  execute(): void {
    this.rule.side(this.side).appendTile(this.tileDef);
  }

  undo(): void {
    const side = this.rule.side(this.side);
    const lastIndex = side.tiles().size() - 1;
    if (lastIndex >= 0) {
      side.removeTileAtIndex(lastIndex);
    }
  }

  getDescription(): string {
    return `Add tile to ${this.side}`;
  }
}

/**
 * Command to insert a tile at a specific index.
 */
export class InsertTileCommand implements BrainCommand {
  constructor(
    private rule: BrainRuleDef,
    private side: RuleSide,
    private tileIndex: number,
    private tileDef: IBrainTileDef
  ) {}

  execute(): void {
    this.rule.side(this.side).insertTileAtIndex(this.tileIndex, this.tileDef);
  }

  undo(): void {
    this.rule.side(this.side).removeTileAtIndex(this.tileIndex);
  }

  getDescription(): string {
    return `Insert tile at index ${this.tileIndex} in ${this.side}`;
  }
}

/**
 * Command to replace a tile at a specific index.
 */
export class ReplaceTileCommand implements BrainCommand {
  private oldTileDef?: IBrainTileDef;

  constructor(
    private rule: BrainRuleDef,
    private side: RuleSide,
    private tileIndex: number,
    private newTileDef: IBrainTileDef
  ) {}

  execute(): void {
    const side = this.rule.side(this.side);
    const tileDef = side.tiles().get(this.tileIndex);
    if (tileDef) {
      this.oldTileDef = tileDef as IBrainTileDef;
      side.replaceTileAtIndex(this.tileIndex, this.newTileDef);
    }
  }

  undo(): void {
    if (this.oldTileDef) {
      this.rule.side(this.side).replaceTileAtIndex(this.tileIndex, this.oldTileDef);
    }
  }

  getDescription(): string {
    return `Replace tile at index ${this.tileIndex} in ${this.side}`;
  }
}

/**
 * Command to remove a tile from a rule.
 */
export class RemoveTileCommand implements BrainCommand {
  private removedTile?: IBrainTileDef;

  constructor(
    private rule: BrainRuleDef,
    private side: RuleSide,
    private tileIndex: number
  ) {}

  execute(): void {
    const side = this.rule.side(this.side);
    const tileDef = side.tiles().get(this.tileIndex);
    if (tileDef) {
      this.removedTile = tileDef as IBrainTileDef;
      side.removeTileAtIndex(this.tileIndex);
    }
  }

  undo(): void {
    if (this.removedTile) {
      this.rule.side(this.side).insertTileAtIndex(this.tileIndex, this.removedTile);
    }
  }

  getDescription(): string {
    return `Remove tile from ${this.side}`;
  }
}

/**
 * Command to paste a tile before an existing tile.
 *
 * The tile is produced by `importTile`, which is invoked with the destination
 * brain on every execute (including redo) so the paste reflects its source at
 * execution time. The caller's producer is expected to import the tile def
 * into the destination brain's catalog, and returns undefined when no tile is
 * available (in which case the command is a no-op).
 */
export class PasteTileBeforeCommand implements BrainCommand {
  private importedTileDef?: IBrainTileDef;

  constructor(
    private rule: BrainRuleDef,
    private side: RuleSide,
    private tileIndex: number,
    private readonly importTile: (destBrain: IBrainDef) => IBrainTileDef | undefined
  ) {}

  execute(): void {
    const brain = this.rule.brain();
    if (!brain) return;
    const tileDef = this.importTile(brain);
    if (tileDef) {
      this.importedTileDef = tileDef;
      this.rule.side(this.side).insertTileAtIndex(this.tileIndex, tileDef);
    }
  }

  undo(): void {
    if (this.importedTileDef) {
      this.rule.side(this.side).removeTileAtIndex(this.tileIndex);
    }
  }

  getDescription(): string {
    return "Paste tile before";
  }
}
