export interface Command {
  execute(): void;
  undo(): void;
}

export class UndoStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private maxSize: number;
  private onChange: () => void;

  constructor(maxSize: number, onChange: () => void) {
    this.maxSize = maxSize;
    this.onChange = onChange;
  }

  perform(command: Command): void {
    command.execute();
    this.undoStack.push(command);
    this.redoStack.length = 0;

    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }

    this.onChange();
  }

  /** Record a command that has already been executed. */
  record(command: Command): void {
    this.undoStack.push(command);
    this.redoStack.length = 0;

    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }

    this.onChange();
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this.onChange();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.execute();
    this.undoStack.push(cmd);
    this.onChange();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.onChange();
  }
}
