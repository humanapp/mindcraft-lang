import { Scene } from "phaser";
import { SCENE_READY_KEY } from "../main";

// ---------------------------------------------------------------------------
// Layout constants (pixels)
// ---------------------------------------------------------------------------

const GROUND_Y = 520;
const HEAD_R = 14;
const NECK_GAP = 10;

const TORSO_W = 26;
const TORSO_H = 56;
const TORSO_START_X = 200;
// Standing height: half-torso + thigh + calf + half-foot
const TORSO_START_Y = GROUND_Y - 4 - 48 - 50 - TORSO_H / 2;

const THIGH_W = 14;
const THIGH_H = 50;
const CALF_W = 12;
const CALF_H = 48;
const FOOT_W = 30;
const FOOT_H = 8;

// Arm dimensions (physics bodies)
const UPPER_ARM_H = 34;
const UPPER_ARM_W = 10;
const FOREARM_H = 30;
const FOREARM_W = 9;

// Shoulder offset from torso center (top of torso, slightly inward)
const SHOULDER_OFF_Y = -TORSO_H / 2 + 2;

// Arm motor -- very gentle so gravity and impacts dominate
const SHOULDER_TORQUE_GAIN = 0.03;
const SHOULDER_TORQUE_DAMPING = 0.02;
const SHOULDER_MAX_TORQUE = 0.02;
// Elbow has a light spring toward a slight bend
const ELBOW_TORQUE_GAIN = 0.015;
const ELBOW_TORQUE_DAMPING = 0.01;
const ELBOW_MAX_TORQUE = 0.01;
const ELBOW_REST_ANGLE = -0.4; // slight bend

// ---------------------------------------------------------------------------
// Motor / control constants
// ---------------------------------------------------------------------------

// Hip target angles (relative to torso). Negative = forward, positive = back.
const HIP_FORWARD = -0.8;
const HIP_BACKWARD = 0.5;

// Starting stance spread (narrower to reduce lateral forces at rest)
const HIP_INITIAL_FRONT = -0.08;
const HIP_INITIAL_BACK = 0.05;

const KNEE_FLEXED = 1.2;
const KNEE_EXTENDED = 0.0;

// How fast desired angles change when a key is held (radians/frame)
const HIP_SPEED = 0.04;
const KNEE_SPEED = 0.05;

// Torque motor: torque = GAIN * error - DAMPING * relativeAngVel, clamped.
// These values are deliberately low to avoid stretching pin constraints,
// which causes energy injection when the solver corrects them.
const HIP_TORQUE_GAIN = 0.5;
const HIP_TORQUE_DAMPING = 0.2;
const HIP_MAX_TORQUE = 0.3;
const KNEE_TORQUE_GAIN = 0.25;
const KNEE_TORQUE_DAMPING = 0.08;
const KNEE_MAX_TORQUE = 0.15;
const ANKLE_TORQUE_GAIN = 0.1;
const ANKLE_TORQUE_DAMPING = 0.05;
const ANKLE_MAX_TORQUE = 0.06;

// Hard angular limit for ankles (radians from calf axis)
const ANKLE_LIMIT = Math.PI / 6; // ~30 degrees

// Hard angular limits for knees (relative to thigh)
const KNEE_MIN = 0.05;
const KNEE_MAX = 2.5;

// Hard angular limits for hips (relative to torso)
// Real hips: ~120 deg flexion (forward), ~30 deg extension (backward)
const HIP_MIN = -2.0;
const HIP_MAX = 0.6;

// Angular damping factor applied AFTER the solver runs each step.
// Multiplied directly: angVel *= (1 - ANG_DAMPING). Applying this
// post-solve avoids the energy injection that pre-solve velocity
// mutation causes (solver correcting constraint violations).
const ANG_DAMPING = 0.05;

// Soft angular limit spring -- pushes joints back when they exceed
// their range. Must be low enough that the resulting forces do not
// stretch pin constraints, which would inject energy.
const LIMIT_SPRING_GAIN = 0.4;
const LIMIT_SPRING_DAMPING = 0.25;
const LIMIT_MAX_TORQUE = 0.15;

// Constraint stiffness and damping. Damping is critical -- without
// it (default 0), constraint corrections add velocity to fix position
// errors but nothing removes that velocity, causing overshoot and
// oscillation. This is the primary energy pump in pin-jointed chains.
const PIN_STIFFNESS = 0.9;
const PIN_DAMPING = 0.05;

// Track / distance
const TRACK_MARK_SPACING = 100;
const PX_PER_METRE = 50;

// Ground contact detection
const GROUND_CONTACT_Y = GROUND_Y - FOOT_H / 2 + 2;

// Ground friction: fraction of horizontal velocity removed per step
// for grounded feet. Works alongside the Matter.js Coulomb friction
// on the body to keep planted feet from sliding.
const GROUND_FRICTION = 1;

// Jump impulse applied to each grounded foot when SPACE is pressed.
// Applied as a velocity change (not force) for immediate effect.
const JUMP_VELOCITY = -6;
// Minimum frames between jumps
const JUMP_COOLDOWN = 20;

// Fall detection
const FALL_ANGLE = 1.5;
const FALL_HEAD_Y = GROUND_Y - 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapAngle(a: number): number {
  let v = a;
  while (v > Math.PI) v -= 2 * Math.PI;
  while (v < -Math.PI) v += 2 * Math.PI;
  return v;
}

