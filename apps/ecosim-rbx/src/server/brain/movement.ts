// Locomotion mover for the Roblox projection of ecosim.
// - Steering intents are blended by weighted average. An `exclusive` intent
//   overrides all others (highest-weight exclusive wins if multiple are present).
// - Thrust drives the part's horizontal velocity toward a cruise speed rather
//   than accumulating Matter forces; the returned force magnitude keeps the
//   energy economy on ecosim's numbers.

import type { Vector2 } from "@mindcraft-lang/core/app";
import type { CreatureSprite } from "../world/sprite";
import type { Actor } from "./actor";
import type { PrecomputedObstacle } from "./vision";

/** One movement request contributed by an actuator during a brain tick. */
export type Steering = {
  turn: number; // -1..+1
  forward: number; // 0..1
  weight: number; // > 0, blending influence (higher = more pull)
  exclusive?: boolean; // if true, this intent is the sole consideration
  label?: string; // debug tag
  speedMultiplier?: number; // multiplier on thrust (default 1). <1 = slower, >1 = faster
};

/** Tuning for a single {@link Mover}. */
export type MoverConfig = {
  // Turning + thrust
  maxTurnRate: number; // rad/sec, e.g. 3..10
  thrustForce: number; // force magnitude, e.g. 0.001..0.01

  // Turning reduces forward thrust (pond-like)
  forwardWhenTurning: number; // throttle multiplier at abs(turn)=1 (e.g. 0.25)

  // Smoothing (0 disables)
  smoothingHz: number; // e.g. 12

  // Lateral damping: kills sideways velocity relative to facing direction.
  // 0 = no damping (ice/water), 1 = instant kill (perfect traction).
  lateralDamping: number; // e.g. 0.92

  // Max speed cap (pixels/step). 0 = no cap.
  maxSpeed: number;

  // Weight exponent for priority blending. Steering weights are raised to
  // this power before averaging, so higher-priority intents dominate more
  // aggressively. 1 = linear blend, 2 = quadratic (default).
  weightExponent: number;
};

/**
 * Fraction of horizontal speed shed per 60 Hz frame. Sets both the decay of
 * external shoves and, with {@link CRUISE_ACCEL_HZ}, the steady-state cruise
 * speed a full-throttle actor settles at.
 */
const AIR_DRAG_PER_FRAME = 0.08;

/**
 * Acceleration constant, in reciprocal seconds, applied to the gap between the
 * current speed and the commanded cruise speed. Equal to
 * `AIR_DRAG_PER_FRAME * 60` so a full-throttle actor settles at exactly
 * `maxSpeed * speedMultiplier`.
 */
const CRUISE_ACCEL_HZ = AIR_DRAG_PER_FRAME * 60;

