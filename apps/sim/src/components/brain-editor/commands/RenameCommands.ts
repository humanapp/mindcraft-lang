import type { BrainDef, BrainPageDef } from "@mindcraft-lang/core/brain/model";
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
