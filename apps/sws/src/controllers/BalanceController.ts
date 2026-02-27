// controllers/BalanceController.ts
//
// Physical standing balance controller using:
//
// 1. Rapier built-in motors at ALL joints (hinge AND spherical).
//    The constraint solver provides implicit integration, bidirectional
//    torques (Newton's 3rd law), and natural force transmission through
//    the kinematic chain. No external torque impulses needed.
//
// 2. Ankle strategy (inverted pendulum) for whole-body balance.
//    The ankle hinge motor is the primary balance actuator, setting
//    target angle proportional to COM-over-support error.
//
// 3. Fallen-state detection to prevent ground spasming.
//
// No world-frame torques. No external torque impulses. All forces go
// through Rapier's constraint-solver motors.

import type { Vec3 } from "@/lib/math";
import {
  clamp,
  cross,
  dot,
  expSmoothingAlpha,
  horiz,
  len,
  q,
  qFromAxisAngle,
  qInverse,
  qMul,
  qRotateVec3,
  smoothVec3,
  sub,
  v3,
} from "@/lib/math";
import type { RigIO } from "@/rig/RigIO";

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

export const BALANCE_DEFAULTS = {
  // Filter time constant for COM/support signals (seconds).
  filterTau: 0.04,

  // Tilt angle (radians) above which the controller enters fallen state.
  fallenTiltRad: 0.75, // ~43 degrees

  // Tilt angle (radians) below which the controller exits fallen state.
  recoverTiltRad: 0.25, // ~14 degrees -- hysteresis band

  // Ankle balance gains (primary actuator)
  ankleP: 8.0,
  ankleD: 2.5,
  ankleMaxRad: 0.25,

  // Torso lean gains (hip strategy -- leans torso opposite to COM error)
  torsoLeanP: 3.0,
  torsoLeanD: 1.0,
  torsoLeanMaxRad: 0.35, // ~20 degrees max lean

  // Joint drive gains
  //
  // All joints (hinge and spherical) now use Rapier's built-in motor,
  // which is solved inside the constraint solver. The gains here are
  // passed through to the motor (scaled 10x for Rapier units). The
  // motor handles Newton's 3rd law and fights gravity directly.
  standingTorso: { kp: 40, kd: 12, max: 120 },
  standingHip: { kp: 40, kd: 12, max: 120 },
  standingKnee: { kp: 80, kd: 14, max: 250 },
  standingAnkle: { kp: 25, kd: 10, max: 80 },
  standingHead: { kp: 20, kd: 6, max: 40 },
  standingArm: { kp: 15, kd: 5, max: 30 },

  fallenTorso: { kp: 3, kd: 4, max: 10 },
  fallenHip: { kp: 3, kd: 4, max: 10 },
  fallenKnee: { kp: 5, kd: 4, max: 15 },
  fallenAnkle: { kp: 2, kd: 3, max: 5 },
  fallenHead: { kp: 2, kd: 3, max: 5 },
  fallenArm: { kp: 1, kd: 2, max: 3 },

  defaultKneeBend: 0.12,
} as const;

// ---------------------------------------------------------------------------
// Debug output
// ---------------------------------------------------------------------------

export interface BalanceDebug {
  support: Vec3;
  comProj: Vec3;
  errorRaw: Vec3;
  errorFiltered: Vec3;
  errorMag: number;
  leftGrounded: boolean;
  rightGrounded: boolean;
  tiltRad: number;
  fallen: boolean;
  // The direction the torso lean PD is targeting (unit vector in world space).
  // Represents the "ideal up" for the torso including any external bias.
  torsoLeanDir: Vec3;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

// Widen literal types from `as const` to mutable number/object types.
type Widen<T> = T extends number
  ? number
  : T extends { readonly [k: string]: unknown }
    ? { -readonly [K in keyof T]: Widen<T[K]> }
    : T;

export type BalanceConfig = { [K in keyof typeof BALANCE_DEFAULTS]: Widen<(typeof BALANCE_DEFAULTS)[K]> };

export class BalanceController {
  private cfg: BalanceConfig;

  private filteredSupport: Vec3 = v3(0, 0, 0);
  private filteredCom: Vec3 = v3(0, 0, 0);
  private initialized = false;
  private fallen = false;

