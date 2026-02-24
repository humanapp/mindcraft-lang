// task.ts
// Node + browser implementation of a Roblox-ts-like `task` API.
// ESM-safe. No deps.

export type thread = TaskThread;

type AnyFn = (...args: unknown[]) => unknown;

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

type Scheduler = {
  nowMs(): number;
  queueMicrotask(fn: () => void): void;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(id: TimerHandle): void;
};

const scheduler: Scheduler = (() => {
  const nowMs =
    typeof globalThis.performance?.now === "function" ? () => globalThis.performance.now() : () => Date.now();

  const qmt =
    typeof globalThis.queueMicrotask === "function"
      ? (fn: () => void) => globalThis.queueMicrotask(fn)
      : (fn: () => void) => Promise.resolve().then(fn);

  return {
    nowMs,
    queueMicrotask: qmt,
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
})();

let nextThreadId = 1;

class TaskThread {
  public readonly id = nextThreadId++;
  public canceled = false;

  // A thread in JS is "a scheduled resume of a stored function".
  // If you pass this thread back into spawn/defer/delay, we call `fn` again.
  public fn: AnyFn | undefined;

  // The currently scheduled timer handle (if any).
  private handle: TimerHandle | undefined = undefined;

  public _scheduleWithTimeout(ms: number, args: unknown[]) {
    this._clearHandle();
    this.handle = scheduler.setTimeout(() => {
      this.handle = undefined;
      if (this.canceled) return;
      this._run(args);
    }, ms);
  }

  public _scheduleMicrotask(args: unknown[]) {
    this._clearHandle();
    // Not cancelable at the platform level; we gate with `canceled`.
    scheduler.queueMicrotask(() => {
      if (this.canceled) return;
      this._run(args);
    });
  }

  public _scheduleMacrotask(args: unknown[]) {
    this._clearHandle();
    // 0ms timeout approximates "end of current resumption cycle".
    this.handle = scheduler.setTimeout(() => {
      this.handle = undefined;
      if (this.canceled) return;
      this._run(args);
    }, 0);
  }

  public _run(args: unknown[]) {
    const fn = this.fn;
    if (!fn) return;
    try {
      fn(...args);
    } catch (err) {
      // Match typical JS scheduler behavior: surface the error asynchronously.
      scheduler.setTimeout(() => {
        throw err;
      }, 0);
    }
  }

  public _clearHandle() {
    if (this.handle !== undefined) {
      scheduler.clearTimeout(this.handle);
      this.handle = undefined;
    }
  }

  public cancel() {
    this.canceled = true;
    this._clearHandle();
  }
}

function asThread(x: unknown): x is TaskThread {
  return x instanceof TaskThread;
}

function makeThreadFromCallback(cb: AnyFn): TaskThread {
  const t = new TaskThread();
  t.fn = cb;
  return t;
}

function secondsToMs(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.floor(seconds * 1000);
}

// Export as namespace for clean API with proper overloads
export namespace task {
  /** Roblox parallel/serial phases do not exist in JS. No-op. */
  export function desynchronize(): void {}

  /** Roblox parallel/serial phases do not exist in JS. No-op. */
  export function synchronize(): void {}

  /** End of current "tick"/macrotask. */
  export function defer<T extends unknown[]>(callback: (...args: T) => void, ...args: T): thread;
  export function defer(thr: thread, ...args: unknown[]): thread;
  export function defer(first: AnyFn | thread, ...rest: unknown[]): thread {
    const t = asThread(first) ? first : makeThreadFromCallback(first as AnyFn);
    t._scheduleMacrotask(rest);
    return t;
  }

  /** setTimeout-based delay (seconds). */
  export function delay<T extends unknown[]>(duration: number, callback: (...args: T) => void, ...args: T): thread;
  export function delay(duration: number, thr: thread, ...args: unknown[]): thread;
  export function delay(duration: number, first: AnyFn | thread, ...rest: unknown[]): thread {
    const t = asThread(first) ? first : makeThreadFromCallback(first as AnyFn);
    t._scheduleWithTimeout(secondsToMs(duration), rest);
    return t;
  }

  /** Microtask-based "as soon as possible". */
  export function spawn<T extends unknown[]>(callback: (...args: T) => void, ...args: T): thread;
  export function spawn(thr: thread, ...args: unknown[]): thread;
  export function spawn(first: AnyFn | thread, ...rest: unknown[]): thread {
    const t = asThread(first) ? first : makeThreadFromCallback(first as AnyFn);
    t._scheduleMicrotask(rest);
    return t;
  }

  /**
   * JS cannot synchronously yield like Roblox. This returns a Promise.
   * In TS, keep your Roblox d.ts, and add a platform shim d.ts that declares Promise here.
   */
  export function wait(duration: number = 0): Promise<number> {
    const start = scheduler.nowMs();
    return new Promise((resolve) => {
      scheduler.setTimeout(() => {
        const elapsed = (scheduler.nowMs() - start) / 1000;
        resolve(elapsed);
      }, secondsToMs(duration));
    });
  }

  /** Cancels a scheduled thread. */
  export function cancel(thr: thread): void {
    thr.cancel();
  }
}
