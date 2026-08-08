import type { Actor } from "./actor";

/**
 * An axis-aligned rectangle used as a line-of-sight obstacle.
 * x, y = center; width, height = full dimensions, all in simulation pixels.
 */
export interface Obstacle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Obstacle with precomputed min/max bounds so we don't recompute
 * halfW/halfH/minX/maxX/minY/maxY on every LOS ray test.
 * Construct once via {@link precomputeObstacles}.
 */
export interface PrecomputedObstacle {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** Center X -- used for per-observer range culling */
  readonly cx: number;
  /** Center Y -- used for per-observer range culling */
  readonly cy: number;
  /**
   * Squared "cull radius" -- half-diagonal squared.
   * An obstacle can only block a ray within (visionRange + cullRadius) of the
   * observer, so we store this for fast broadphase rejection.
   */
  readonly cullRadiusSq: number;
}

/**
 * Precompute obstacle bounds once at world setup time.
 *
 * @param obstacles - Static obstacle rectangles in simulation pixels.
 * @returns One precomputed record per input obstacle.
 */
export function precomputeObstacles(obstacles: ReadonlyArray<Obstacle>): PrecomputedObstacle[] {
  return obstacles.map((obs) => {
    const halfW = obs.width / 2;
    const halfH = obs.height / 2;
    return {
      minX: obs.x - halfW,
      maxX: obs.x + halfW,
      minY: obs.y - halfH,
      maxY: obs.y + halfH,
      cx: obs.x,
      cy: obs.y,
      cullRadiusSq: halfW * halfW + halfH * halfH,
    };
  });
}

/** One actor seen by an observer, with the squared distance between them. */
export interface SightResult {
  /** The visible actor */
  actor: Actor;
  /** Squared distance from the observer */
  distanceSq: number;
}

/**
 * Returns true if the ray from (ox, oy) -> (tx, ty) is blocked by any obstacle.
 *
 * Uses slab intersection against each AABB. Obstacles must be precomputed via
 * {@link precomputeObstacles} so bounds are not recomputed on every call.
 *
 * @param ox - Ray origin x in simulation pixels.
 * @param oy - Ray origin y in simulation pixels.
 * @param tx - Ray target x in simulation pixels.
 * @param ty - Ray target y in simulation pixels.
 * @param obstacles - Precomputed obstacle bounds to test against.
 */
export function isLineOfSightBlocked(
  ox: number,
  oy: number,
  tx: number,
  ty: number,
  obstacles: ReadonlyArray<PrecomputedObstacle>
): boolean {
  const dx = tx - ox;
  const dy = ty - oy;

  for (let idx = 0; idx < obstacles.size(); idx++) {
    const obs = obstacles[idx];

    let tMin = 0;
    let tMax = 1;

    // X slab
    if (math.abs(dx) < 1e-8) {
      if (ox < obs.minX || ox > obs.maxX) continue;
    } else {
      const invDx = 1 / dx;
      let t1 = (obs.minX - ox) * invDx;
      let t2 = (obs.maxX - ox) * invDx;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tMin = math.max(tMin, t1);
      tMax = math.min(tMax, t2);
      if (tMin > tMax) continue;
    }

    // Y slab
    if (math.abs(dy) < 1e-8) {
      if (oy < obs.minY || oy > obs.maxY) continue;
    } else {
      const invDy = 1 / dy;
      let t1 = (obs.minY - oy) * invDy;
      let t2 = (obs.maxY - oy) * invDy;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tMin = math.max(tMin, t1);
      tMax = math.min(tMax, t2);
      if (tMin > tMax) continue;
    }

    return true;
  }

  return false;
}

/**
 * Query all actors visible to `selfActor` within a forward-facing cone.
 *
 * Results are returned **unsorted** for performance. Consumers that need
 * ordering (e.g. nearest-first) should sort or scan the result themselves.
 *
 * @param selfActor       The observing actor
 * @param actors     Every live actor in the engine
 * @param range      Maximum sight distance in pixels
 * @param halfAngle  Half-angle of the vision cone in radians (e.g. pi/4 -> 90 deg total FOV)
 * @param allObstacles  Axis-aligned rectangles that block line of sight
 * @param out        Optional pre-allocated results array (will be cleared and reused)
 * @returns          Array of visible actors with their squared distances (unsorted)
 */
export function queryVisibleActors(
  selfActor: Actor,
  actors: ReadonlyArray<Actor>,
  range: number,
  halfAngle: number,
  allObstacles: ReadonlyArray<PrecomputedObstacle>,
  out?: SightResult[]
): SightResult[] {
  const ox = selfActor.sprite.x;
  const oy = selfActor.sprite.y;
  const facingX = math.cos(selfActor.sprite.rotation);
  const facingY = math.sin(selfActor.sprite.rotation);
  const rangeSq = range * range;
  const cosThreshold = math.cos(halfAngle);

  const results = out ?? [];
  results.clear();

  // Per-observer obstacle culling: keep only obstacles whose center is close
  // enough that they could possibly block any ray within the vision range.
  // An obstacle at distance D (center-to-observer) with half-diagonal R can
  // only block a ray of length `range` if D - R <= range  ==>  D <= range + R.
  // We compare squared to avoid sqrt: distSq <= (range + R)^2 where R^2=cullRadiusSq.
  const nearObstacles: PrecomputedObstacle[] = [];
  for (let i = 0; i < allObstacles.size(); i++) {
    const obs = allObstacles[i];
    const odx = obs.cx - ox;
    const ody = obs.cy - oy;
    const distSq = odx * odx + ody * ody;
    // (range + cullRadius)^2 = range^2 + 2-range-cullRadius + cullRadius^2
    // We have cullRadiusSq; compute cullRadius on the fly (only done once per
    // observer per obstacle, not per candidate).
    const cullRadius = math.sqrt(obs.cullRadiusSq);
    const threshold = range + cullRadius;
    if (distSq <= threshold * threshold) {
      nearObstacles.push(obs);
    }
  }
  const hasObstacles = nearObstacles.size() > 0;

  for (let i = 0; i < actors.size(); i++) {
    const other = actors[i];
    if (other === selfActor) continue;

    const dx = other.sprite.x - ox;
    const dy = other.sprite.y - oy;
    const distSq = dx * dx + dy * dy;

    // Distance check (squared, no sqrt needed)
    if (distSq > rangeSq || distSq === 0) continue;

    // Cone check: dot(facing, dirToOther) >= cos(halfAngle)
    const invDist = 1 / math.sqrt(distSq);
    const dot = dx * invDist * facingX + dy * invDist * facingY;
    if (dot < cosThreshold) continue;

    // Line-of-sight check (skipped entirely when no nearby obstacles)
    if (hasObstacles && isLineOfSightBlocked(ox, oy, other.sprite.x, other.sprite.y, nearObstacles)) {
      continue;
    }

    results.push({ actor: other, distanceSq: distSq });
  }

  return results;
}
