import { List } from "../../../platform/list";

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
  private readonly undoStack = new List<BrainCommand>();
  private readonly redoStack = new List<BrainCommand>();
  private onChangeCallback?: () => void;

  constructor(private maxHistorySize: number = 100) {}

  /**
   * Execute a command and add it to the undo stack.
   */
  executeCommand(command: BrainCommand): void {
    command.execute();
    this.undoStack.push(command);
    this.redoStack.clear(); // Clear redo stack when new command is executed

    // Limit stack size
    if (this.undoStack.size() > this.maxHistorySize) {
      this.undoStack.shift();
    }

    this.notifyChange();
  }

  /**
   * Record a command in the undo history WITHOUT executing it.
   *
   * Used when the underlying model has already reached the target state through
   * some other means (e.g. an interactive drag that mutated the model directly
   * for fluid feedback) and only the net change should be undoable.
   */
  recordCommand(command: BrainCommand): void {
    this.undoStack.push(command);
    this.redoStack.clear();

    if (this.undoStack.size() > this.maxHistorySize) {
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
    return this.undoStack.size() > 0;
  }

  /**
   * Check if redo is available.
   */
  canRedo(): boolean {
    return this.redoStack.size() > 0;
  }

  /**
   * Clear all history.
   */
  clear(): void {
    this.undoStack.clear();
    this.redoStack.clear();
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
   * Get the newest command on the undo stack -- the entry {@link undo} would
   * revert -- or undefined when the stack is empty. Reads the entry without
   * changing the history.
   */
  peekUndo(): BrainCommand | undefined {
    const size = this.undoStack.size();
    return size > 0 ? this.undoStack.get(size - 1) : undefined;
  }

  /**
   * Get the description of the next command that would be undone.
   */
  getUndoDescription(): string | undefined {
    const size = this.undoStack.size();
    return size > 0 ? this.undoStack.get(size - 1).getDescription() : undefined;
  }

  /**
   * Get the description of the next command that would be redone.
   */
  getRedoDescription(): string | undefined {
    const size = this.redoStack.size();
    return size > 0 ? this.redoStack.get(size - 1).getDescription() : undefined;
  }
}
