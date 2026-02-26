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
  qRotateVec3,
  smoothVec3,
  sub,
  v3,
} from "@/lib/math";
import type { RigIO } from "@/rig/RigIO";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Filter time constant for COM/support signals (seconds). */
const FILTER_TAU = 0.04;

/** Tilt angle (radians) above which the controller enters fallen state. */
const FALLEN_TILT_RAD = 0.75; // ~43 degrees

/** Tilt angle (radians) below which the controller exits fallen state. */
const RECOVER_TILT_RAD = 0.25; // ~14 degrees -- hysteresis band

// ---------------------------------------------------------------------------
// Ankle balance gains (primary actuator)
// ---------------------------------------------------------------------------

const ANKLE_P = 8.0;
const ANKLE_D = 2.5;
const ANKLE_MAX_RAD = 0.25;

// ---------------------------------------------------------------------------
// Joint drive gains
//
// All joints (hinge and spherical) now use Rapier's built-in motor,
// which is solved inside the constraint solver. The gains here are
// passed through to the motor (scaled 10x for Rapier units). The
// motor handles Newton's 3rd law and fights gravity directly.
// ---------------------------------------------------------------------------

const STANDING_GAINS = {
  torso: { kp: 40, kd: 12, max: 120 },
  hip: { kp: 40, kd: 12, max: 120 },
  knee: { kp: 80, kd: 14, max: 250 },
  ankle: { kp: 25, kd: 10, max: 80 },
  head: { kp: 20, kd: 6, max: 40 },
  arm: { kp: 15, kd: 5, max: 30 },
} as const;

const FALLEN_GAINS = {
  torso: { kp: 3, kd: 4, max: 10 },
  hip: { kp: 3, kd: 4, max: 10 },
  knee: { kp: 5, kd: 4, max: 15 },
  ankle: { kp: 2, kd: 3, max: 5 },
  head: { kp: 2, kd: 3, max: 5 },
  arm: { kp: 1, kd: 2, max: 3 },
} as const;

const DEFAULT_KNEE_BEND = 0.12;

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
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class BalanceController {
  private filteredSupport: Vec3 = v3(0, 0, 0);
  private filteredCom: Vec3 = v3(0, 0, 0);
  private initialized = false;
  private fallen = false;

  private _debug: BalanceDebug | null = null;
  private frameCount = 0;

  get debug(): BalanceDebug | null {
    return this._debug;
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
    if (!this.fallen && tiltRad > FALLEN_TILT_RAD) {
      this.fallen = true;
    } else if (this.fallen && tiltRad < RECOVER_TILT_RAD) {
      this.fallen = false;
    }

    const gains = this.fallen ? FALLEN_GAINS : STANDING_GAINS;

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
    const alpha = expSmoothingAlpha(dt, FILTER_TAU);
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

    // ------------------------------------------------------------------
    // E) Joint drives (Rapier built-in motors)
    //
    // All joints (hinge and spherical) use Rapier's constraint-solver
    // motors. These are bidirectional (Newton's 3rd law), implicitly
    // integrated (high effective stiffness), and transmit forces
    // through the kinematic chain to the ground.
    // ------------------------------------------------------------------
    const rest = q(0, 0, 0, 1);

    // Torso: rest pose hold
    io.driveJoint("Root_Torso", {
      targetLocalRot: rest,
      kp: gains.torso.kp,
      kd: gains.torso.kd,
      maxTorque: gains.torso.max,
    });

    // Head: rest pose hold (low gains -- light part, should not destabilize)
    io.driveJoint("Torso_Head", {
      targetLocalRot: rest,
      kp: gains.head.kp,
      kd: gains.head.kd,
      maxTorque: gains.head.max,
    });

    // Arms: rest pose hold (low gains -- should hang without destabilizing)
    io.driveJoint("Torso_LeftArm", {
      targetLocalRot: rest,
      kp: gains.arm.kp,
      kd: gains.arm.kd,
      maxTorque: gains.arm.max,
    });
    io.driveJoint("Torso_RightArm", {
      targetLocalRot: rest,
      kp: gains.arm.kp,
      kd: gains.arm.kd,
      maxTorque: gains.arm.max,
    });

    // Hips: rest pose hold
    io.driveJoint("Root_LeftUpperLeg", {
      targetLocalRot: rest,
      kp: gains.hip.kp,
      kd: gains.hip.kd,
      maxTorque: gains.hip.max,
    });
    io.driveJoint("Root_RightUpperLeg", {
      targetLocalRot: rest,
      kp: gains.hip.kp,
      kd: gains.hip.kd,
      maxTorque: gains.hip.max,
    });

    // Knees: slight compliance bend
    const kneeTarget = qFromAxisAngle(v3(1, 0, 0), DEFAULT_KNEE_BEND);
    io.driveJoint("LeftUpperLeg_LeftLowerLeg", {
      targetLocalRot: kneeTarget,
      kp: gains.knee.kp,
      kd: gains.knee.kd,
      maxTorque: gains.knee.max,
    });
    io.driveJoint("RightUpperLeg_RightLowerLeg", {
      targetLocalRot: kneeTarget,
      kp: gains.knee.kp,
      kd: gains.knee.kd,
      maxTorque: gains.knee.max,
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
        ? clamp(ANKLE_P * errorFiltered.z + ANKLE_D * comVel.z, -ANKLE_MAX_RAD, ANKLE_MAX_RAD)
        : 0;

    const ankleTarget = qFromAxisAngle(v3(1, 0, 0), anklePitchRad);

    io.driveJoint("LeftLowerLeg_LeftFoot", {
      targetLocalRot: ankleTarget,
      kp: gains.ankle.kp,
      kd: gains.ankle.kd,
      maxTorque: gains.ankle.max,
    });
    io.driveJoint("RightLowerLeg_RightFoot", {
      targetLocalRot: ankleTarget,
      kp: gains.ankle.kp,
      kd: gains.ankle.kd,
      maxTorque: gains.ankle.max,
    });

    // ------------------------------------------------------------------
    // G) Debug
    // ------------------------------------------------------------------
    this._debug = {
      support,
      comProj,
      errorRaw,
      errorFiltered,
      errorMag,
      leftGrounded: leftFC.grounded,
      rightGrounded: rightFC.grounded,
    };

    this.frameCount++;
    if (this.frameCount <= 10 || this.frameCount % 60 === 0) {
      const tiltDeg = (tiltRad * 180) / Math.PI;
      console.log(
        `[Balance #${this.frameCount}]`,
        `L:${leftFC.grounded} R:${rightFC.grounded}`,
        `tilt:${tiltDeg.toFixed(1)}deg`,
        this.fallen ? "FALLEN" : "",
        `errZ:${errorFiltered.z.toFixed(4)}`,
        `ankle:${anklePitchRad.toFixed(4)}`
      );
    }
  }
}
