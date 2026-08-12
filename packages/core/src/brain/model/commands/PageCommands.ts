import type { BrainDef } from "../braindef";
import type { BrainPageDef } from "../pagedef";
import type { BrainCommand } from "./BrainCommand";

/**
 * Command to add a new page to the brain, appended or inserted at an index.
 *
 * The page the first execute makes is the page every later execute puts back,
 * so its id, its page tile, and the rule it opens with survive an undo/redo
 * round trip. A brain already holding the maximum number of pages gains none
 * and leaves nothing to undo.
 */
export class AddPageCommand implements BrainCommand {
  private addedPage?: BrainPageDef;

  constructor(
    private brainDef: BrainDef,
    private insertAtIndex?: number
  ) {}

  execute(): void {
    const added = this.addedPage;
    if (added) {
      if (this.insertAtIndex !== undefined) {
        this.brainDef.insertPageAtIndex(this.insertAtIndex, added);
      } else {
        this.brainDef.addPage(added);
      }
      return;
    }

    const result =
      this.insertAtIndex !== undefined
        ? this.brainDef.insertNewPageAtIndex(this.insertAtIndex)
        : this.brainDef.appendNewPage();
    if (result.success) {
      this.addedPage = result.value.page;
    }
  }

  undo(): void {
    const added = this.addedPage;
    if (!added) return;
    const index = this.brainDef.pages().indexOf(added);
    if (index >= 0) {
      this.brainDef.removePageAtIndex(index);
    }
  }

  getDescription(): string {
    return this.insertAtIndex !== undefined ? `Insert page at index ${this.insertAtIndex}` : "Add page";
  }
}

/**
 * Command to remove a page from the brain.
 *
 * `pageIndex` locates the page the first execute takes out; from then on the
 * command holds that page itself, so it removes and restores the same page --
 * with its id, its rules, and its page tile -- wherever pages around it have
 * moved to.
 */
export class RemovePageCommand implements BrainCommand {
  private removedPage?: BrainPageDef;
  private removedFrom = 0;

  constructor(
    private brainDef: BrainDef,
    private pageIndex: number
  ) {}

  execute(): void {
    const page = this.removedPage ?? (this.brainDef.pages().get(this.pageIndex) as BrainPageDef | undefined);
    if (!page) return;
    const index = this.brainDef.pages().indexOf(page);
    if (index < 0) return;
    this.removedPage = page;
    this.removedFrom = index;
    this.brainDef.removePageAtIndex(index);
  }

  undo(): void {
    if (this.removedPage) {
      this.brainDef.insertPageAtIndex(this.removedFrom, this.removedPage);
    }
  }

  getDescription(): string {
    return `Remove page ${this.pageIndex + 1}`;
  }
}

/**
 * Command to replace the last remaining page with a new empty page, taking the
 * old page out and putting a blank one in as one undoable step, so a brain
 * never rests holding no page at all.
 *
 * Both pages are held from the first execute onwards: the same page comes out
 * and the same blank page goes in on every later execute, so both ids survive
 * an undo/redo round trip.
 */
export class ReplaceLastPageCommand implements BrainCommand {
  private removedPage?: BrainPageDef;
  private addedPage?: BrainPageDef;
  private removedFrom = 0;

  constructor(
    private brainDef: BrainDef,
    private pageIndex: number
  ) {}

  execute(): void {
    const page = this.removedPage ?? (this.brainDef.pages().get(this.pageIndex) as BrainPageDef | undefined);
    if (!page) return;
    const index = this.brainDef.pages().indexOf(page);
    if (index < 0) return;
    this.removedPage = page;
    this.removedFrom = index;
    this.brainDef.removePageAtIndex(index);

    const added = this.addedPage;
    if (added) {
      this.brainDef.addPage(added);
      return;
    }
    const result = this.brainDef.appendNewPage();
    if (result.success) {
      this.addedPage = result.value.page;
    }
  }

  undo(): void {
    if (this.addedPage && this.removedPage) {
      const addedIndex = this.brainDef.pages().indexOf(this.addedPage);
      if (addedIndex >= 0) {
        this.brainDef.removePageAtIndex(addedIndex);
      }
      this.brainDef.insertPageAtIndex(this.removedFrom, this.removedPage);
    }
  }

  getDescription(): string {
    return `Replace page ${this.pageIndex + 1} with new empty page`;
  }
}
