import { Error } from "../../../platform/error";
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
 * Several commands the history holds as one entry. Executing replays the
 * members in the order they joined; undoing reverses them newest first.
 */
class BatchedCommand implements BrainCommand {
  constructor(
    private readonly members: List<BrainCommand>,
    private readonly description: string
  ) {}

  execute(): void {
    for (let i = 0; i < this.members.size(); i++) {
      this.members.get(i).execute();
    }
  }

  undo(): void {
    for (let i = this.members.size() - 1; i >= 0; i--) {
      this.members.get(i).undo();
    }
  }

  getDescription(): string {
    return this.description;
  }
}

/** Who a change to a {@link BrainCommandHistory} came from. */
export const BrainEditOrigin = {
  /** The person editing, through a control they operated themselves. */
  Person: "person",
  /** A tool call, run against the authoring workspace on the person's behalf. */
  Tool: "tool",
  /** The editor itself, standing a working copy up or taking it down. */
  Editor: "editor",
} as const;

/** Union of all {@link BrainEditOrigin} values. */
export type BrainEditOrigin = (typeof BrainEditOrigin)[keyof typeof BrainEditOrigin];

/**
 * Manages the undo/redo stack for brain editing commands.
 *
 * Commands normally take one entry each. While a batch opened with
 * {@link beginBatch} stands open, every command run joins a single entry
 * instead, and an operation made of several commands undoes and redoes as one.
 *
 * Every change carries the origin it was run under, which
 * {@link BrainCommandHistory.onChange} listeners are told. A change run outside
 * any {@link BrainCommandHistory.runAs} scope is the person's.
 */
export class BrainCommandHistory {
  private readonly undoStack = new List<BrainCommand>();
  private readonly redoStack = new List<BrainCommand>();
  private readonly listeners = new List<(origin: BrainEditOrigin) => void>();
  // The commands gathered by the open batch, or undefined while none is open.
  private batch?: List<BrainCommand>;
  private batchDescription = "";
  // The origin every change is reported under while no runAs scope stands.
  private origin: BrainEditOrigin = BrainEditOrigin.Person;

  constructor(private maxHistorySize: number = 100) {}

  /**
   * Run `work` with every change it makes reported under `origin`, and put the
   * origin that stood before back afterwards, however `work` ends. Scopes
   * nest: the innermost one running is the origin a change carries.
   *
   * `work` must be synchronous. An origin held across an `await` also covers
   * whatever the person does while the wait runs.
   */
  runAs(origin: BrainEditOrigin, work: () => void): void {
    const stood = this.origin;
    this.origin = origin;
    try {
      work();
    } finally {
      this.origin = stood;
    }
  }

  /**
   * Execute a command and add it to the undo stack, or to the open batch when
   * {@link beginBatch} has one open.
   */
  executeCommand(command: BrainCommand): void {
    command.execute();
    if (this.batch !== undefined) {
      this.batch.push(command);
      this.notifyChange();
      return;
    }
    this.undoStack.push(command);
    this.redoStack.clear(); // Clear redo stack when new command is executed

    // Limit stack size
    if (this.undoStack.size() > this.maxHistorySize) {
      this.undoStack.shift();
    }

    this.notifyChange();
  }

  /**
   * Open a batch: every command run until {@link endBatch} or
   * {@link abortBatch} joins one history entry, described by `description`.
   * Commands still execute as they are run; only the history entry waits.
   *
   * Throws when a batch is already open. Batches do not nest.
   */
  beginBatch(description: string): void {
    if (this.batch !== undefined) {
      throw new Error("BrainCommandHistory.beginBatch: a batch is already open");
    }
    this.batch = new List<BrainCommand>();
    this.batchDescription = description;
  }

  /** True while a batch opened by {@link beginBatch} is gathering commands. */
  isBatchOpen(): boolean {
    return this.batch !== undefined;
  }

  /**
   * Close the open batch, adding its commands to the undo stack as one entry.
   * A batch that gathered no command adds no entry and leaves the redo stack
   * alone. Does nothing when no batch is open.
   */
  endBatch(): void {
    const batch = this.batch;
    this.batch = undefined;
    if (batch === undefined) return;
    if (batch.size() === 0) {
      this.notifyChange();
      return;
    }
    this.undoStack.push(new BatchedCommand(batch, this.batchDescription));
    this.redoStack.clear();

    if (this.undoStack.size() > this.maxHistorySize) {
      this.undoStack.shift();
    }

    this.notifyChange();
  }

  /**
   * Close the open batch, undoing every command it gathered, newest first.
   * Adds no history entry and leaves the redo stack alone. Does nothing when no
   * batch is open.
   */
  abortBatch(): void {
    const batch = this.batch;
    this.batch = undefined;
    if (batch === undefined) return;
    for (let i = batch.size() - 1; i >= 0; i--) {
      batch.get(i).undo();
    }
    this.notifyChange();
  }

  /**
   * Record a command in the undo history WITHOUT executing it, or in the open
   * batch when {@link beginBatch} has one open.
   *
   * Used when the underlying model has already reached the target state through
   * some other means (e.g. an interactive drag that mutated the model directly
   * for fluid feedback) and only the net change should be undoable.
   */
  recordCommand(command: BrainCommand): void {
    if (this.batch !== undefined) {
      this.batch.push(command);
      this.notifyChange();
      return;
    }
    this.undoStack.push(command);
    this.redoStack.clear();

    if (this.undoStack.size() > this.maxHistorySize) {
      this.undoStack.shift();
    }

    this.notifyChange();
  }

  /**
   * Undo the most recent command. Does nothing while a batch is open.
   */
  undo(): void {
    if (this.batch !== undefined) return;
    const command = this.undoStack.pop();
    if (command) {
      command.undo();
      this.redoStack.push(command);
      this.notifyChange();
    }
  }

  /**
   * Redo the most recently undone command. Does nothing while a batch is open.
   */
  redo(): void {
    if (this.batch !== undefined) return;
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
   * Number of entries on the undo stack. A batch closed by {@link endBatch}
   * counts as one entry; commands gathered by a batch still open are not
   * counted. The count never exceeds the history's maximum size, since the
   * oldest entry is dropped once that is reached.
   */
  undoDepth(): number {
    return this.undoStack.size();
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
   * Register `callback` to be notified when the history changes, with the
   * origin the change was run under. Several callbacks may be registered at
   * once, and each change notifies them in the order they registered. Call the
   * returned function to stop notifying this callback; it leaves every other
   * registration standing, and calling it twice does nothing further.
   */
  onChange(callback: (origin: BrainEditOrigin) => void): () => void {
    this.listeners.push(callback);
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      const at = this.listeners.indexOf(callback);
      if (at >= 0) this.listeners.remove(at);
    };
  }

  private notifyChange(): void {
    for (let i = 0; i < this.listeners.size(); i++) {
      this.listeners.get(i)(this.origin);
    }
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
