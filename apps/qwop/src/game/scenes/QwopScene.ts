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

// Visual-only arm dimensions (no physics bodies)
const UPPER_ARM_H = 34;
const UPPER_ARM_W = 10;
const FOREARM_H = 30;
const FOREARM_W = 9;

// ---------------------------------------------------------------------------
// Motor / control constants
// ---------------------------------------------------------------------------

// Hip target angles (relative to torso). Negative = forward, positive = back.
const HIP_FORWARD = -0.8;
const HIP_BACKWARD = 0.5;

// Starting stance spread (biased forward so center of mass is over feet)
const HIP_INITIAL_FRONT = -0.3;
const HIP_INITIAL_BACK = 0.15;

const KNEE_FLEXED = 1.2;
const KNEE_EXTENDED = 0.0;

// How fast desired angles change when a key is held (radians/frame)
const HIP_SPEED = 0.04;
const KNEE_SPEED = 0.05;

// Torque motor: torque = GAIN * error - DAMPING * relativeAngVel, clamped
const HIP_TORQUE_GAIN = 0.8;
const HIP_TORQUE_DAMPING = 0.15;
const HIP_MAX_TORQUE = 0.5;
const KNEE_TORQUE_GAIN = 0.6;
const KNEE_TORQUE_DAMPING = 0.12;
const KNEE_MAX_TORQUE = 0.4;
const ANKLE_TORQUE_GAIN = 0.4;
const ANKLE_TORQUE_DAMPING = 0.08;
const ANKLE_MAX_TORQUE = 0.3;

// Hard angular limit for ankles (radians from calf axis)
const ANKLE_LIMIT = Math.PI / 6; // ~30 degrees

// Hard angular limits for knees (relative to thigh)
const KNEE_MIN = -0.05;
const KNEE_MAX = 2.5;

// Hard angular limits for hips (relative to torso)
// Real hips: ~120 deg flexion (forward), ~30 deg extension (backward)
const HIP_MIN = -2.0;
const HIP_MAX = 0.6;

// Global angular damping applied to every dynamic body each frame.
// Prevents runaway spin that plagued the old PD approach.
const ANG_DAMPING = 0.05;

// Constraint stiffness
const PIN_STIFFNESS = 1.0;

// Track / distance
const TRACK_MARK_SPACING = 100;
const PX_PER_METRE = 50;

