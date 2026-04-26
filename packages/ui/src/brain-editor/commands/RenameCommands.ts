import type { IBrainDef, IBrainRuleDef, IBrainTileSet } from "@mindcraft-lang/core/brain";
import type { BrainDef, BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import type { BrainCommand } from "./BrainCommand";

/**
 * Command to rename a brain.
 */
export class RenameBrainCommand implements BrainCommand {
  private oldName: string;

  constructor(
    private brainDef: BrainDef,
    private newName: string
  ) {
    this.oldName = brainDef.name();
  }

  execute(): void {
    this.brainDef.setName(this.newName);
  }

  undo(): void {
    this.brainDef.setName(this.oldName);
  }

  getDescription(): string {
    return `Rename brain from "${this.oldName}" to "${this.newName}"`;
  }
}

/**
 * Command to rename a page.
 */
export class RenamePageCommand implements BrainCommand {
  private oldName: string;

  constructor(
    private pageDef: BrainPageDef,
    private newName: string
  ) {
    this.oldName = pageDef.name();
  }

  execute(): void {
    this.pageDef.setName(this.newName);
  }

  undo(): void {
    this.pageDef.setName(this.oldName);
  }

  getDescription(): string {
    return `Rename page from "${this.oldName}" to "${this.newName}"`;
  }
}

/**
 * Command to rename a variable tile across all rules in a brain.
 * Replaces the catalog entry and updates all tile-set references so every
 * occurrence of the variable is updated atomically.
 */
export class RenameVariableCommand implements BrainCommand {
  private readonly newTile: BrainTileVariableDef;

  constructor(
    private readonly brainDef: IBrainDef,
    private readonly oldTile: BrainTileVariableDef,
    newName: string
  ) {
    this.newTile = new BrainTileVariableDef(oldTile.tileId, newName, oldTile.varType, oldTile.uniqueId);
  }

  execute(): void {
    const catalog = this.brainDef.catalog();
    catalog.delete(this.oldTile.tileId);
    catalog.registerTileDef(this.newTile);
    this.replaceTileInAllRules_(this.oldTile, this.newTile);
  }

  undo(): void {
    const catalog = this.brainDef.catalog();
    catalog.delete(this.newTile.tileId);
    catalog.registerTileDef(this.oldTile);
    this.replaceTileInAllRules_(this.newTile, this.oldTile);
  }

  getDescription(): string {
    return `Rename variable from "${this.oldTile.varName}" to "${this.newTile.varName}"`;
  }

  private replaceTileInAllRules_(fromTile: BrainTileVariableDef, toTile: BrainTileVariableDef): void {
    const pages = this.brainDef.pages();
    for (let pi = 0; pi < pages.size(); pi++) {
      this.walkRules_(pages.get(pi).children(), fromTile, toTile);
    }
  }

  private walkRules_(
    rules: ReturnType<IBrainRuleDef["children"]>,
    fromTile: BrainTileVariableDef,
    toTile: BrainTileVariableDef
  ): void {
    for (let ri = 0; ri < rules.size(); ri++) {
      const rule = rules.get(ri);
      this.replaceInTileSet_(rule.when(), fromTile, toTile);
      this.replaceInTileSet_(rule.do(), fromTile, toTile);
      this.walkRules_(rule.children(), fromTile, toTile);
    }
  }

  private replaceInTileSet_(
    tileSet: IBrainTileSet,
    fromTile: BrainTileVariableDef,
    toTile: BrainTileVariableDef
  ): void {
    const tiles = tileSet.tiles();
    for (let ti = 0; ti < tiles.size(); ti++) {
      if (tiles.get(ti) === fromTile) {
        tileSet.replaceTileAtIndex(ti, toTile);
      }
    }
  }
}

/** Command that sets or clears the comment on a {@link BrainRuleDef}. */
export class SetRuleCommentCommand implements BrainCommand {
  private oldComment: string | undefined;

  constructor(
    private ruleDef: BrainRuleDef,
    private newComment: string | undefined
  ) {
    this.oldComment = ruleDef.comment();
  }

  execute(): void {
    this.ruleDef.setComment(this.newComment);
  }

  undo(): void {
    this.ruleDef.setComment(this.oldComment);
  }

  getDescription(): string {
    return this.newComment ? `Set rule comment to "${this.newComment}"` : "Remove rule comment";
  }
}
