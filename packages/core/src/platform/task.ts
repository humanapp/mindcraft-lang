// task.ts
// Platform-agnostic type definitions for the task API

export type thread = unknown;

export declare namespace task {
  /** Queues the calling script to be run during the parallel execution phase of the frame. */
  function desynchronize(): void;

  /** Yields the calling script and queues it for serial execution following the completion of the parallel execution phase of the frame. */
  function synchronize(): void;

  /** Defers the passed thread or function to be resumed at the end of the current resumption cycle. */
  function defer<T extends unknown[]>(callback: (...args: T) => void, ...args: T): thread;
  function defer(thread: thread, ...args: unknown[]): thread;

  /** Delays the passed thread or function until the given duration has elapsed. Resumes on engine Heartbeat. */
  function delay<T extends unknown[]>(duration: number, callback: (...args: T) => void, ...args: T): thread;
  function delay(duration: number, thread: thread, ...args: unknown[]): thread;

  /** Resumes the passed thread or function instantly using the engine's scheduler. */
  function spawn<T extends unknown[]>(callback: (...args: T) => void, ...args: T): thread;
  function spawn(thread: thread, ...args: unknown[]): thread;

  /** Delay the current thread until the given duration has elapsed. Resumes on engine Heartbeat. */
  function wait(duration?: number): number | Promise<number>;

  /** Cancels a thread, preventing it from being resumed. */
  function cancel(thread: thread): void;
}