  // External bias applied to torso lean target (pitch, roll in radians).
  // Set by CatchStepController to lean INTO the step direction during
  // and briefly after a step, preventing backward fall after forward steps.
  torsoBiasPitch = 0;
  torsoBiasRoll = 0;

  // Attenuation factor (0..1) for the error-based PD lean.
  // During stepping, the step IS the recovery mechanism, so the PD lean
  // fighting the error is counterproductive. CatchStepController sets
  // this to a low value during stepping to suppress the error-based lean.
  torsoLeanScale = 1.0;

  // Yaw bias (radians around +Y). Set by CatchStepController for
  // upper-body counter-rotation: rotating the torso opposite to the
  // fall direction generates a reaction torque on the root.
  torsoYawBias = 0;

  // Arm extension targets. Set by CatchStepController for asymmetric
  // arm balance during stepping: fall-side arm extends outward/upward,
  // opposite arm tucks. Expressed as {pitch, roll} in radians.
  // When null, BalanceController drives arms to rest pose as usual.
  leftArmTarget: { pitch: number; roll: number } | null = null;
  rightArmTarget: { pitch: number; roll: number } | null = null;
  armGainsOverride: { kp: number; kd: number; max: number } | null = null;

  private _debug: BalanceDebug | null = null;
  private frameCount = 0;

  get debug(): BalanceDebug | null {
    return this._debug;
  }

  constructor(cfg?: Partial<BalanceConfig>) {
    this.cfg = { ...BALANCE_DEFAULTS, ...cfg };
  }

  /** Merge partial overrides into the live config. */
  updateConfig(overrides: Partial<BalanceConfig>): void {
    Object.assign(this.cfg, overrides);
  }

