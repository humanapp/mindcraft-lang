/** Handle returned by {@link ProjectLock.tryAcquire}. */
export interface ProjectLockHandle {
  /** Release the lock. */
  release(): void;
}

/** Cross-tab lock used to ensure a project is only open in one tab at a time. */
export interface ProjectLock {
  /**
   * Attempt to acquire the lock for `projectId` without waiting. Resolves with
   * a handle on success, or `undefined` if the lock is already held.
   */
  tryAcquire(projectId: string): Promise<ProjectLockHandle | undefined>;
}

/**
 * Create a {@link ProjectLock} backed by the Web Locks API. When the Web Locks
 * API is unavailable, `tryAcquire` resolves with a no-op handle.
 */
export function createWebLocksProjectLock(keyPrefix: string): ProjectLock {
  return new WebLocksProjectLock(keyPrefix);
}

class WebLocksProjectLock implements ProjectLock {
  private readonly prefix: string;

  constructor(keyPrefix: string) {
    this.prefix = keyPrefix;
  }

  tryAcquire(projectId: string): Promise<ProjectLockHandle | undefined> {
    if (typeof navigator === "undefined" || !navigator.locks) {
      return Promise.resolve(createNoopHandle());
    }

    const lockName = `${this.prefix}:project:${projectId}:tab-lock`;

    return new Promise((resolveOuter) => {
      let releaseHeld: (() => void) | undefined;

      navigator.locks.request(lockName, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolveOuter(undefined);
          return Promise.resolve();
        }

        return new Promise<void>((resolveInner) => {
          releaseHeld = resolveInner;
          resolveOuter({ release: resolveInner });
        });
      });
    });
  }
}

function createNoopHandle(): ProjectLockHandle {
  return { release() {} };
}