function moveToward(current: number, target: number, step: number): number {
  if (current < target) return Math.min(current + step, target);
  if (current > target) return Math.max(current - step, target);
  return current;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export class QwopScene extends Scene {
  // Physics bodies -- torso + legs (7) + arms (4) = 11 bodies
  private torso!: MatterJS.BodyType;
  private leftThigh!: MatterJS.BodyType;
  private rightThigh!: MatterJS.BodyType;
  private leftCalf!: MatterJS.BodyType;
  private rightCalf!: MatterJS.BodyType;
  private leftFoot!: MatterJS.BodyType;
  private rightFoot!: MatterJS.BodyType;
  private leftUpperArm!: MatterJS.BodyType;
  private rightUpperArm!: MatterJS.BodyType;
  private leftForearm!: MatterJS.BodyType;
  private rightForearm!: MatterJS.BodyType;

  // Input
  private keyQ!: Phaser.Input.Keyboard.Key;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyO!: Phaser.Input.Keyboard.Key;
  private keyP!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;

  // Desired joint angles (persist across frames)
  private leftHipDesired = 0;
  private rightHipDesired = 0;
  private leftKneeDesired = 0;
  private rightKneeDesired = 0;

  // Jump cooldown counter
  private jumpCooldown = 0;

  // Tracking
  private startX = 0;
  private hasFallen = false;

  // Graphics layers
  private bgGfx!: Phaser.GameObjects.Graphics;
  private bodyGfx!: Phaser.GameObjects.Graphics;
  private fgGfx!: Phaser.GameObjects.Graphics;
  private debugGfx!: Phaser.GameObjects.Graphics;

  // Debug: last-applied torques for visualization
  private debugTorques: Map<string, number> = new Map();

  constructor() {
    super("QwopScene");
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  create(): void {
    this.events.emit("runner-reset");
    this.hasFallen = false;
    this.leftHipDesired = HIP_INITIAL_FRONT;
    this.rightHipDesired = HIP_INITIAL_BACK;
    this.leftKneeDesired = 0;
    this.rightKneeDesired = 0;

    this.bgGfx = this.add.graphics().setDepth(0);
    this.bodyGfx = this.add.graphics().setDepth(1);
    this.fgGfx = this.add.graphics().setDepth(2);
    this.debugGfx = this.add.graphics().setDepth(3);

    this.createGround();
    this.createRunner();
    this.setupKeys();

    this.startX = this.torso.position.x;

    this.cameras.main.setBounds(-100_000, 0, 200_000, 600);
    this.cameras.main.startFollow(
      { x: this.torso.position.x, y: 300 } as Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject,
      false,
      0.08,
      0
    );

    const cb = this.game.registry.get(SCENE_READY_KEY) as ((s: Phaser.Scene) => void) | undefined;
    if (cb) cb(this);

    // Restore debug mode if it was active before restart
    if (this.game.registry.get("__debugMode")) {
      this.matter.world.drawDebug = true;
      this.matter.world.createDebugGraphic();
    }

    // Post-solve pass: apply ground friction and angular damping
    // AFTER the constraint solver so velocity changes do not create
    // constraint violations that the solver has to correct.
    this.matter.world.on("afterupdate", this.postSolvePass, this);
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  toggleDebugMode(): void {
    const world = this.matter.world;
    world.drawDebug = !world.drawDebug;
    this.game.registry.set("__debugMode", world.drawDebug);
    if (world.drawDebug) {
      if (!world.debugGraphic) {
        world.createDebugGraphic();
      }
    } else {
      world.debugGraphic?.clear();
    }
  }

  // ------------------------------------------------------------------
  // Ground
  // ------------------------------------------------------------------

  private createGround(): void {
    this.matter.add.rectangle(0, GROUND_Y + 20, 200_000, 40, {
      isStatic: true,
      friction: 10,
      frictionStatic: 50,
      label: "ground",
    });
  }

  // ------------------------------------------------------------------
  // Runner creation
  // ------------------------------------------------------------------

  private createRunner(): void {
    const cx = TORSO_START_X;
    const cy = TORSO_START_Y;

    // -- Torso (simple rectangle, no compound body) --
    this.torso = this.matter.add.rectangle(cx, cy, TORSO_W, TORSO_H, {
      friction: 1.0,
      frictionStatic: 5,
      density: 0.003,
      frictionAir: 0.01,
      label: "torso",
    });

    // -- Left leg --
    const hipY = TORSO_H / 2;

    this.leftThigh = this.matter.add.rectangle(cx, cy + hipY + THIGH_H / 2, THIGH_W, THIGH_H, {
      friction: 1.0,
      frictionStatic: 5,
      density: 0.004,
      frictionAir: 0.01,
      label: "leftThigh",
    });
    this.matter.add.constraint(this.torso, this.leftThigh, 0, PIN_STIFFNESS, {
      pointA: { x: 0, y: hipY },
      pointB: { x: 0, y: -THIGH_H / 2 },
      damping: PIN_DAMPING,
    });

    this.leftCalf = this.matter.add.rectangle(cx, cy + hipY + THIGH_H + CALF_H / 2, CALF_W, CALF_H, {
      friction: 1.0,
      frictionStatic: 5,
      density: 0.003,
      frictionAir: 0.01,
      label: "leftCalf",
    });
    this.matter.add.constraint(this.leftThigh, this.leftCalf, 0, PIN_STIFFNESS, {
      pointA: { x: 0, y: THIGH_H / 2 },
      pointB: { x: 0, y: -CALF_H / 2 },
      damping: PIN_DAMPING,
    });

    // Foot anchor offset -- slight heel bias so ankle is rear of center
    const footAnchorX = -5;
    this.leftFoot = this.matter.add.rectangle(
      cx - footAnchorX,
      cy + hipY + THIGH_H + CALF_H + FOOT_H / 2,
      FOOT_W,
      FOOT_H,
      {
        friction: 10,
        frictionStatic: 50,
        frictionAir: 0.05,
        density: 0.002,
        label: "leftFoot",
      }
    );
    this.matter.add.constraint(this.leftCalf, this.leftFoot, 0, PIN_STIFFNESS, {
      pointA: { x: 0, y: CALF_H / 2 },
      pointB: { x: footAnchorX, y: -FOOT_H / 2 },
      damping: PIN_DAMPING,
    });

    // -- Right leg --
    this.rightThigh = this.matter.add.rectangle(cx, cy + hipY + THIGH_H / 2, THIGH_W, THIGH_H, {
      friction: 1.0,
      frictionStatic: 5,
      density: 0.004,
      frictionAir: 0.01,
      label: "rightThigh",
    });
    this.matter.add.constraint(this.torso, this.rightThigh, 0, PIN_STIFFNESS, {
      pointA: { x: 0, y: hipY },
      pointB: { x: 0, y: -THIGH_H / 2 },
      damping: PIN_DAMPING,
    });

    this.rightCalf = this.matter.add.rectangle(cx, cy + hipY + THIGH_H + CALF_H / 2, CALF_W, CALF_H, {
      friction: 1.0,
      frictionStatic: 5,
      density: 0.003,
      frictionAir: 0.01,
      label: "rightCalf",
    });
    this.matter.add.constraint(this.rightThigh, this.rightCalf, 0, PIN_STIFFNESS, {
      pointA: { x: 0, y: THIGH_H / 2 },
      pointB: { x: 0, y: -CALF_H / 2 },
      damping: PIN_DAMPING,
    });

    this.rightFoot = this.matter.add.rectangle(
      cx - footAnchorX,
      cy + hipY + THIGH_H + CALF_H + FOOT_H / 2,
      FOOT_W,
      FOOT_H,
      {
        friction: 10,
        frictionStatic: 50,
        frictionAir: 0.05,
        density: 0.002,
        label: "rightFoot",
      }
    );
    this.matter.add.constraint(this.rightCalf, this.rightFoot, 0, PIN_STIFFNESS, {
      pointA: { x: 0, y: CALF_H / 2 },
      pointB: { x: footAnchorX, y: -FOOT_H / 2 },
      damping: PIN_DAMPING,
    });

    // -- Spread legs into initial stance --
    const hipPivot = { x: cx, y: cy + hipY };
    this.rotateChainAroundPoint([this.leftThigh, this.leftCalf, this.leftFoot], hipPivot, HIP_INITIAL_FRONT);
    this.rotateChainAroundPoint([this.rightThigh, this.rightCalf, this.rightFoot], hipPivot, HIP_INITIAL_BACK);

    // Reset feet to flat (world angle 0) after the leg rotation
    this.matter.body.setAngle(this.leftFoot, 0);
    this.matter.body.setAngle(this.rightFoot, 0);

    // Slight forward lean so center of mass is over feet
    this.matter.body.setAngle(this.torso, -0.05);

    // -- Arms (physics-based ragdoll) --
    this.createArms(cx, cy);

    // -- Zero all velocities after initial positioning --
    // setPosition/setAngle calls above can leave residual velocities
    // that seed oscillation on the first solver step.
    const initBodies = [
      this.torso,
      this.leftThigh,
      this.rightThigh,
      this.leftCalf,
      this.rightCalf,
      this.leftFoot,
      this.rightFoot,
    ];
    for (const b of initBodies) {
      this.matter.body.setVelocity(b, { x: 0, y: 0 });
      this.matter.body.setAngularVelocity(b, 0);
    }

    // -- Collision filtering --
    const runnerGroup = this.matter.body.nextGroup(true);
    const allParts = [
      this.torso,
      this.leftThigh,
      this.rightThigh,
      this.leftCalf,
      this.rightCalf,
      this.leftFoot,
      this.rightFoot,
      this.leftUpperArm,
      this.rightUpperArm,
      this.leftForearm,
      this.rightForearm,
    ];
    for (const part of allParts) {
      part.collisionFilter.group = runnerGroup;
    }
  }

  // ------------------------------------------------------------------
  // Arm creation
  // ------------------------------------------------------------------

  private createArms(cx: number, cy: number): void {
    const cosT = Math.cos(this.torso.angle);
    const sinT = Math.sin(this.torso.angle);

    // Shoulder world position
    const sx = this.torso.position.x + -sinT * SHOULDER_OFF_Y;
    const sy = this.torso.position.y + cosT * SHOULDER_OFF_Y;

    const createArm = (side: "left" | "right") => {
      // Upper arm hangs straight down from shoulder
      const upperArm = this.matter.add.rectangle(sx, sy + UPPER_ARM_H / 2, UPPER_ARM_W, UPPER_ARM_H, {
        density: 0.0005,
        friction: 1.0,
        frictionStatic: 5,
        frictionAir: 0.04,
        label: `${side}UpperArm`,
      });

      // Pin shoulder to top of upper arm
      this.matter.add.constraint(this.torso, upperArm, 0, PIN_STIFFNESS, {
        pointA: { x: 0, y: SHOULDER_OFF_Y },
        pointB: { x: 0, y: -UPPER_ARM_H / 2 },
        damping: PIN_DAMPING,
      });

      // Forearm hangs from bottom of upper arm
      const forearm = this.matter.add.rectangle(sx, sy + UPPER_ARM_H + FOREARM_H / 2, FOREARM_W, FOREARM_H, {
        density: 0.0004,
        friction: 1.0,
        frictionStatic: 5,
        frictionAir: 0.04,
        label: `${side}Forearm`,
      });

      // Pin elbow
      this.matter.add.constraint(upperArm, forearm, 0, PIN_STIFFNESS, {
        pointA: { x: 0, y: UPPER_ARM_H / 2 },
        pointB: { x: 0, y: -FOREARM_H / 2 },
        damping: PIN_DAMPING,
      });

      return { upperArm, forearm };
    };

    const left = createArm("left");
    this.leftUpperArm = left.upperArm;
    this.leftForearm = left.forearm;

    const right = createArm("right");
    this.rightUpperArm = right.upperArm;
    this.rightForearm = right.forearm;
  }

  // ------------------------------------------------------------------
  // Input
  // ------------------------------------------------------------------

  private setupKeys(): void {
    if (!this.input.keyboard) return;
    this.keyQ = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyO = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.O);
    this.keyP = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P);
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R).on("down", () => {
      this.scene.restart();
    });
  }

  // ------------------------------------------------------------------
  // Update
  // ------------------------------------------------------------------

  update(): void {
    this.driveMotors();
    this.handleJump();

    if (!this.hasFallen) {
      // Fall detection -- torso tilted too far or head below ground level
      const torsoTilt = Math.abs(wrapAngle(this.torso.angle));
      const headY = this.headWorldPos().y;
      if (torsoTilt > FALL_ANGLE || headY > FALL_HEAD_Y) {
        this.hasFallen = true;
        this.events.emit("runner-fallen");
      }

      const distPx = this.torso.position.x - this.startX;
      this.events.emit("distance-update", distPx / PX_PER_METRE);
    }

    // Camera + rendering always run so ragdoll plays out after a fall
    (this.cameras.main as unknown as { _follow: { x: number; y: number } })._follow = {
      x: this.torso.position.x,
      y: 300,
    } as unknown as Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject;

    this.drawScene();

    // Debug overlay drawn after everything else
    if (this.matter.world.drawDebug) {
      this.drawDebugOverlay();
    } else {
      this.debugGfx.clear();
    }
  }

  // ------------------------------------------------------------------
  // Jump
  // ------------------------------------------------------------------

  private handleJump(): void {
    if (this.jumpCooldown > 0) {
      this.jumpCooldown--;
      return;
    }
    if (!(this.keySpace?.isDown ?? false)) return;

    const leftGrounded = this.isFootGrounded(this.leftFoot);
    const rightGrounded = this.isFootGrounded(this.rightFoot);
    if (!leftGrounded && !rightGrounded) return;

    // Apply upward velocity to all leg bodies and torso
    const jumpBodies = [
      this.torso,
      this.leftThigh,
      this.rightThigh,
      this.leftCalf,
      this.rightCalf,
      this.leftFoot,
      this.rightFoot,
    ];
    for (const b of jumpBodies) {
      this.matter.body.setVelocity(b, {
        x: b.velocity.x,
        y: JUMP_VELOCITY,
      });
    }

    this.jumpCooldown = JUMP_COOLDOWN;
  }

  // ------------------------------------------------------------------
  // Post-solve pass (runs after each physics step)
  // ------------------------------------------------------------------

  /**
   * Runs after the constraint solver has finished. Safe to modify
   * velocities here without causing constraint violation correction.
   */
  private postSolvePass(): void {
    this.applyGroundFriction();
    this.applyAngularDamping();
  }

  // ------------------------------------------------------------------
  // Ground friction
  // ------------------------------------------------------------------

  private applyGroundFriction(): void {
    // Apply friction to every body part that is touching the ground,
    // not just feet. This ensures friction works when the character
    // has fallen and is lying flat.
    const bodies = [
      this.torso,
      this.leftThigh,
      this.rightThigh,
      this.leftCalf,
      this.rightCalf,
      this.leftFoot,
      this.rightFoot,
      this.leftUpperArm,
      this.rightUpperArm,
      this.leftForearm,
      this.rightForearm,
    ];
    for (const body of bodies) {
      this.applyBodyGroundFriction(body);
    }
  }

  private applyBodyGroundFriction(body: MatterJS.BodyType): void {
    // Use the body's bounding box to check ground contact rather than
    // a hard-coded height offset. bounds.max.y is the lowest point of
    // the AABB regardless of rotation.
    if (body.bounds.max.y < GROUND_CONTACT_Y) return;
    const vx = body.velocity.x;
    if (Math.abs(vx) < 0.05) {
      this.matter.body.setVelocity(body, { x: 0, y: body.velocity.y });
      return;
    }
    this.matter.body.setVelocity(body, {
      x: vx * (1 - GROUND_FRICTION),
      y: body.velocity.y,
    });
  }

  // ------------------------------------------------------------------
  // Angular damping
  // ------------------------------------------------------------------

  private applyAngularDamping(): void {
    const bodies = [
      this.torso,
      this.leftThigh,
      this.rightThigh,
      this.leftCalf,
      this.rightCalf,
      this.leftFoot,
      this.rightFoot,
      this.leftUpperArm,
      this.rightUpperArm,
      this.leftForearm,
      this.rightForearm,
    ];
    for (const b of bodies) {
      // Direct velocity reduction applied post-solve. Because the
      // solver has already resolved constraints, this does not create
      // violations that inject energy on the next step.
      this.matter.body.setAngularVelocity(b, b.angularVelocity * (1 - ANG_DAMPING));
    }
  }

  // ------------------------------------------------------------------
  // Motor system -- velocity-based (no PD, no counter-torque)
  // ------------------------------------------------------------------

  private driveMotors(): void {
    const qDown = this.keyQ?.isDown ?? false;
    const wDown = this.keyW?.isDown ?? false;
    const oDown = this.keyO?.isDown ?? false;
    const pDown = this.keyP?.isDown ?? false;

    // Update desired hip angles
    if ((qDown || wDown) && !(qDown && wDown)) {
      const leftLimit = qDown ? HIP_FORWARD : HIP_BACKWARD;
      const rightLimit = qDown ? HIP_BACKWARD : HIP_FORWARD;
      this.leftHipDesired = moveToward(this.leftHipDesired, leftLimit, HIP_SPEED);
      this.rightHipDesired = moveToward(this.rightHipDesired, rightLimit, HIP_SPEED);
    }

    // Update desired knee angles
    if ((oDown || pDown) && !(oDown && pDown)) {
      const leftLimit = oDown ? KNEE_FLEXED : KNEE_EXTENDED;
      const rightLimit = oDown ? KNEE_EXTENDED : KNEE_FLEXED;
      this.leftKneeDesired = moveToward(this.leftKneeDesired, leftLimit, KNEE_SPEED);
      this.rightKneeDesired = moveToward(this.rightKneeDesired, rightLimit, KNEE_SPEED);
    }

    // Drive hips (with angle limits)
    this.torqueMotor(
      this.torso,
      this.leftThigh,
      this.leftHipDesired,
      HIP_TORQUE_GAIN,
      HIP_TORQUE_DAMPING,
      HIP_MAX_TORQUE,
      HIP_MIN,
      HIP_MAX
    );
    this.torqueMotor(
      this.torso,
      this.rightThigh,
      this.rightHipDesired,
      HIP_TORQUE_GAIN,
      HIP_TORQUE_DAMPING,
      HIP_MAX_TORQUE,
      HIP_MIN,
      HIP_MAX
    );

    // Drive knees (with angle limits -- no hyperextension)
    this.torqueMotor(
      this.leftThigh,
      this.leftCalf,
      this.leftKneeDesired,
      KNEE_TORQUE_GAIN,
      KNEE_TORQUE_DAMPING,
      KNEE_MAX_TORQUE,
      KNEE_MIN,
      KNEE_MAX
    );
    this.torqueMotor(
      this.rightThigh,
      this.rightCalf,
      this.rightKneeDesired,
      KNEE_TORQUE_GAIN,
      KNEE_TORQUE_DAMPING,
      KNEE_MAX_TORQUE,
      KNEE_MIN,
      KNEE_MAX
    );

    // Ankles -- torque-based with hard angle limits
    this.driveAnkle(this.leftCalf, this.leftFoot);
    this.driveAnkle(this.rightCalf, this.rightFoot);

    // Arms -- gentle counter-swing at shoulders, light elbow spring
    // Left arm mirrors right hip desired, right arm mirrors left hip
    this.torqueMotor(
      this.torso,
      this.leftUpperArm,
      -this.rightHipDesired,
      SHOULDER_TORQUE_GAIN,
      SHOULDER_TORQUE_DAMPING,
      SHOULDER_MAX_TORQUE,
      -2.5,
      2.5
    );
    this.torqueMotor(
      this.torso,
      this.rightUpperArm,
      -this.leftHipDesired,
      SHOULDER_TORQUE_GAIN,
      SHOULDER_TORQUE_DAMPING,
      SHOULDER_MAX_TORQUE,
      -2.5,
      2.5
    );

    // Elbows -- light spring toward a slight bend
    this.torqueMotor(
      this.leftUpperArm,
      this.leftForearm,
      ELBOW_REST_ANGLE,
      ELBOW_TORQUE_GAIN,
      ELBOW_TORQUE_DAMPING,
      ELBOW_MAX_TORQUE,
      -2.5,
      0.1
    );
    this.torqueMotor(
      this.rightUpperArm,
      this.rightForearm,
      ELBOW_REST_ANGLE,
      ELBOW_TORQUE_GAIN,
      ELBOW_TORQUE_DAMPING,
      ELBOW_MAX_TORQUE,
      -2.5,
      0.1
    );
  }

  /**
   * Torque-based angular motor. Applies real torque to both parent
   * and child bodies so forces transmit through constraints. This
   * keeps the torso supported by leg reaction forces.
   */
  private torqueMotor(
    parent: MatterJS.BodyType,
    child: MatterJS.BodyType,
    targetAngle: number,
    gain: number,
    damping: number,
    maxTorque: number,
    minAngle: number,
    maxAngle: number
  ): void {
    const currentRel = wrapAngle(child.angle - parent.angle);
    const relVel = child.angularVelocity - parent.angularVelocity;

    // Soft angular limits -- apply a restoring torque when outside
    // the allowed range, capped to prevent force explosions.
    let limitTorque = 0;
    if (currentRel < minAngle) {
      const penetration = minAngle - currentRel;
      const raw = LIMIT_SPRING_GAIN * penetration - LIMIT_SPRING_DAMPING * relVel;
      limitTorque = clamp(raw, -LIMIT_MAX_TORQUE, LIMIT_MAX_TORQUE);
    } else if (currentRel > maxAngle) {
      const penetration = maxAngle - currentRel;
      const raw = LIMIT_SPRING_GAIN * penetration - LIMIT_SPRING_DAMPING * relVel;
      limitTorque = clamp(raw, -LIMIT_MAX_TORQUE, LIMIT_MAX_TORQUE);
    }

    // PD torque toward desired angle (only within allowed range)
    const clampedTarget = clamp(targetAngle, minAngle, maxAngle);
    const error = wrapAngle(clampedTarget - currentRel);
    const raw = gain * error - damping * relVel;
    const motorTorque = clamp(raw, -maxTorque, maxTorque);

    const t = motorTorque + limitTorque;

    // Track for debug visualization
    this.debugTorques.set(child.label, t);

    // Apply equal and opposite torque -- reaction forces transmit
    // through the constraint, supporting the parent body
    child.torque += t;
    parent.torque -= t;
  }

  /**
   * Drive a body toward an absolute world angle using torque.
   */
  private absoluteAngleMotor(
    body: MatterJS.BodyType,
    targetWorldAngle: number,
    gain: number,
    damping: number,
    maxTorque: number
  ): void {
    const error = wrapAngle(targetWorldAngle - body.angle);
    const raw = gain * error - damping * body.angularVelocity;
    body.torque += clamp(raw, -maxTorque, maxTorque);
  }

  /**
   * Ankle motor with hard angular limits. Enforces that the foot
   * cannot rotate more than ANKLE_LIMIT radians relative to calf,
   * then drives toward flat (world angle 0).
   */
  private driveAnkle(calf: MatterJS.BodyType, foot: MatterJS.BodyType): void {
    // Soft angular limit via torque spring (capped to prevent explosion)
    const relAngle = wrapAngle(foot.angle - calf.angle);
    const relVel = foot.angularVelocity - calf.angularVelocity;
    if (relAngle > ANKLE_LIMIT) {
      const penetration = ANKLE_LIMIT - relAngle;
      const raw = LIMIT_SPRING_GAIN * penetration - LIMIT_SPRING_DAMPING * relVel;
      const t = clamp(raw, -LIMIT_MAX_TORQUE, LIMIT_MAX_TORQUE);
      foot.torque += t;
      calf.torque -= t;
    } else if (relAngle < -ANKLE_LIMIT) {
      const penetration = -ANKLE_LIMIT - relAngle;
      const raw = LIMIT_SPRING_GAIN * penetration - LIMIT_SPRING_DAMPING * relVel;
      const t = clamp(raw, -LIMIT_MAX_TORQUE, LIMIT_MAX_TORQUE);
      foot.torque += t;
      calf.torque -= t;
    }
    // Drive toward flat using torque
    this.absoluteAngleMotor(foot, 0, ANKLE_TORQUE_GAIN, ANKLE_TORQUE_DAMPING, ANKLE_MAX_TORQUE);
  }

  // ------------------------------------------------------------------
  // Geometry helpers
  // ------------------------------------------------------------------

  private rotateChainAroundPoint(bodies: MatterJS.BodyType[], pivot: { x: number; y: number }, angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const body of bodies) {
      const dx = body.position.x - pivot.x;
      const dy = body.position.y - pivot.y;
      this.matter.body.setPosition(body, {
        x: pivot.x + dx * cos - dy * sin,
        y: pivot.y + dx * sin + dy * cos,
      });
      this.matter.body.setAngle(body, body.angle + angle);
    }
  }

  /** World-space position of the head center (visual only). */
  private headWorldPos(): { x: number; y: number } {
    const a = this.torso.angle;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const offY = -(TORSO_H / 2 + NECK_GAP + HEAD_R);
    return {
      x: this.torso.position.x - sin * offY,
      y: this.torso.position.y + cos * offY,
    };
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  private drawScene(): void {
    const cam = this.cameras.main;
    const left = cam.scrollX;
    const right = left + cam.width;

    this.drawBackground(left, right);
    this.drawRunner();
    this.drawTrackMarks(left, right);
  }

  private drawBackground(left: number, right: number): void {
    const g = this.bgGfx;
    g.clear();

    const skyTop = 0x87ceeb;
    const skyBottom = 0xc9e8f5;
    const bandH = 10;
    for (let y = 0; y < GROUND_Y; y += bandH) {
      const t = y / GROUND_Y;
      const r = ((skyTop >> 16) & 0xff) + (((skyBottom >> 16) & 0xff) - ((skyTop >> 16) & 0xff)) * t;
      const gr = ((skyTop >> 8) & 0xff) + (((skyBottom >> 8) & 0xff) - ((skyTop >> 8) & 0xff)) * t;
      const b = (skyTop & 0xff) + ((skyBottom & 0xff) - (skyTop & 0xff)) * t;
      const color = (Math.round(r) << 16) | (Math.round(gr) << 8) | Math.round(b);
      g.fillStyle(color);
      g.fillRect(left - 10, y, right - left + 20, bandH);
    }

    g.fillStyle(0xcc7744);
    g.fillRect(left - 10, GROUND_Y, right - left + 20, 600 - GROUND_Y);

    g.lineStyle(2, 0xffffff, 0.5);
    g.lineBetween(left - 10, GROUND_Y, right + 10, GROUND_Y);
  }

  private drawTrackMarks(left: number, right: number): void {
    const g = this.fgGfx;
    g.clear();

    const startMark = Math.floor((left - this.startX) / PX_PER_METRE / (TRACK_MARK_SPACING / PX_PER_METRE)) - 1;
    const endMark = Math.ceil((right - this.startX) / PX_PER_METRE / (TRACK_MARK_SPACING / PX_PER_METRE)) + 1;

    for (let i = startMark; i <= endMark; i++) {
      const markMetres = i * (TRACK_MARK_SPACING / PX_PER_METRE);
      const markX = this.startX + markMetres * PX_PER_METRE;

      if (markX < left - 50 || markX > right + 50) continue;

      g.lineStyle(2, 0xffffff, 0.6);
      g.lineBetween(markX, GROUND_Y, markX, GROUND_Y + 12);

      const label = `${Math.round(markMetres)}m`;
      const text = this.add.text(markX, GROUND_Y + 16, label, {
        fontSize: "12px",
        color: "#ffffff",
        fontFamily: "Courier New",
      });
      text.setOrigin(0.5, 0);
      this.time.delayedCall(20, () => text.destroy());
    }
  }

  private drawRunner(): void {
    const g = this.bodyGfx;
    g.clear();

    const skinColor = 0xf5c6a0;
    const skinShadow = 0xd4a87c;
    const shirtColor = 0x2255aa;
    const pantsColor = 0x333355;
    const shoeColor = 0x444444;
    const headOutline = 0xd4a574;

    const drawRect = (body: MatterJS.BodyType, w: number, h: number, color: number) => {
      g.save();
      g.translateCanvas(body.position.x, body.position.y);
      g.rotateCanvas(body.angle);
      g.fillStyle(color);
      g.fillRect(-w / 2, -h / 2, w, h);
      g.restore();
    };

    // -- Draw back-to-front --

    // Back arm (physics bodies)
    drawRect(this.rightUpperArm, UPPER_ARM_W, UPPER_ARM_H, skinShadow);
    drawRect(this.rightForearm, FOREARM_W, FOREARM_H, skinShadow);

    // Back leg
    drawRect(this.rightThigh, THIGH_W, THIGH_H, pantsColor);
    drawRect(this.rightCalf, CALF_W, CALF_H, skinShadow);
    drawRect(this.rightFoot, FOOT_W, FOOT_H, shoeColor);

    // Torso
    drawRect(this.torso, TORSO_W, TORSO_H, shirtColor);

    // Head (visual only -- positioned relative to torso)
    const head = this.headWorldPos();
    g.save();
    g.translateCanvas(head.x, head.y);
    g.rotateCanvas(this.torso.angle);
    g.fillStyle(skinColor);
    g.fillCircle(0, 0, HEAD_R);
    g.lineStyle(2, headOutline);
    g.strokeCircle(0, 0, HEAD_R);
    g.restore();

    // Front leg
    drawRect(this.leftThigh, THIGH_W, THIGH_H, pantsColor);
    drawRect(this.leftCalf, CALF_W, CALF_H, skinColor);
    drawRect(this.leftFoot, FOOT_W, FOOT_H, shoeColor);

    // Front arm (physics bodies) -- drawn last so it's in front of legs
    drawRect(this.leftUpperArm, UPPER_ARM_W, UPPER_ARM_H, skinColor);
    drawRect(this.leftForearm, FOREARM_W, FOREARM_H, skinColor);
  }

  // ------------------------------------------------------------------
  // Debug overlay
  // ------------------------------------------------------------------

  private isFootGrounded(foot: MatterJS.BodyType): boolean {
    return foot.position.y + FOOT_H / 2 >= GROUND_CONTACT_Y;
  }

  private drawDebugOverlay(): void {
    const g = this.debugGfx;
    g.clear();

    // Clear torque map at start of debug draw (will be repopulated next frame)
    const torques = new Map(this.debugTorques);
    this.debugTorques.clear();

    const allBodies: Array<{ body: MatterJS.BodyType; label: string }> = [
      { body: this.torso, label: "torso" },
      { body: this.leftThigh, label: "L.hip" },
      { body: this.rightThigh, label: "R.hip" },
      { body: this.leftCalf, label: "L.knee" },
      { body: this.rightCalf, label: "R.knee" },
      { body: this.leftFoot, label: "L.foot" },
      { body: this.rightFoot, label: "R.foot" },
    ];

    // -- Velocity vectors (green arrows) --
    for (const { body } of allBodies) {
      this.drawVelocityArrow(g, body);
    }

    // -- Torque arcs on joints --
    this.drawTorqueArc(g, this.torso, this.leftThigh, torques.get("leftThigh") ?? 0, 0x00ffff);
    this.drawTorqueArc(g, this.torso, this.rightThigh, torques.get("rightThigh") ?? 0, 0xff00ff);
    this.drawTorqueArc(g, this.leftThigh, this.leftCalf, torques.get("leftCalf") ?? 0, 0x00ffff);
    this.drawTorqueArc(g, this.rightThigh, this.rightCalf, torques.get("rightCalf") ?? 0, 0xff00ff);

    // -- Ground contact indicators --
    this.drawGroundContact(g, this.leftFoot);
    this.drawGroundContact(g, this.rightFoot);

    // -- Center of mass --
    this.drawCenterOfMass(g);
  }

  /** Draw a velocity arrow from body center. */
  private drawVelocityArrow(g: Phaser.GameObjects.Graphics, body: MatterJS.BodyType): void {
    const vx = body.velocity.x;
    const vy = body.velocity.y;
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed < 0.1) return;

    const scale = 15; // pixels per unit velocity
    const ex = body.position.x + vx * scale;
    const ey = body.position.y + vy * scale;

    // Color: green when slow, yellow when moderate, red when fast
    const t = clamp(speed / 8, 0, 1);
    const r = Math.round(t * 255);
    const gr = Math.round((1 - t) * 255);
    const color = (r << 16) | (gr << 8) | 0;

    g.lineStyle(2, color, 0.8);
    g.lineBetween(body.position.x, body.position.y, ex, ey);

    // Arrowhead
    const angle = Math.atan2(vy, vx);
    const headLen = 5;
    g.lineBetween(ex, ey, ex - headLen * Math.cos(angle - 0.4), ey - headLen * Math.sin(angle - 0.4));
    g.lineBetween(ex, ey, ex - headLen * Math.cos(angle + 0.4), ey - headLen * Math.sin(angle + 0.4));
  }

  /** Draw a torque arc at the joint between parent and child. */
  private drawTorqueArc(
    g: Phaser.GameObjects.Graphics,
    parent: MatterJS.BodyType,
    child: MatterJS.BodyType,
    torque: number,
    color: number
  ): void {
    if (Math.abs(torque) < 0.001) return;

    // Joint is at the top of the child body
    const jx = (parent.position.x + child.position.x) / 2;
    const jy = (parent.position.y + child.position.y) / 2;

    const radius = 12;
    // Arc sweep proportional to torque magnitude (max ~180 degrees)
    const sweep = clamp(Math.abs(torque) * 400, 0.1, Math.PI);
    const startAngle = child.angle - sweep / 2;

    g.lineStyle(3, color, 0.7);
    g.beginPath();
    g.arc(jx, jy, radius, startAngle, startAngle + sweep, false);
    g.strokePath();

    // Arrow tip to show direction
    const tipAngle = torque > 0 ? startAngle + sweep : startAngle;
    const tipDir = torque > 0 ? 1 : -1;
    const tx = jx + radius * Math.cos(tipAngle);
    const ty = jy + radius * Math.sin(tipAngle);
    const perpAngle = tipAngle + (tipDir * Math.PI) / 2;
    g.lineBetween(tx, ty, tx + 4 * Math.cos(perpAngle - 0.5), ty + 4 * Math.sin(perpAngle - 0.5));
  }

  /** Draw ground contact indicator under a foot. */
  private drawGroundContact(g: Phaser.GameObjects.Graphics, foot: MatterJS.BodyType): void {
    const grounded = this.isFootGrounded(foot);
    const fx = foot.position.x;
    const fy = foot.position.y + FOOT_H / 2 + 4;

    // Green dot if grounded, red if airborne
    g.fillStyle(grounded ? 0x00ff00 : 0xff4444, 0.9);
    g.fillCircle(fx, fy, 4);

    // Pinned indicator: horizontal bar if foot is being pinned
    if (grounded) {
      g.lineStyle(2, 0x00ff00, 0.6);
      g.lineBetween(fx - 10, fy + 4, fx + 10, fy + 4);
    }
  }

  /** Draw center of mass marker (yellow cross). */
  private drawCenterOfMass(g: Phaser.GameObjects.Graphics): void {
    const bodies = [
      this.torso,
      this.leftThigh,
      this.rightThigh,
      this.leftCalf,
      this.rightCalf,
      this.leftFoot,
      this.rightFoot,
    ];
    let totalMass = 0;
    let comX = 0;
    let comY = 0;
    for (const b of bodies) {
      totalMass += b.mass;
      comX += b.position.x * b.mass;
      comY += b.position.y * b.mass;
    }
    comX /= totalMass;
    comY /= totalMass;

    const size = 8;
    g.lineStyle(2, 0xffff00, 0.9);
    g.lineBetween(comX - size, comY, comX + size, comY);
    g.lineBetween(comX, comY - size, comX, comY + size);

    // Vertical line down to ground to show balance
    g.lineStyle(1, 0xffff00, 0.3);
    g.lineBetween(comX, comY, comX, GROUND_Y);

    // Support polygon: horizontal span between grounded feet
    const leftGrounded = this.isFootGrounded(this.leftFoot);
    const rightGrounded = this.isFootGrounded(this.rightFoot);
    if (leftGrounded || rightGrounded) {
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      if (leftGrounded) {
        minX = Math.min(minX, this.leftFoot.position.x - FOOT_W / 2);
        maxX = Math.max(maxX, this.leftFoot.position.x + FOOT_W / 2);
      }
      if (rightGrounded) {
        minX = Math.min(minX, this.rightFoot.position.x - FOOT_W / 2);
        maxX = Math.max(maxX, this.rightFoot.position.x + FOOT_W / 2);
      }

      // Support base bar
      const balanced = comX >= minX && comX <= maxX;
      g.lineStyle(3, balanced ? 0x00ff00 : 0xff0000, 0.5);
      g.lineBetween(minX, GROUND_Y + 2, maxX, GROUND_Y + 2);
    }
  }
}