  update(io: RigIO, dt: number): void {
    // ------------------------------------------------------------------
    // A) Measure root tilt
    // ------------------------------------------------------------------
    const rootSample = io.sampleBody("Root");
    const localUp = qRotateVec3(rootSample.rot, v3(0, 1, 0));
    const worldUp = v3(0, 1, 0);

    const tiltCross = cross(localUp, worldUp);
    const sinAngle = len(tiltCross);
    const cosAngle = clamp(dot(localUp, worldUp), -1, 1);
    const tiltRad = Math.atan2(sinAngle, cosAngle);

    // ------------------------------------------------------------------
    // B) Fallen state with hysteresis
    // ------------------------------------------------------------------
    if (!this.fallen && tiltRad > this.cfg.fallenTiltRad) {
      this.fallen = true;
    } else if (this.fallen && tiltRad < this.cfg.recoverTiltRad) {
      this.fallen = false;
    }

    const g = this.cfg;
    const standing = !this.fallen;

    // ------------------------------------------------------------------
    // C) Foot contact + COM
    // ------------------------------------------------------------------
    const leftFC = io.footContact("LeftFoot");
    const rightFC = io.footContact("RightFoot");
    const anyGrounded = leftFC.grounded || rightFC.grounded;

    let support: Vec3;
    if (leftFC.grounded && rightFC.grounded && leftFC.avgPoint && rightFC.avgPoint) {
      support = horiz(
        v3((leftFC.avgPoint.x + rightFC.avgPoint.x) * 0.5, 0, (leftFC.avgPoint.z + rightFC.avgPoint.z) * 0.5)
      );
    } else if (leftFC.grounded && leftFC.avgPoint) {
      support = horiz(leftFC.avgPoint);
    } else if (rightFC.grounded && rightFC.avgPoint) {
      support = horiz(rightFC.avgPoint);
    } else {
      support = horiz(rootSample.pos);
    }

    const comWorld = io.comWorld();
    const comProj = horiz(comWorld);
    const comVel = io.comVelWorld();

    // ------------------------------------------------------------------
    // D) Filter & error
    // ------------------------------------------------------------------
    const alpha = expSmoothingAlpha(dt, g.filterTau);
    if (!this.initialized) {
      this.filteredSupport = support;
      this.filteredCom = comProj;
      this.initialized = true;
    } else {
      this.filteredSupport = smoothVec3(this.filteredSupport, support, alpha);
      this.filteredCom = smoothVec3(this.filteredCom, comProj, alpha);
    }

    const errorRaw = sub(comProj, support);
    const errorFiltered = sub(this.filteredCom, this.filteredSupport);
    const errorMag = len(errorFiltered);

    // Transform world-space error and velocity into root-local frame so
    // that ankle pitch and torso lean PD operate on the correct axes
    // regardless of the rig's yaw orientation. Without this, the ankle
    // drives lateral balance when the rig faces +/-90 degrees.
    const rootInv = qInverse(rootSample.rot);
    const errLocal = qRotateVec3(rootInv, errorFiltered);
    const velLocal = qRotateVec3(rootInv, v3(comVel.x, 0, comVel.z));

    // ------------------------------------------------------------------
    // E) Joint drives (Rapier built-in motors)
    //
    // All joints (hinge and spherical) use Rapier's constraint-solver
    // motors. These are bidirectional (Newton's 3rd law), implicitly
    // integrated (high effective stiffness), and transmit forces
    // through the kinematic chain to the ground.
    // ------------------------------------------------------------------
    const rest = q(0, 0, 0, 1);

    // Torso: lean opposite to COM error (hip strategy).
    // When the COM drifts ahead (+Z error), pitch the torso backward
    // (-X rotation) to shift mass back. Similarly for lateral error.
    // Falls back to rest pose when fallen or airborne.
    let torsoTarget = rest;
    let torsoPitchActual = 0;
    let torsoRollActual = 0;
    if (anyGrounded && !this.fallen) {
      torsoPitchActual = clamp(
        (-g.torsoLeanP * errLocal.z - g.torsoLeanD * velLocal.z) * this.torsoLeanScale + this.torsoBiasPitch,
        -g.torsoLeanMaxRad,
        g.torsoLeanMaxRad
      );
      torsoRollActual = clamp(
        (-g.torsoLeanP * errLocal.x - g.torsoLeanD * velLocal.x) * this.torsoLeanScale + this.torsoBiasRoll,
        -g.torsoLeanMaxRad,
        g.torsoLeanMaxRad
      );
      torsoTarget = qMul(
        qMul(qFromAxisAngle(v3(1, 0, 0), torsoPitchActual), qFromAxisAngle(v3(0, 0, 1), torsoRollActual)),
        qFromAxisAngle(v3(0, 1, 0), this.torsoYawBias)
      );
    }
    const torsoG = standing ? g.standingTorso : g.fallenTorso;
    io.driveJoint("Root_Torso", {
      targetLocalRot: torsoTarget,
      kp: torsoG.kp,
      kd: torsoG.kd,
      maxTorque: torsoG.max,
    });

    // Head: rest pose hold (low gains -- light part, should not destabilize)
    const headG = standing ? g.standingHead : g.fallenHead;
    io.driveJoint("Torso_Head", {
      targetLocalRot: rest,
      kp: headG.kp,
      kd: headG.kd,
      maxTorque: headG.max,
    });

    // Arms: use external targets when set (CatchStepController arm extension),
    // otherwise rest pose hold. Arm targets are pitch (around +X) and roll
    // (around +Z) in torso-local space.
    const leftArmRot = this.leftArmTarget
      ? qMul(
          qFromAxisAngle(v3(1, 0, 0), this.leftArmTarget.pitch),
          qFromAxisAngle(v3(0, 0, 1), this.leftArmTarget.roll)
        )
      : rest;
    const rightArmRot = this.rightArmTarget
      ? qMul(
          qFromAxisAngle(v3(1, 0, 0), this.rightArmTarget.pitch),
          qFromAxisAngle(v3(0, 0, 1), this.rightArmTarget.roll)
        )
      : rest;
    const armG = this.armGainsOverride ?? (standing ? g.standingArm : g.fallenArm);
    io.driveJoint("Torso_LeftArm", {
      targetLocalRot: leftArmRot,
      kp: armG.kp,
      kd: armG.kd,
      maxTorque: armG.max,
    });
    io.driveJoint("Torso_RightArm", {
      targetLocalRot: rightArmRot,
      kp: armG.kp,
      kd: armG.kd,
      maxTorque: armG.max,
    });

    // Hips: rest pose hold
    const hipG = standing ? g.standingHip : g.fallenHip;
    io.driveJoint("Root_LeftUpperLeg", {
      targetLocalRot: rest,
      kp: hipG.kp,
      kd: hipG.kd,
      maxTorque: hipG.max,
    });
    io.driveJoint("Root_RightUpperLeg", {
      targetLocalRot: rest,
      kp: hipG.kp,
      kd: hipG.kd,
      maxTorque: hipG.max,
    });

    // Knees: slight compliance bend
    const kneeG = standing ? g.standingKnee : g.fallenKnee;
    const kneeTarget = qFromAxisAngle(v3(1, 0, 0), g.defaultKneeBend);
    io.driveJoint("LeftUpperLeg_LeftLowerLeg", {
      targetLocalRot: kneeTarget,
      kp: kneeG.kp,
      kd: kneeG.kd,
      maxTorque: kneeG.max,
    });
    io.driveJoint("RightUpperLeg_RightLowerLeg", {
      targetLocalRot: kneeTarget,
      kp: kneeG.kp,
      kd: kneeG.kd,
      maxTorque: kneeG.max,
    });

    // ------------------------------------------------------------------
    // F) Ankle: primary balance actuator (inverted pendulum)
    // ------------------------------------------------------------------
    // Ankle target: positive errZ (COM ahead) -> plantarflex (positive
    // target) -> motor reaction pushes shin backward -> body backward.
    // Negative errZ (COM behind) -> dorsiflex (negative target) -> motor
    // reaction pushes shin forward -> body forward. This matches the
    // standard inverted-pendulum ankle strategy.
    const anklePitchRad =
      anyGrounded && !this.fallen
        ? clamp(g.ankleP * errLocal.z + g.ankleD * velLocal.z, -g.ankleMaxRad, g.ankleMaxRad)
        : 0;

    const ankleTarget = qFromAxisAngle(v3(1, 0, 0), anklePitchRad);

    const ankleG = standing ? g.standingAnkle : g.fallenAnkle;
    io.driveJoint("LeftLowerLeg_LeftFoot", {
      targetLocalRot: ankleTarget,
      kp: ankleG.kp,
      kd: ankleG.kd,
      maxTorque: ankleG.max,
    });
    io.driveJoint("RightLowerLeg_RightFoot", {
      targetLocalRot: ankleTarget,
      kp: ankleG.kp,
      kd: ankleG.kd,
      maxTorque: ankleG.max,
    });

    // ------------------------------------------------------------------
    // G) Debug
    // ------------------------------------------------------------------
    // Compute the torso lean target as a world-space direction vector.
    // Start with straight up (0,1,0) and rotate by the lean target quaternion
    // in the root frame to get the effective "ideal up" direction.
    const rootSampleForLean = io.sampleBody("Root");
    const leanQuat = qMul(qFromAxisAngle(v3(1, 0, 0), torsoPitchActual), qFromAxisAngle(v3(0, 0, 1), torsoRollActual));
    // Transform from root-local to world
    const rootRot = rootSampleForLean.rot;
    const leanDirLocal = qRotateVec3(leanQuat, v3(0, 1, 0));
    const torsoLeanDir = qRotateVec3(rootRot, leanDirLocal);

    this._debug = {
      support,
      comProj,
      errorRaw,
      errorFiltered,
      errorMag,
      leftGrounded: leftFC.grounded,
      rightGrounded: rightFC.grounded,
      tiltRad,
      fallen: this.fallen,
      torsoLeanDir,
    };

    this.frameCount++;
    if (this.frameCount <= 10 || this.frameCount % 60 === 0) {
      const tiltDeg = (tiltRad * 180) / Math.PI;
      console.log(
        `[Balance #${this.frameCount}]`,
        `L:${leftFC.grounded} R:${rightFC.grounded}`,
        `tilt:${tiltDeg.toFixed(1)}deg`,
        this.fallen ? "FALLEN" : "",
        `errW:(${errorFiltered.x.toFixed(4)},${errorFiltered.z.toFixed(4)})`,
        `errL:(${errLocal.x.toFixed(4)},${errLocal.z.toFixed(4)})`,
        `velL:(${velLocal.x.toFixed(4)},${velLocal.z.toFixed(4)})`,
        `ankle:${anklePitchRad.toFixed(4)}`,
        `torsoPR:(${torsoPitchActual.toFixed(4)},${torsoRollActual.toFixed(4)})`
      );
    }
  }
}
