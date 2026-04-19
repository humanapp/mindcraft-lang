export interface ProjectLockHandle {
  release(): void;
}

export interface ProjectLock {
  tryAcquire(projectId: string): Promise<ProjectLockHandle | undefined>;
}

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