function clamp(x: number, lo: number, hi: number): number {
  return math.max(lo, math.min(hi, x));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Blends steering contributions into a heading and velocity for one actor. */
export class Mover {
  private cfg: MoverConfig;

  private smoothedTurn = 0;
  private smoothedThrottle = 0;

  /**
   * @param cfg - Overrides merged over the default configuration.
   */
  constructor(cfg?: Partial<MoverConfig>) {
    this.cfg = {
      maxTurnRate: 6.0,
      thrustForce: 0.005,

      forwardWhenTurning: 0.25,

      smoothingHz: 12,
      lateralDamping: 0.92,
      maxSpeed: 5,
      weightExponent: 2,

      ...cfg,
    };
  }

  /**
   * Call per creature per frame. Turns the sprite and drives its horizontal
   * velocity from the blended steering intent.
   *
   * @param sprite - The creature being moved.
   * @param dtSec - Elapsed simulation time in seconds.
   * @param contributions - Steering requests gathered this tick.
   * @returns The thrust force magnitude applied this frame (0 if none), on
   *   ecosim's force scale so the energy drain keeps its numbers.
   */
  step(sprite: CreatureSprite, dtSec: number, contributions: Steering[]): number {
    const body = sprite.body;
    if (!body) return 0;

    // Guard dt (avoids NaNs if delta=0)
    const dt = math.max(dtSec, 1e-6);

    // 1) Arbitration -> intent
    const intent = this.buildIntent(contributions);

    // 2) Optional smoothing (EMA)
    if (this.cfg.smoothingHz > 0) {
      const alpha = clamp(dt * this.cfg.smoothingHz, 0, 1);
      this.smoothedTurn = lerp(this.smoothedTurn, intent.turn, alpha);
      this.smoothedThrottle = lerp(this.smoothedThrottle, intent.throttle, alpha);
    } else {
      this.smoothedTurn = intent.turn;
      this.smoothedThrottle = intent.throttle;
    }

    // Final per-frame command values
    const turn = clamp(this.smoothedTurn, -1, 1);
    let throttle = clamp(this.smoothedThrottle, 0, 1);

    // 3) Reduce throttle when turning hard
    throttle *= lerp(1.0, this.cfg.forwardWhenTurning, math.abs(turn));
    throttle = clamp(throttle, 0, 1);

    // Speed multiplier from quickly/slowly modifiers (applies to both
    // turn rate and forward thrust so "turn slowly" and "move quickly"
    // affect all aspects of locomotion uniformly).
    const speedMul = math.max(0, intent.speedMultiplier);

    // 4) Directly set the heading; the part's yaw follows it.
    const omega = turn * this.cfg.maxTurnRate * speedMul;
    const newAngle = sprite.rotation + omega * dt;
    sprite.setRotation(newAngle);

    // 5) Accelerate toward the commanded cruise speed along the heading, then
    //    shed drag. Both terms build on the live velocity, so an external shove
    //    persists and decays instead of being overwritten.
    const retain = (1 - AIR_DRAG_PER_FRAME) ** (dt * 60);
    let appliedForceMag = 0;
    if (throttle > 1e-3) {
      appliedForceMag = throttle * this.cfg.thrustForce * speedMul;
      const angle = sprite.rotation;
      const cruise = this.cfg.maxSpeed * speedMul * throttle;
      const accel = cruise * CRUISE_ACCEL_HZ * dt;
      sprite.setVelocity(
        (body.velocity.x + math.cos(angle) * accel) * retain,
        (body.velocity.y + math.sin(angle) * accel) * retain
      );
    } else {
      sprite.setVelocity(body.velocity.x * retain, body.velocity.y * retain);
    }

    // 6) Lateral damping: decompose velocity into forward/lateral components
    //    relative to heading, then dampen the lateral part. This prevents
    //    sideways sliding when turning, giving land-like traction.
    if (this.cfg.lateralDamping > 0) {
      const heading = sprite.rotation;
      const cosH = math.cos(heading);
      const sinH = math.sin(heading);

      const vx = body.velocity.x;
      const vy = body.velocity.y;

      // Project velocity onto heading (forward) and perpendicular (lateral)
      const forwardSpeed = vx * cosH + vy * sinH;
      const lateralSpeed = -vx * sinH + vy * cosH;

      // Dampen lateral component per frame, scaled by dt
      const dampPerFrame = 1 - this.cfg.lateralDamping;
      const lateralRetain = dampPerFrame ** (dt * 60); // 60 fps baseline
      const dampedLateral = lateralSpeed * lateralRetain;

      // Reconstruct velocity from forward (unchanged) + dampened lateral
      const newVx = forwardSpeed * cosH - dampedLateral * sinH;
      const newVy = forwardSpeed * sinH + dampedLateral * cosH;
      sprite.setVelocity(newVx, newVy);
    }

    // 7) Enforce max speed cap
    if (this.cfg.maxSpeed > 0) {
      const vx = body.velocity.x;
      const vy = body.velocity.y;
      const speedSq = vx * vx + vy * vy;
      const maxSpeedSq = this.cfg.maxSpeed * this.cfg.maxSpeed;
      if (speedSq > maxSpeedSq) {
        const scale = this.cfg.maxSpeed / math.sqrt(speedSq);
        sprite.setVelocity(vx * scale, vy * scale);
      }
    }

    return appliedForceMag;
  }

  /**
   * Build the final movement intent from a set of steering contributions.
   *
   * @param contribs - Steering requests gathered this tick.
   * @returns The blended turn (-1..1), throttle (0..1), and speed multiplier.
   */
  buildIntent(contribs: Steering[]): {
    turn: number;
    throttle: number;
    speedMultiplier: number;
  } {
    if (contribs.size() === 0) return { turn: 0, throttle: 0, speedMultiplier: 1 };

    // Filter out zero/negative weight intents
    const valid = contribs.filter((s) => s.weight > 0);
    if (valid.size() === 0) return { turn: 0, throttle: 0, speedMultiplier: 1 };

    // If any exclusive intents exist, pick the one with highest weight
    const exclusives = valid.filter((s) => s.exclusive === true);
    if (exclusives.size() > 0) {
      let best = exclusives[0];
      for (let i = 1; i < exclusives.size(); i++) {
        if (exclusives[i].weight > best.weight) best = exclusives[i];
      }
      return {
        turn: clamp(best.turn, -1, 1),
        throttle: clamp(best.forward, 0, 1),
        speedMultiplier: best.speedMultiplier ?? 1,
      };
    }

    // Weighted average blend using exponentiated weights.
    // Raising weights to a power > 1 makes high-priority intents dominate
    // much more aggressively, preventing low-priority noise (e.g. wander at
    // priority 0.5) from visibly perturbing high-priority goals (priority 10).
    const exp = this.cfg.weightExponent;
    let sumW = 0;
    let turnAcc = 0;
    let fwdAcc = 0;
    let speedAcc = 0;

    for (const s of valid) {
      const w = s.weight ** exp;
      sumW += w;
      turnAcc += clamp(s.turn, -1, 1) * w;
      fwdAcc += clamp(s.forward, 0, 1) * w;
      speedAcc += (s.speedMultiplier ?? 1) * w;
    }

    return {
      turn: clamp(turnAcc / sumW, -1, 1),
      throttle: clamp(fwdAcc / sumW, 0, 1),
      speedMultiplier: speedAcc / sumW,
    };
  }
}

/**
 * Helper: compute angular difference in [-PI, PI] range.
 */
function angleDiff(from: number, to: number): number {
  let diff = to - from;
  while (diff > math.pi) diff -= 2 * math.pi;
  while (diff < -math.pi) diff += 2 * math.pi;
  return diff;
}

/**
 * Generates a Steering contribution to move toward a target position.
 * Non-exclusive, so it blends with other intents (e.g. steerAvoid -> orbiting).
 *
 * @param selfActor - The moving actor.
 * @param targetPos - Target position in simulation pixels.
 * @param weight - Blending influence.
 * @param speedMultiplier - Multiplier on turn rate and thrust.
 */
export function steerToward(
  selfActor: Actor,
  targetPos: Vector2,
  weight: number,
  speedMultiplier: number = 1
): Steering {
  const dx = targetPos.X - selfActor.sprite.x;
  const dy = targetPos.Y - selfActor.sprite.y;
  const dist = math.sqrt(dx * dx + dy * dy);

  if (dist < 1e-4) {
    return { turn: 0, forward: 0, weight: 0, label: "steerToward" };
  }

  const angleToTarget = math.atan2(dy, dx);
  const diff = angleDiff(selfActor.sprite.rotation, angleToTarget);

  // Turn proportional to angular difference (full turn at PI/2+)
  const turn = clamp(diff / (math.pi / 2), -1, 1);

  // More forward thrust when roughly facing the target
  const forward = clamp(1 - math.abs(diff) / math.pi, 0, 1);

  return { turn, forward, weight, speedMultiplier, label: "steerToward" };
}

/**
 * Generates a Steering contribution to move away from a target position.
 * Non-exclusive, so it blends with other intents.
 *
 * @param selfActor - The moving actor.
 * @param targetPos - Position to flee, in simulation pixels.
 * @param weight - Blending influence.
 * @param speedMultiplier - Multiplier on turn rate and thrust.
 */
export function steerAwayFrom(
  selfActor: Actor,
  targetPos: Vector2,
  weight: number,
  speedMultiplier: number = 1
): Steering {
  const dx = targetPos.X - selfActor.sprite.x;
  const dy = targetPos.Y - selfActor.sprite.y;
  const dist = math.sqrt(dx * dx + dy * dy);

  if (dist < 1e-4) {
    return {
      turn: 0,
      forward: 1,
      weight,
      speedMultiplier,
      label: "steerAwayFrom",
    };
  }

  // Desired direction is directly away from target
  const awayAngle = math.atan2(-dy, -dx);
  const diff = angleDiff(selfActor.sprite.rotation, awayAngle);

  const turn = clamp(diff / (math.pi / 2), -1, 1);
  const forward = clamp(1 - math.abs(diff) / math.pi, 0, 1);

  return { turn, forward, weight, speedMultiplier, label: "steerAwayFrom" };
}

/**
 * Generates a Steering contribution to avoid a target position (strong turn
 * away when close, fading to no effect at distance). Non-exclusive, so it
 * blends with approach behaviors to create orbiting.
 *
 * Strength ramps linearly with proximity: zero at the outer radius, maximum
 * at the inner radius. Inside the inner radius a reverse-thrust component is
 * added so the actor actively pushes away instead of just turning.
 *
 * @param selfActor - The moving actor.
 * @param targetPos - Position to avoid, in simulation pixels.
 * @param weight - Maximum blending influence.
 * @param speedMultiplier - Multiplier on turn rate and thrust.
 */
export function steerAvoid(
  selfActor: Actor,
  targetPos: Vector2,
  weight: number,
  speedMultiplier: number = 1
): Steering {
  const dx = targetPos.X - selfActor.sprite.x;
  const dy = targetPos.Y - selfActor.sprite.y;
  const dist = math.sqrt(dx * dx + dy * dy);

  // Fade zone: full strength inside innerRadius, zero at outerRadius
  const innerRadius = 40;
  const outerRadius = 120;

  if (dist >= outerRadius) {
    return { turn: 0, forward: 0, weight: 0, label: "steerAvoid" };
  }

  // Proximity in [0,1]: 0 at outerRadius, 1 at innerRadius and below.
  const linearT = clamp((outerRadius - dist) / (outerRadius - innerRadius), 0, 1);

  const angleToTarget = math.atan2(dy, dx);
  const diff = angleDiff(selfActor.sprite.rotation, angleToTarget);

  // Turn away: negate the angular difference direction
  // If target is to the left (diff < 0), turn right (+1), and vice versa
  const turnAway = diff >= 0 ? -1 : 1;
  const turn = turnAway * linearT; // keep turn on the steeper linear curve so it reacts early

  // Inside innerRadius, add a "back away" forward component so the actor
  // doesn't just spin in place but actually retreats. The forward vector
  // is computed from the repulsion direction (away from target).
  const awayAngle = math.atan2(-dy, -dx);
  const awayDiff = angleDiff(selfActor.sprite.rotation, awayAngle);
  // forward > 0 only when roughly facing away from the target
  const forwardEscape = dist < innerRadius ? clamp(1 - math.abs(awayDiff) / math.pi, 0, 1) * linearT : 0;

  return {
    turn,
    forward: forwardEscape,
    weight: linearT * weight, // linear weight so blending kicks in early
    speedMultiplier,
    label: "steerAvoid",
  };
}

// -- Obstacle & Wall Avoidance ----------------------------------------------

/**
 * Nearest point on an AABB (center + half-extents) to a query point.
 */
function nearestPointOnAABB(
  px: number,
  py: number,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number
): { nx: number; ny: number } {
  return {
    nx: clamp(px, cx - halfW, cx + halfW),
    ny: clamp(py, cy - halfH, cy + halfH),
  };
}

/**
 * Generates a Steering contribution that repels the actor away from nearby
 * AABB obstacles and world-boundary walls.
 *
 * For each obstacle / wall segment within `avoidRadius`, the closest point on
 * the shape is found and a repulsion vector (actor <- closest-point) is
 * accumulated with strength proportional to `1 - (dist / avoidRadius)`.
 * The summed repulsion is then converted into a turn + forward steering.
 *
 * @param selfActor          The moving actor
 * @param obstacles     Obstacle AABBs in simulation pixels
 * @param worldWidth    Width of the world (for boundary walls)
 * @param worldHeight   Height of the world (for boundary walls)
 * @param avoidRadius   Distance at which avoidance begins (pixels)
 * @param weight        Maximum blending weight
 */
export function steerAvoidObstacles(
  selfActor: Actor,
  obstacles: ReadonlyArray<PrecomputedObstacle>,
  worldWidth: number,
  worldHeight: number,
  avoidRadius: number = 60,
  weight: number = 1.0
): Steering {
  const px = selfActor.sprite.x;
  const py = selfActor.sprite.y;

  let repX = 0;
  let repY = 0;

  // Helper: accumulate repulsion from the nearest point (nx, ny) on a shape
  const accumulate = (nx: number, ny: number) => {
    const dx = px - nx;
    const dy = py - ny;
    const dist = math.sqrt(dx * dx + dy * dy);
    if (dist >= avoidRadius || dist < 1e-4) return;

    // Strength ramps linearly from 0 at avoidRadius to 1 at distance 0
    const strength = 1 - dist / avoidRadius;
    // Normalize direction, scale by strength
    repX += (dx / dist) * strength;
    repY += (dy / dist) * strength;
  };

  // -- AABB obstacles -------------------------------------------
  for (const obs of obstacles) {
    const halfW = (obs.maxX - obs.minX) / 2;
    const halfH = (obs.maxY - obs.minY) / 2;
    const { nx, ny } = nearestPointOnAABB(px, py, obs.cx, obs.cy, halfW, halfH);
    accumulate(nx, ny);
  }

  // -- World boundary walls -------------------------------------
  // Treat each edge as a line; nearest point is just the clamped projection.
  // Left wall  (x = 0)
  accumulate(0, clamp(py, 0, worldHeight));
  // Right wall (x = worldWidth)
  accumulate(worldWidth, clamp(py, 0, worldHeight));
  // Top wall   (y = 0)
  accumulate(clamp(px, 0, worldWidth), 0);
  // Bottom wall (y = worldHeight)
  accumulate(clamp(px, 0, worldWidth), worldHeight);

  // -- Convert accumulated repulsion to Steering ----------------
  const repMag = math.sqrt(repX * repX + repY * repY);
  if (repMag < 1e-4) {
    return { turn: 0, forward: 0, weight: 0, label: "steerAvoidObstacles" };
  }

  // Desired "away" angle from the repulsion vector
  const awayAngle = math.atan2(repY, repX);
  const diff = angleDiff(selfActor.sprite.rotation, awayAngle);

  // Turn toward the repulsion direction; stronger when not already facing it
  const turn = clamp(diff / math.pi, -1, 1);

  // Small forward nudge so the actor slides along walls instead of stopping
  const forward = clamp(0.3 * repMag, 0, 0.5);

  // Weight scales with how strong the total repulsion is (capped at `weight`)
  const effectiveWeight = clamp(repMag, 0, 1) * weight;

  return {
    turn,
    forward,
    weight: effectiveWeight,
    label: "steerAvoidObstacles",
  };
}

/**
 * Generates a Steering contribution to move forward along current facing direction.
 * Non-exclusive, blends with other intents. Use as a default "cruise" behavior
 * or for simple forward movement without a specific target.
 *
 * @param selfActor - The moving actor.
 * @param weight - Blending influence.
 * @param speedMultiplier - Multiplier on turn rate and thrust.
 */
export function steerForward(selfActor: Actor, weight: number, speedMultiplier: number = 1): Steering {
  return {
    turn: 0,
    forward: 1,
    weight,
    speedMultiplier,
    label: "steerForward",
  };
}

/**
 * Generates a Steering contribution that rotates to face a target position
 * without producing any forward thrust. Useful for tracking or aiming.
 *
 * @param selfActor - The turning actor.
 * @param targetPos - Target position in simulation pixels.
 * @param weight - Blending influence.
 * @param speedMultiplier - Multiplier on turn rate.
 */
export function turnToward(
  selfActor: Actor,
  targetPos: Vector2,
  weight: number,
  speedMultiplier: number = 1
): Steering {
  const dx = targetPos.X - selfActor.sprite.x;
  const dy = targetPos.Y - selfActor.sprite.y;
  const dist = math.sqrt(dx * dx + dy * dy);

  if (dist < 1e-4) {
    return { turn: 0, forward: 0, weight: 0, label: "turnToward" };
  }

  const angleToTarget = math.atan2(dy, dx);
  const diff = angleDiff(selfActor.sprite.rotation, angleToTarget);

  const turn = clamp(diff / (math.pi / 2), -1, 1);

  return { turn, forward: 0, weight, speedMultiplier, label: "turnToward" };
}

/**
 * Generates a Steering contribution that rotates to face away from a target
 * position without producing any forward thrust. Useful for orienting an
 * escape direction before committing to movement.
 *
 * @param selfActor - The turning actor.
 * @param targetPos - Position to face away from, in simulation pixels.
 * @param weight - Blending influence.
 * @param speedMultiplier - Multiplier on turn rate.
 */
export function turnAwayFrom(
  selfActor: Actor,
  targetPos: Vector2,
  weight: number,
  speedMultiplier: number = 1
): Steering {
  const dx = targetPos.X - selfActor.sprite.x;
  const dy = targetPos.Y - selfActor.sprite.y;
  const dist = math.sqrt(dx * dx + dy * dy);

  if (dist < 1e-4) {
    return { turn: 0, forward: 0, weight: 0, label: "turnAwayFrom" };
  }

  const awayAngle = math.atan2(-dy, -dx);
  const diff = angleDiff(selfActor.sprite.rotation, awayAngle);

  const turn = clamp(diff / (math.pi / 2), -1, 1);

  return { turn, forward: 0, weight, speedMultiplier, label: "turnAwayFrom" };
}

/**
 * Generates a Steering contribution that rotates to face a specific world
 * angle (radians) without producing any forward thrust. Useful for compass
 * directions (north/south/east/west) or turning around (180 degrees).
 *
 * @param selfActor - The turning actor.
 * @param targetAngle - Absolute heading to face, in radians.
 * @param weight - Blending influence.
 * @param speedMultiplier - Multiplier on turn rate.
 */
export function turnToAngle(
  selfActor: Actor,
  targetAngle: number,
  weight: number,
  speedMultiplier: number = 1
): Steering {
  const diff = angleDiff(selfActor.sprite.rotation, targetAngle);

  const turn = clamp(diff / (math.pi / 2), -1, 1);

  return { turn, forward: 0, weight, speedMultiplier, label: "turnToAngle" };
}
