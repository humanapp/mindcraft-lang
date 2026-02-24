// Phaser 3 Matter.js locomotion mover.
// - Works with Phaser.Physics.Matter.Sprite and MatterJS bodies.
// - Uses Matter's native force/torque system for physically accurate movement.
// - Steering intents are blended by weighted average. An `exclusive` intent
//   overrides all others (highest-weight exclusive wins if multiple are present).

import type { Vector2 } from "@mindcraft-lang/core";
import type { Actor } from "./actor";
import type { Obstacle } from "./vision";

export type Steering = {
  turn: number; // -1..+1
  forward: number; // 0..1
  weight: number; // > 0, blending influence (higher = more pull)
  exclusive?: boolean; // if true, this intent is the sole consideration
  label?: string; // debug tag
  speedMultiplier?: number; // multiplier on thrust (default 1). <1 = slower, >1 = faster
};

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

  // Max speed cap (pixels/sec). 0 = no cap.
  maxSpeed: number;

  // Weight exponent for priority blending. Steering weights are raised to
  // this power before averaging, so higher-priority intents dominate more
  // aggressively. 1 = linear blend (old behavior), 2 = quadratic (default).
  // With exponent 2, priority 10 vs 0.5 becomes 100:0.25 (400:1) instead of
  // 20:1, virtually eliminating low-priority noise.
  weightExponent: number;
};

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Linearly interpolate between two 0xRRGGBB colors. */
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export class Mover {
  private cfg: MoverConfig;

  private smoothedTurn = 0;
  private smoothedThrottle = 0;

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
   * Call per creature per frame.
   * Applies steering to a Matter body via angular velocity and force.
   * Returns the magnitude of thrust force applied this frame (0 if none).
   */
  step(sprite: Phaser.Physics.Matter.Sprite, dtSec: number, contributions: Steering[]): number {
    const body = sprite.body as MatterJS.BodyType | null;
    if (!body) return 0;

    // Guard dt (avoids NaNs if delta=0)
    const dt = Math.max(dtSec, 1e-6);

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
    throttle *= lerp(1.0, this.cfg.forwardWhenTurning, Math.abs(turn));
    throttle = clamp(throttle, 0, 1);

    // Speed multiplier from quickly/slowly modifiers (applies to both
    // turn rate and forward thrust so "turn slowly" and "move quickly"
    // affect all aspects of locomotion uniformly).
    const speedMul = Math.max(0, intent.speedMultiplier);

    // 4) Directly set the body angle for turning (we use setFixedRotation,
    //    so physics won't rotate the body -- we have full control).
    const omega = turn * this.cfg.maxTurnRate * speedMul;
    const newAngle = sprite.rotation + omega * dt;
    sprite.setRotation(newAngle);

    // 5) Apply forward thrust force along heading, scaled by speed multiplier
    let appliedForceMag = 0;
    if (throttle > 1e-3) {
      appliedForceMag = throttle * this.cfg.thrustForce * speedMul;
      const angle = sprite.rotation;
      const fx = Math.cos(angle) * appliedForceMag;
      const fy = Math.sin(angle) * appliedForceMag;
      sprite.applyForce(new Phaser.Math.Vector2(fx, fy));
    }

    // 6) Lateral damping: decompose velocity into forward/lateral components
    //    relative to heading, then dampen the lateral part. This prevents
    //    sideways sliding when turning, giving land-like traction.
    if (this.cfg.lateralDamping > 0) {
      const heading = sprite.rotation;
      const cosH = Math.cos(heading);
      const sinH = Math.sin(heading);

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
        const scale = this.cfg.maxSpeed / Math.sqrt(speedSq);
        sprite.setVelocity(vx * scale, vy * scale);
      }
    }

    return appliedForceMag;
  }

  /**
   * Build the final movement intent from a set of steering contributions.
   * Exposed publicly for debug visualization.
   */
  buildIntent(contribs: Steering[]): {
    turn: number;
    throttle: number;
    speedMultiplier: number;
  } {
    if (!contribs.length) return { turn: 0, throttle: 0, speedMultiplier: 1 };

    // Filter out zero/negative weight intents
    const valid = contribs.filter((s) => s.weight > 0);
    if (!valid.length) return { turn: 0, throttle: 0, speedMultiplier: 1 };

    // If any exclusive intents exist, pick the one with highest weight
    const exclusives = valid.filter((s) => s.exclusive);
    if (exclusives.length > 0) {
      let best = exclusives[0];
      for (let i = 1; i < exclusives.length; i++) {
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
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

/**
 * Generates a Steering contribution to move toward a target position.
 * Non-exclusive, so it blends with other intents (e.g. steerAvoid -> orbiting).
 */
export function steerToward(self: Actor, targetPos: Vector2, weight: number, speedMultiplier: number = 1): Steering {
  const dx = targetPos.X - self.sprite.x;
  const dy = targetPos.Y - self.sprite.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 1e-4) {
    return { turn: 0, forward: 0, weight: 0, label: "steerToward" };
  }

  const angleToTarget = Math.atan2(dy, dx);
  const diff = angleDiff(self.sprite.rotation, angleToTarget);

  // Turn proportional to angular difference (full turn at PI/2+)
  const turn = clamp(diff / (Math.PI / 2), -1, 1);

  // More forward thrust when roughly facing the target
  const forward = clamp(1 - Math.abs(diff) / Math.PI, 0, 1);

  return { turn, forward, weight, speedMultiplier, label: "steerToward" };
}

/**
 * Generates a Steering contribution to move away from a target position.
 * Non-exclusive, so it blends with other intents.
 */
export function steerAwayFrom(self: Actor, targetPos: Vector2, weight: number, speedMultiplier: number = 1): Steering {
  const dx = targetPos.X - self.sprite.x;
  const dy = targetPos.Y - self.sprite.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

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
  const awayAngle = Math.atan2(-dy, -dx);
  const diff = angleDiff(self.sprite.rotation, awayAngle);

  const turn = clamp(diff / (Math.PI / 2), -1, 1);
  const forward = clamp(1 - Math.abs(diff) / Math.PI, 0, 1);

  return { turn, forward, weight, speedMultiplier, label: "steerAwayFrom" };
}

/**
 * Generates a Steering contribution to avoid a target position (strong turn
 * away when close, fading to no effect at distance). Non-exclusive, so it
 * blends with approach behaviors to create orbiting.
 *
 * Strength follows an inverse-power curve: nearly zero at the outer radius,
 * ramping aggressively as the actor gets closer.  Inside the inner radius,
 * avoidance is at maximum and a reverse-thrust component is added so the
 * actor actively pushes away instead of just turning.
 */
export function steerAvoid(self: Actor, targetPos: Vector2, weight: number, speedMultiplier: number = 1): Steering {
  const dx = targetPos.X - self.sprite.x;
  const dy = targetPos.Y - self.sprite.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Fade zone: full strength inside innerRadius, zero at outerRadius
  const innerRadius = 40;
  const outerRadius = 120;

  if (dist >= outerRadius) {
    return { turn: 0, forward: 0, weight: 0, label: "steerAvoid" };
  }

  // Inverse-power strength curve:  linear t in [0,1] is raised to a power
  // so that strength stays low at distance and ramps sharply when close.
  // At outerRadius t=0, at innerRadius (and below) t=1.
  const linearT = clamp((outerRadius - dist) / (outerRadius - innerRadius), 0, 1);
  const t = linearT * linearT; // quadratic: e.g. half-distance -> 0.25 strength, quarter -> 0.0625...

  const angleToTarget = Math.atan2(dy, dx);
  const diff = angleDiff(self.sprite.rotation, angleToTarget);

  // Turn away: negate the angular difference direction
  // If target is to the left (diff < 0), turn right (+1), and vice versa
  const turnAway = diff >= 0 ? -1 : 1;
  const turn = turnAway * linearT; // keep turn on the steeper linear curve so it reacts early

  // Inside innerRadius, add a "back away" forward component so the actor
  // doesn't just spin in place but actually retreats. The forward vector
  // is computed from the repulsion direction (away from target).
  const awayAngle = Math.atan2(-dy, -dx);
  const awayDiff = angleDiff(self.sprite.rotation, awayAngle);
  // forward > 0 only when roughly facing away from the target
  const forwardEscape = dist < innerRadius ? clamp(1 - Math.abs(awayDiff) / Math.PI, 0, 1) * linearT : 0;

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
 * @param self          The moving actor
 * @param obstacles     Static AABB obstacles (center-based, from vision.ts)
 * @param worldWidth    Width of the world (for boundary walls)
 * @param worldHeight   Height of the world (for boundary walls)
 * @param avoidRadius   Distance at which avoidance begins (pixels)
 * @param weight        Maximum blending weight
 */
export function steerAvoidObstacles(
  self: Actor,
  obstacles: ReadonlyArray<Obstacle>,
  worldWidth: number,
  worldHeight: number,
  avoidRadius: number = 60,
  weight: number = 1.5
): Steering {
  const px = self.sprite.x;
  const py = self.sprite.y;

  let repX = 0;
  let repY = 0;

  // Helper: accumulate repulsion from the nearest point (nx, ny) on a shape
  const accumulate = (nx: number, ny: number) => {
    const dx = px - nx;
    const dy = py - ny;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= avoidRadius || dist < 1e-4) return;

    // Strength ramps linearly from 0 at avoidRadius to 1 at distance 0
    const strength = 1 - dist / avoidRadius;
    // Normalize direction, scale by strength
    repX += (dx / dist) * strength;
    repY += (dy / dist) * strength;
  };

  // -- AABB obstacles -------------------------------------------
  for (const obs of obstacles) {
    const halfW = obs.width / 2;
    const halfH = obs.height / 2;
    const { nx, ny } = nearestPointOnAABB(px, py, obs.x, obs.y, halfW, halfH);
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
  const repMag = Math.sqrt(repX * repX + repY * repY);
  if (repMag < 1e-4) {
    return { turn: 0, forward: 0, weight: 0, label: "steerAvoidObstacles" };
  }

  // Desired "away" angle from the repulsion vector
  const awayAngle = Math.atan2(repY, repX);
  const diff = angleDiff(self.sprite.rotation, awayAngle);

  // Turn toward the repulsion direction; stronger when not already facing it
  const turn = clamp(diff / (Math.PI / 2), -1, 1);

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
 */
export function steerForward(self: Actor, weight: number, speedMultiplier: number = 1): Steering {
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
 */
export function turnToward(self: Actor, targetPos: Vector2, weight: number, speedMultiplier: number = 1): Steering {
  const dx = targetPos.X - self.sprite.x;
  const dy = targetPos.Y - self.sprite.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 1e-4) {
    return { turn: 0, forward: 0, weight: 0, label: "turnToward" };
  }

  const angleToTarget = Math.atan2(dy, dx);
  const diff = angleDiff(self.sprite.rotation, angleToTarget);

  const turn = clamp(diff / (Math.PI / 2), -1, 1);

  return { turn, forward: 0, weight, speedMultiplier, label: "turnToward" };
}

/**
 * Generates a Steering contribution that rotates to face away from a target
 * position without producing any forward thrust. Useful for orienting an
 * escape direction before committing to movement.
 */
export function turnAwayFrom(self: Actor, targetPos: Vector2, weight: number, speedMultiplier: number = 1): Steering {
  const dx = targetPos.X - self.sprite.x;
  const dy = targetPos.Y - self.sprite.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 1e-4) {
    return { turn: 0, forward: 0, weight: 0, label: "turnAwayFrom" };
  }

  const awayAngle = Math.atan2(-dy, -dx);
  const diff = angleDiff(self.sprite.rotation, awayAngle);

  const turn = clamp(diff / (Math.PI / 2), -1, 1);

  return { turn, forward: 0, weight, speedMultiplier, label: "turnAwayFrom" };
}

/**
 * Generates a Steering contribution that rotates to face a specific world
 * angle (radians) without producing any forward thrust. Useful for compass
 * directions (north/south/east/west) or turning around (180 degrees).
 */
export function turnToAngle(self: Actor, targetAngle: number, weight: number, speedMultiplier: number = 1): Steering {
  const diff = angleDiff(self.sprite.rotation, targetAngle);

  const turn = clamp(diff / (Math.PI / 2), -1, 1);

  return { turn, forward: 0, weight, speedMultiplier, label: "turnToAngle" };
}

/**
 * Draw movement intent visualization showing the actor's intended movement direction
 * and force magnitude.
 *
 * @param graphics The graphics object to draw on (won't clear it)
 * @param actor The actor whose movement intent to visualize
 * @param intent The calculated movement intent (turn, throttle, speedMultiplier)
 * @param baseLength Base arrow length in pixels
 * @param color Arrow color (overridden when speedMultiplier != 1)
 * @param alpha Arrow opacity
 */
export function drawMovementIntent(
  graphics: Phaser.GameObjects.Graphics,
  actor: Actor,
  intent: { turn: number; throttle: number; speedMultiplier?: number },
  baseLength: number = 80,
  color: number = 0x00ff00,
  alpha: number = 0.8
): void {
  const ox = actor.sprite.x;
  const oy = actor.sprite.y;

  const speed = intent.speedMultiplier ?? 1;

  // Shift color when speedMultiplier deviates from 1:
  //   <1 -> lerp green toward red (slow)
  //   >1 -> lerp green toward cyan (fast)
  if (speed < 1) {
    const t = clamp(1 - speed, 0, 1); // 0 at speed=1, 1 at speed=0
    color = lerpColor(0x00ff00, 0xff4400, t);
  } else if (speed > 1) {
    const t = clamp((speed - 1) / 2, 0, 1); // 0 at speed=1, 1 at speed=3+
    color = lerpColor(0x00ff00, 0x00ffff, t);
  }

  // Calculate the intended direction based on current facing + turn
  // turn is -1 to +1, representing angular velocity, but for visualization
  // we'll show the current heading direction
  const currentHeading = actor.sprite.rotation;

  // Arrow length scaled by throttle and speedMultiplier
  const arrowLength = baseLength * intent.throttle * speed;

  if (arrowLength < 1) {
    // No significant movement intent
    return;
  }

  // Arrow endpoint
  const ex = ox + Math.cos(currentHeading) * arrowLength;
  const ey = oy + Math.sin(currentHeading) * arrowLength;

  // Draw main arrow shaft
  graphics.lineStyle(3, color, alpha);
  graphics.beginPath();
  graphics.moveTo(ox, oy);
  graphics.lineTo(ex, ey);
  graphics.strokePath();

  // Draw arrowhead
  const arrowHeadLength = 12;
  const arrowHeadAngle = Math.PI / 6; // 30 degrees

  const headAngle1 = currentHeading + Math.PI - arrowHeadAngle;
  const headAngle2 = currentHeading + Math.PI + arrowHeadAngle;

  const hx1 = ex + Math.cos(headAngle1) * arrowHeadLength;
  const hy1 = ey + Math.sin(headAngle1) * arrowHeadLength;
  const hx2 = ex + Math.cos(headAngle2) * arrowHeadLength;
  const hy2 = ey + Math.sin(headAngle2) * arrowHeadLength;

  graphics.fillStyle(color, alpha);
  graphics.beginPath();
  graphics.moveTo(ex, ey);
  graphics.lineTo(hx1, hy1);
  graphics.lineTo(hx2, hy2);
  graphics.closePath();
  graphics.fillPath();

  // Draw turn indicator (arc showing turn direction)
  if (Math.abs(intent.turn) > 0.05) {
    const turnRadius = 30;
    const turnArcLength = (Math.abs(intent.turn) * Math.PI) / 4; // Max 45 degrees
    const turnDirection = intent.turn > 0 ? 1 : -1;

    graphics.lineStyle(2, color, alpha * 0.6);
    graphics.beginPath();
    graphics.arc(ox, oy, turnRadius, currentHeading, currentHeading + turnArcLength * turnDirection, turnDirection < 0);
    graphics.strokePath();
  }
}
