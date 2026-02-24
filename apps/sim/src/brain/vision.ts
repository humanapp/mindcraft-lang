import type { Actor } from "./actor";
import type { SpatialGrid } from "./spatial-grid";

/**
 * An axis-aligned rectangle used as a line-of-sight obstacle.
 * x, y = center; width, height = full dimensions.
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

  for (let idx = 0; idx < obstacles.length; idx++) {
    const obs = obstacles[idx];

    let tMin = 0;
    let tMax = 1;

    // X slab
    if (Math.abs(dx) < 1e-8) {
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
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) continue;
    }

    // Y slab
    if (Math.abs(dy) < 1e-8) {
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
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) continue;
    }

    return true;
  }

  return false;
}

/**
 * Query all actors visible to `self` within a forward-facing cone.
 *
 * Uses the spatial grid to iterate only actors in nearby cells rather than
 * the entire world entity list, reducing work from O(N) to O(K) where K
 * is the number of actors within range cells.
 *
 * Results are returned **unsorted** for performance. Consumers that need
 * ordering (e.g. nearest-first) should sort or scan the result themselves.
 *
 * @param self       The observing actor
 * @param grid       Spatial grid containing all actors
 * @param range      Maximum sight distance in pixels
 * @param halfAngle  Half-angle of the vision cone in radians (e.g. pi/4 -> 90 deg total FOV)
 * @param obstacles  Axis-aligned rectangles that block line of sight
 * @param out        Optional pre-allocated results array (will be cleared and reused)
 * @returns          Array of visible actors with their squared distances (unsorted)
 */
export function queryVisibleActors(
  self: Actor,
  grid: SpatialGrid,
  range: number,
  halfAngle: number,
  allObstacles: ReadonlyArray<PrecomputedObstacle>,
  out?: SightResult[]
): SightResult[] {
  const ox = self.sprite.x;
  const oy = self.sprite.y;
  const facingX = Math.cos(self.sprite.rotation);
  const facingY = Math.sin(self.sprite.rotation);
  const rangeSq = range * range;
  const cosThreshold = Math.cos(halfAngle);

  const results = out ?? [];
  results.length = 0;

  // Per-observer obstacle culling: keep only obstacles whose center is close
  // enough that they could possibly block any ray within the vision range.
  // An obstacle at distance D (center-to-observer) with half-diagonal R can
  // only block a ray of length `range` if D - R <= range  ==>  D <= range + R.
  // We compare squared to avoid sqrt: distSq <= (range + R)^2 where R^2=cullRadiusSq.
  let nearObstacles: PrecomputedObstacle[];
  if (allObstacles.length === 0) {
    nearObstacles = [];
  } else {
    nearObstacles = [];
    for (let i = 0; i < allObstacles.length; i++) {
      const obs = allObstacles[i];
      const odx = obs.cx - ox;
      const ody = obs.cy - oy;
      const distSq = odx * odx + ody * ody;
      // (range + cullRadius)^2 = range^2 + 2-range-cullRadius + cullRadius^2
      // We have cullRadiusSq; compute cullRadius on the fly (only done once per
      // observer per obstacle, not per candidate).
      const cullRadius = Math.sqrt(obs.cullRadiusSq);
      const threshold = range + cullRadius;
      if (distSq <= threshold * threshold) {
        nearObstacles.push(obs);
      }
    }
  }
  const hasObstacles = nearObstacles.length > 0;

  // Determine which grid cells overlap the query circle
  const cellSize = grid.cellSize;
  const minCol = Math.max(0, Math.floor((ox - range) / cellSize));
  const maxCol = Math.min(grid.numCols - 1, Math.floor((ox + range) / cellSize));
  const minRow = Math.max(0, Math.floor((oy - range) / cellSize));
  const maxRow = Math.min(grid.numRows - 1, Math.floor((oy + range) / cellSize));

  for (let row = minRow; row <= maxRow; row++) {
    const rowOffset = row * grid.numCols;
    for (let col = minCol; col <= maxCol; col++) {
      const cell = grid.cells[col + rowOffset];
      for (let i = 0; i < cell.length; i++) {
        const other = cell[i];
        if (other === self) continue;

        const dx = other.sprite.x - ox;
        const dy = other.sprite.y - oy;
        const distSq = dx * dx + dy * dy;

        // Distance check (squared, no sqrt needed)
        if (distSq > rangeSq || distSq === 0) continue;

        // Cone check: dot(facing, dirToOther) >= cos(halfAngle)
        const invDist = 1 / Math.sqrt(distSq);
        const dot = dx * invDist * facingX + dy * invDist * facingY;
        if (dot < cosThreshold) continue;

        // Line-of-sight check (skipped entirely when no nearby obstacles)
        if (hasObstacles && isLineOfSightBlocked(ox, oy, other.sprite.x, other.sprite.y, nearObstacles)) {
          continue;
        }

        results.push({ actor: other, distanceSq: distSq });
      }
    }
  }

  return results;
}

/**
 * Draw a debug visualization of an actor's vision cone.
 *
 * @param graphics  Phaser graphics object to draw into
 * @param actor     The observing actor
 * @param range     Vision range in pixels
 * @param halfAngle Half-angle of the cone in radians
 * @param color     Line color (default: translucent yellow)
 * @param alpha     Fill alpha (default: 0.1)
 */
export function drawVisionCone(
  graphics: Phaser.GameObjects.Graphics,
  actor: Actor,
  range: number,
  halfAngle: number,
  color: number = 0xffff00,
  alpha: number = 0.1
): void {
  graphics.clear();

  const ox = actor.sprite.x;
  const oy = actor.sprite.y;
  const facing = actor.sprite.rotation;

  // Draw the cone as a filled wedge
  graphics.fillStyle(color, alpha);
  graphics.lineStyle(1, color, 0.5);

  graphics.beginPath();
  graphics.moveTo(ox, oy);

  // Arc from -halfAngle to +halfAngle relative to facing
  const startAngle = facing - halfAngle;
  const endAngle = facing + halfAngle;
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const angle = startAngle + ((endAngle - startAngle) * i) / steps;
    const px = ox + Math.cos(angle) * range;
    const py = oy + Math.sin(angle) * range;
    graphics.lineTo(px, py);
  }

  graphics.closePath();
  graphics.fillPath();
  graphics.strokePath();
}
