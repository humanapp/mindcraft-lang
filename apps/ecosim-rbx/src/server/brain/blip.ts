/** How much energy a blip drains from an actor on impact. */
export const BLIP_DAMAGE = 10;

/** Speed in pixels per simulation step at which blips travel. */
export const BLIP_SPEED = 6;

/** Maximum lifetime in ms before a blip self-destructs. */
export const BLIP_MAX_LIFETIME_MS = 3000;

/** Radius of the blip body (px). */
export const BLIP_RADIUS = 4;

/** Hard ceiling on simultaneously active blips. */
export const MAX_ACTIVE_BLIPS = 2000;

/**
 * A blip is a small, fast projectile fired by the "shoot" actuator.
 * It has no brain and is not an Actor -- just a sim-space record integrated
 * each engine tick that travels in a straight line, damages the first actor it
 * hits, then returns to the pool for reuse.
 *
 * Blips are **pooled**: call {@link BlipPool.acquire} / {@link BlipPool.release}
 * instead of constructing / destroying directly.
 */
export class Blip {
  /** Monotonically-increasing id assigned by the Engine. */
  blipId = 0;

  /** The Roblox part rendering this blip (assigned once, reused across lives). */
  part?: Part;

  /** Engine timestamp (ms) when the blip was fired. */
  bornAt = 0;

  /** Actor id of the shooter (so we don't damage ourselves). */
  shooterActorId = 0;

  /** True while the blip is in-flight and should participate in collisions. */
  alive = false;

  /** Simulation x in pixels. */
  x = 0;

  /** Simulation y in pixels. */
  y = 0;

  /** Velocity along simulation x, in pixels per step. */
  vx = 0;

  /** Velocity along simulation y, in pixels per step. */
  vy = 0;

  /**
   * Returns true when the blip has exceeded its maximum lifetime.
   *
   * @param now - Current simulation time in ms.
   */
  isExpired(now: number): boolean {
    return now - this.bornAt > BLIP_MAX_LIFETIME_MS;
  }
}

/**
 * Fixed-capacity pool that recycles Blip instances **and** their backing parts
 * so gameplay never allocates or destroys blip objects.
 *
 * Parts are created on first acquire and hidden rather than destroyed on
 * release.
 */
export class BlipPool {
  /** All blip instances (pre-allocated up to MAX_ACTIVE_BLIPS). */
  private readonly pool: Blip[] = [];

  /** Indices of pool slots that are currently free. */
  private readonly freeList: number[] = [];

  /** Live blips indexed by blipId for O(1) collision lookups. */
  readonly activeById = new Map<number, Blip>();

  /** Next monotonically-increasing blip id. */
  private nextId = 1;

  /**
   * Acquire a blip from the pool.
   *
   * @param shooterActorId - Actor id of the shooter.
   * @param now - Current simulation time in ms.
   * @returns The blip, or undefined if the pool is exhausted (cap reached).
   */
  acquire(shooterActorId: number, now: number): Blip | undefined {
    let blip: Blip;

    if (this.freeList.size() > 0) {
      const idx = this.freeList.pop()!;
      blip = this.pool[idx];
    } else if (this.pool.size() < MAX_ACTIVE_BLIPS) {
      blip = new Blip();
      this.pool.push(blip);
    } else {
      // Pool exhausted -- cap reached
      return undefined;
    }

    blip.blipId = this.nextId++;
    blip.shooterActorId = shooterActorId;
    blip.bornAt = now;
    blip.alive = true;

    this.activeById.set(blip.blipId, blip);
    return blip;
  }

  /**
   * Return a blip to the pool and hide its part.
   *
   * @param blip - The blip to release.
   */
  release(blip: Blip): void {
    if (!blip.alive) return;
    blip.alive = false;
    this.activeById.delete(blip.blipId);

    const part = blip.part;
    if (part) {
      part.Transparency = 1;
    }

    const idx = this.pool.indexOf(blip);
    if (idx >= 0) this.freeList.push(idx);
  }

  /** Release every active blip. */
  releaseAll(): void {
    for (const blip of this.liveBlips()) {
      this.release(blip);
    }
  }

  /** Release every blip and destroy the pooled parts. */
  destroyAll(): void {
    this.releaseAll();
    for (const blip of this.pool) {
      blip.part?.Destroy();
      blip.part = undefined;
    }
    this.pool.clear();
    this.freeList.clear();
    this.activeById.clear();
  }

  /** Live blips, snapshotted so callers may release during iteration. */
  liveBlips(): Blip[] {
    const out: Blip[] = [];
    for (const [, blip] of this.activeById) {
      out.push(blip);
    }
    return out;
  }
}
