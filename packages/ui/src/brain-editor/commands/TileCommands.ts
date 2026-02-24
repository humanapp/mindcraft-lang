import type { IBrainTileDef, RuleSide } from "@mindcraft-lang/core/brain";
import type { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { importTileFromClipboard } from "../tile-clipboard";
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
 * Command to paste a tile from the tile clipboard before an existing tile.
 *
 * Imports the tile def into the destination brain's catalog (handling
 * cross-brain page matching) and inserts it at the target index.
 */
export class PasteTileBeforeCommand implements BrainCommand {
  private importedTileDef?: IBrainTileDef;

  constructor(
    private rule: BrainRuleDef,
    private side: RuleSide,
    private tileIndex: number
  ) {}

  execute(): void {
    const brain = this.rule.brain();
    if (!brain) return;
    const tileDef = importTileFromClipboard(brain);
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
