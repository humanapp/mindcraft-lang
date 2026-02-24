/**
 * Base interface for all brain editing commands.
 * Commands follow the Command Pattern to enable undo/redo functionality.
 */
export interface BrainCommand {
  /**
   * Execute the command, modifying the brain definition.
   */
  execute(): void;

  /**
   * Undo the command, reverting the brain definition to its previous state.
   */
  undo(): void;

  /**
   * Get a human-readable description of this command for debugging/UI.
   */
  getDescription(): string;
}

/**
 * Manages the undo/redo stack for brain editing commands.
 */
export class BrainCommandHistory {
  private undoStack: BrainCommand[] = [];
  private redoStack: BrainCommand[] = [];
  private onChangeCallback?: () => void;

  constructor(private maxHistorySize: number = 100) {}

  /**
   * Execute a command and add it to the undo stack.
   */
  executeCommand(command: BrainCommand): void {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = []; // Clear redo stack when new command is executed

    // Limit stack size
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }

    this.notifyChange();
  }

  /**
   * Undo the most recent command.
   */
  undo(): void {
    const command = this.undoStack.pop();
    if (command) {
      command.undo();
      this.redoStack.push(command);
      this.notifyChange();
    }
  }

  /**
   * Redo the most recently undone command.
   */
  redo(): void {
    const command = this.redoStack.pop();
    if (command) {
      command.execute();
      this.undoStack.push(command);
      this.notifyChange();
    }
  }

  /**
   * Check if undo is available.
   */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available.
   */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Clear all history.
   */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notifyChange();
  }

  /**
   * Register a callback to be notified when the history changes.
   */
  onChange(callback: () => void): void {
    this.onChangeCallback = callback;
  }

  private notifyChange(): void {
    this.onChangeCallback?.();
  }

  /**
   * Get the description of the next command that would be undone.
   */
  getUndoDescription(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.getDescription();
  }

  /**
   * Get the description of the next command that would be redone.
   */
  getRedoDescription(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.getDescription();
  }
}