// Fall detection
const FALL_ANGLE = 1.2;
const FALL_HEAD_Y = GROUND_Y - 30;

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
  // Physics bodies -- only torso + legs (7 bodies total)
  private torso!: MatterJS.BodyType;
  private leftThigh!: MatterJS.BodyType;
  private rightThigh!: MatterJS.BodyType;
  private leftCalf!: MatterJS.BodyType;
  private rightCalf!: MatterJS.BodyType;
  private leftFoot!: MatterJS.BodyType;
  private rightFoot!: MatterJS.BodyType;

  // Input
  private keyQ!: Phaser.Input.Keyboard.Key;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyO!: Phaser.Input.Keyboard.Key;
  private keyP!: Phaser.Input.Keyboard.Key;

  // Desired joint angles (persist across frames)
  private leftHipDesired = 0;
  private rightHipDesired = 0;
  private leftKneeDesired = 0;
  private rightKneeDesired = 0;

  // Tracking
  private startX = 0;
  private hasFallen = false;

  // Graphics layers
  private bgGfx!: Phaser.GameObjects.Graphics;
  private bodyGfx!: Phaser.GameObjects.Graphics;
  private fgGfx!: Phaser.GameObjects.Graphics;

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
      friction: 1.0,
      frictionStatic: 10,
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
      friction: 0.3,
      density: 0.003,
      frictionAir: 0.01,
      label: "torso",
    });

    // -- Left leg --
    const hipY = TORSO_H / 2;

    this.leftThigh = this.matter.add.rectangle(cx, cy + hipY + THIGH_H / 2, THIGH_W, THIGH_H, {
      friction: 0.4,
      density: 0.004,
      frictionAir: 0.01,
      label: "leftThigh",
    });
    this.matter.add.constraint(this.torso, this.leftThigh, 0, PIN_STIFFNESS, {
      pointA: { x: 0, y: hipY },
      pointB: { x: 0, y: -THIGH_H / 2 },
    });

    this.leftCalf = this.matter.add.rectangle(cx, cy + hipY + THIGH_H + CALF_H / 2, CALF_W, CALF_H, {
      friction: 0.4,
      density: 0.003,
      frictionAir: 0.01,
      label: "leftCalf",
    });
    this.matter.add.constraint(this.leftThigh, this.leftCalf, 0, PIN_STIFFNESS, {
      pointA: { x: 0, y: THIGH_H / 2 },
      pointB: { x: 0, y: -CALF_H / 2 },
    });

    // Foot anchor offset -- slight heel bias so ankle is rear of center
    const footAnchorX = -5;
    this.leftFoot = this.matter.add.rectangle(
      cx - footAnchorX,
      cy + hipY + THIGH_H + CALF_H + FOOT_H / 2,
      FOOT_W,
      FOOT_H,
      {
        friction: 1.0,
        frictionStatic: 10,
        frictionAir: 0.05,
        density: 0.002,
        label: "leftFoot",
      }
    );
    this.matter.add.constraint(this.leftCalf, this.leftFoot, 0, PIN_STIFFNESS, {
      pointA: { x: 0, y: CALF_H / 2 },
      pointB: { x: footAnchorX, y: -FOOT_H / 2 },
    });

    // -- Right leg --
    this.rightThigh = this.matter.add.rectangle(cx, cy + hipY + THIGH_H / 2, THIGH_W, THIGH_H, {
      friction: 0.4,
      density: 0.004,
      frictionAir: 0.01,
      label: "rightThigh",
    });
    this.matter.add.constraint(this.torso, this.rightThigh, 0, PIN_STIFFNESS, {
      pointA: { x: 0, y: hipY },
      pointB: { x: 0, y: -THIGH_H / 2 },
    });

    this.rightCalf = this.matter.add.rectangle(cx, cy + hipY + THIGH_H + CALF_H / 2, CALF_W, CALF_H, {
      friction: 0.4,
      density: 0.003,
      frictionAir: 0.01,
      label: "rightCalf",
    });
    this.matter.add.constraint(this.rightThigh, this.rightCalf, 0, PIN_STIFFNESS, {
      pointA: { x: 0, y: THIGH_H / 2 },
      pointB: { x: 0, y: -CALF_H / 2 },
    });

    this.rightFoot = this.matter.add.rectangle(
      cx - footAnchorX,
      cy + hipY + THIGH_H + CALF_H + FOOT_H / 2,
      FOOT_W,
      FOOT_H,
      {
        friction: 1.0,
        frictionStatic: 10,
        frictionAir: 0.05,
        density: 0.002,
        label: "rightFoot",
      }
    );
    this.matter.add.constraint(this.rightCalf, this.rightFoot, 0, PIN_STIFFNESS, {
      pointA: { x: 0, y: CALF_H / 2 },
      pointB: { x: footAnchorX, y: -FOOT_H / 2 },
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
    ];
    for (const part of allParts) {
      part.collisionFilter.group = runnerGroup;
    }
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

    this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE).on("down", () => {
      this.scene.restart();
    });
  }

  // ------------------------------------------------------------------
  // Update
  // ------------------------------------------------------------------

  update(): void {
    // Apply angular damping to all dynamic bodies to bleed energy
    this.applyAngularDamping();

    if (!this.hasFallen) {
      this.driveMotors();

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
    ];
    for (const b of bodies) {
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
    // Hard limit enforcement
    const relAngle = wrapAngle(child.angle - parent.angle);
    if (relAngle < minAngle) {
      this.matter.body.setAngle(child, parent.angle + minAngle);
      if (child.angularVelocity < parent.angularVelocity) {
        this.matter.body.setAngularVelocity(child, parent.angularVelocity);
      }
    } else if (relAngle > maxAngle) {
      this.matter.body.setAngle(child, parent.angle + maxAngle);
      if (child.angularVelocity > parent.angularVelocity) {
        this.matter.body.setAngularVelocity(child, parent.angularVelocity);
      }
    }

    // PD torque
    const currentRel = wrapAngle(child.angle - parent.angle);
    const error = wrapAngle(targetAngle - currentRel);
    const relVel = child.angularVelocity - parent.angularVelocity;
    const raw = gain * error - damping * relVel;
    const t = clamp(raw, -maxTorque, maxTorque);

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
    // Hard limit: clamp relative angle to [-ANKLE_LIMIT, +ANKLE_LIMIT]
    const relAngle = wrapAngle(foot.angle - calf.angle);
    if (Math.abs(relAngle) > ANKLE_LIMIT) {
      const clamped = clamp(relAngle, -ANKLE_LIMIT, ANKLE_LIMIT);
      this.matter.body.setAngle(foot, calf.angle + clamped);
      if (
        (relAngle > ANKLE_LIMIT && foot.angularVelocity > 0) ||
        (relAngle < -ANKLE_LIMIT && foot.angularVelocity < 0)
      ) {
        this.matter.body.setAngularVelocity(foot, calf.angularVelocity);
      }
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

    // Compute visual arm positions from hip angles (no physics bodies).
    // Arms counter-swing: left arm mirrors right hip, right mirrors left.
    // Negate hip angle so arms swing opposite to the corresponding leg
    // when the character faces right.
    const leftArmAngle = this.torso.angle - this.rightHipDesired;
    const rightArmAngle = this.torso.angle - this.leftHipDesired;
    const shoulderOffY = -TORSO_H / 2 + 2;
    const elbowBend = -Math.PI / 4;

    const armParts = this.computeArmParts(leftArmAngle, rightArmAngle, shoulderOffY, elbowBend);

    // -- Draw back-to-front --

    // Back arm
    this.drawLimb(g, armParts.rightUpper, UPPER_ARM_W, UPPER_ARM_H, skinShadow);
    this.drawLimb(g, armParts.rightFore, FOREARM_W, FOREARM_H, skinShadow);

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

    // Front arm
    this.drawLimb(g, armParts.leftUpper, UPPER_ARM_W, UPPER_ARM_H, skinColor);
    this.drawLimb(g, armParts.leftFore, FOREARM_W, FOREARM_H, skinColor);

    // Front leg
    drawRect(this.leftThigh, THIGH_W, THIGH_H, pantsColor);
    drawRect(this.leftCalf, CALF_W, CALF_H, skinColor);
    drawRect(this.leftFoot, FOOT_W, FOOT_H, shoeColor);
  }

  // ------------------------------------------------------------------
  // Visual arm computation (no physics)
  // ------------------------------------------------------------------

  private computeArmParts(
    leftAngle: number,
    rightAngle: number,
    shoulderOffY: number,
    elbowBend: number
  ): {
    leftUpper: { x: number; y: number; angle: number };
    leftFore: { x: number; y: number; angle: number };
    rightUpper: { x: number; y: number; angle: number };
    rightFore: { x: number; y: number; angle: number };
  } {
    const torsoA = this.torso.angle;
    const cosT = Math.cos(torsoA);
    const sinT = Math.sin(torsoA);

    // Shoulder world position (relative to torso center)
    const sx = this.torso.position.x + -sinT * shoulderOffY;
    const sy = this.torso.position.y + cosT * shoulderOffY;

    const computeSide = (angle: number) => {
      const sinA = Math.sin(angle);
      const cosA = Math.cos(angle);
      // Upper arm center (top of rect = shoulder)
      const ux = sx - sinA * (UPPER_ARM_H / 2);
      const uy = sy + cosA * (UPPER_ARM_H / 2);
      // Elbow position (bottom of upper arm rect)
      const ex = sx - sinA * UPPER_ARM_H;
      const ey = sy + cosA * UPPER_ARM_H;
      // Forearm angle
      const foreAngle = angle + elbowBend;
      const sinF = Math.sin(foreAngle);
      const cosF = Math.cos(foreAngle);
      const fx = ex - sinF * (FOREARM_H / 2);
      const fy = ey + cosF * (FOREARM_H / 2);
      return {
        upper: { x: ux, y: uy, angle },
        fore: { x: fx, y: fy, angle: foreAngle },
      };
    };

    const left = computeSide(leftAngle);
    const right = computeSide(rightAngle);

    return {
      leftUpper: left.upper,
      leftFore: left.fore,
      rightUpper: right.upper,
      rightFore: right.fore,
    };
  }

  private drawLimb(
    g: Phaser.GameObjects.Graphics,
    limb: { x: number; y: number; angle: number },
    w: number,
    h: number,
    color: number
  ): void {
    g.save();
    g.translateCanvas(limb.x, limb.y);
    g.rotateCanvas(limb.angle);
    g.fillStyle(color);
    g.fillRect(-w / 2, -h / 2, w, h);
    g.restore();
  }
}
