import type { BrainDef, BrainPageDef } from "@mindcraft-lang/core/brain/model";
import type { BrainCommand } from "./BrainCommand";

/**
 * Command to add a new page to the brain.
 */
export class AddPageCommand implements BrainCommand {
  private addedIndex?: number;

  constructor(
    private brainDef: BrainDef,
    private insertAtIndex?: number
  ) {}

  execute(): void {
    if (this.insertAtIndex !== undefined) {
      const result = this.brainDef.insertNewPageAtIndex(this.insertAtIndex);
      if (result.success) {
        this.addedIndex = result.value.index;
      }
    } else {
      const result = this.brainDef.appendNewPage();
      if (result.success) {
        this.addedIndex = result.value.index;
      }
    }
  }

  undo(): void {
    if (this.addedIndex !== undefined) {
      this.brainDef.removePageAtIndex(this.addedIndex);
    }
  }

  getDescription(): string {
    return this.insertAtIndex !== undefined ? `Insert page at index ${this.insertAtIndex}` : "Add page";
  }
}

/**
 * Command to remove a page from the brain.
 */
export class RemovePageCommand implements BrainCommand {
  private removedPage?: BrainPageDef;
  private pageToRemove: BrainPageDef | null = null;

  constructor(
    private brainDef: BrainDef,
    private pageIndex: number
  ) {}

  execute(): void {
    const page = this.pageToRemove || this.brainDef.pages().get(this.pageIndex);
    if (page) {
      // Store reference to the removed page directly (no clone needed)
      // The page will be detached from the brain but remains intact for undo
      this.removedPage = page as BrainPageDef;
      this.brainDef.removePageAtIndex(this.pageIndex);
      this.pageToRemove = null;
    }
  }

  undo(): void {
    if (this.removedPage) {
      this.brainDef.insertPageAtIndex(this.pageIndex, this.removedPage);
      // Update pageToRemove for potential redo
      this.pageToRemove = this.removedPage;
    }
  }

  getDescription(): string {
    return `Remove page ${this.pageIndex + 1}`;
  }
}

/**
 * Command to replace the last remaining page with a new empty page.
 * This is a special case command that handles deleting the last page
 * and adding a new empty one as an atomic operation for proper undo/redo.
 */
export class ReplaceLastPageCommand implements BrainCommand {
  private removedPage?: BrainPageDef;
  private addedPage?: BrainPageDef;
  private pageToRemove: BrainPageDef | null = null;

  constructor(
    private brainDef: BrainDef,
    private pageIndex: number
  ) {}

  execute(): void {
    const page = this.pageToRemove || this.brainDef.pages().get(this.pageIndex);
    if (page) {
      this.removedPage = page as BrainPageDef;
      this.brainDef.removePageAtIndex(this.pageIndex);

      // Add a new empty page
      const result = this.brainDef.appendNewPage();
      if (result.success) {
        this.addedPage = result.value.page;
      }

      this.pageToRemove = null;
    }
  }

  undo(): void {
    // Remove the added page and restore the original
    if (this.addedPage && this.removedPage) {
      const addedIndex = this.brainDef.pages().indexOf(this.addedPage);
      if (addedIndex >= 0) {
        this.brainDef.removePageAtIndex(addedIndex);
      }
      this.brainDef.insertPageAtIndex(this.pageIndex, this.removedPage);
      // Update pageToRemove for potential redo
      this.pageToRemove = this.removedPage;
    }
  }

  getDescription(): string {
    return `Replace page ${this.pageIndex + 1} with new empty page`;
  }
}
