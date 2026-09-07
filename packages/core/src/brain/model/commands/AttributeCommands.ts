import type { IBrainDef, IBrainRuleDef, IBrainTileDef, IBrainTileSet, RuleTriggerMode } from "../../interfaces";
import type { BrainTileLiteralDef, BrainTileLiteralEdit } from "../../tiles/literals";
import { BrainTileVariableDef } from "../../tiles/variables";
import type { BrainDef } from "../braindef";
import type { BrainPageDef } from "../pagedef";
import type { BrainRuleDef } from "../ruledef";
import type { BrainCommand } from "./BrainCommand";

/** Swap every placement of `fromTile` in `brainDef`'s rules for `toTile`, matching on tile-def identity. */
function replaceTileInAllRules(brainDef: IBrainDef, fromTile: IBrainTileDef, toTile: IBrainTileDef): void {
  const pages = brainDef.pages();
  for (let pi = 0; pi < pages.size(); pi++) {
    walkRules(pages.get(pi).children(), fromTile, toTile);
  }
}

function walkRules(rules: ReturnType<IBrainRuleDef["children"]>, fromTile: IBrainTileDef, toTile: IBrainTileDef): void {
  for (let ri = 0; ri < rules.size(); ri++) {
    const rule = rules.get(ri);
    replaceInTileSet(rule.when(), fromTile, toTile);
    replaceInTileSet(rule.do(), fromTile, toTile);
    walkRules(rule.children(), fromTile, toTile);
  }
}

function replaceInTileSet(tileSet: IBrainTileSet, fromTile: IBrainTileDef, toTile: IBrainTileDef): void {
  const tiles = tileSet.tiles();
  for (let ti = 0; ti < tiles.size(); ti++) {
    if (tiles.get(ti) === fromTile) {
      tileSet.replaceTileAtIndex(ti, toTile);
    }
  }
}

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
    replaceTileInAllRules(this.brainDef, this.oldTile, this.newTile);
  }

  undo(): void {
    const catalog = this.brainDef.catalog();
    catalog.delete(this.newTile.tileId);
    catalog.registerTileDef(this.oldTile);
    replaceTileInAllRules(this.brainDef, this.newTile, this.oldTile);
  }

  getDescription(): string {
    return `Rename variable from "${this.oldTile.varName}" to "${this.newTile.varName}"`;
  }
}

/**
 * Command that edits a literal carrying a unique identity in place across a
 * brain. The replacement literal holds the submitted value and name under the
 * same tile id, and replaces both the catalog entry and every rule placement.
 * Undo restores the value and the name the literal held before.
 *
 * Throws on construction when `oldTile` carries no unique identity.
 */
export class EditLiteralCommand implements BrainCommand {
  private readonly newTile: BrainTileLiteralDef;

  constructor(
    private readonly brainDef: IBrainDef,
    private readonly oldTile: BrainTileLiteralDef,
    edit: BrainTileLiteralEdit
  ) {
    this.newTile = oldTile.edited(edit);
  }

  execute(): void {
    this.swapTile_(this.oldTile, this.newTile);
  }

  undo(): void {
    this.swapTile_(this.newTile, this.oldTile);
  }

  getDescription(): string {
    return `Edit literal "${this.newTile.displayName ?? this.newTile.valueLabel}"`;
  }

  private swapTile_(fromTile: BrainTileLiteralDef, toTile: BrainTileLiteralDef): void {
    const catalog = this.brainDef.catalog();
    catalog.delete(fromTile.tileId);
    catalog.registerTileDef(toTile);
    replaceTileInAllRules(this.brainDef, fromTile, toTile);
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

/** Command that sets the trigger mode on a {@link BrainRuleDef}. */
export class SetRuleTriggerCommand implements BrainCommand {
  private oldTrigger: RuleTriggerMode;

  constructor(
    private ruleDef: BrainRuleDef,
    private newTrigger: RuleTriggerMode
  ) {
    this.oldTrigger = ruleDef.trigger();
  }

  execute(): void {
    this.ruleDef.setTrigger(this.newTrigger);
  }

  undo(): void {
    this.ruleDef.setTrigger(this.oldTrigger);
  }

  getDescription(): string {
    return `Set rule trigger to "${this.newTrigger}"`;
  }
}
