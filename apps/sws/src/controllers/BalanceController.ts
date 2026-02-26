// controllers/BalanceController.ts
//
// Phase 1 standing balance controller.
//
// Keeps the rig upright by steering joint targets so that the COM projection
// stays above the support polygon (midpoint between grounded feet).
//
// No walking or step planning -- just stand-still stabilization and
// disturbance recovery via posture adjustment.
//
// Uses only plain Vec3/Quat math and the RigIO interface. No Three.js or
// Rapier types. All vectors are in WORLD space unless noted otherwise.

import type { Vec3 } from "@/lib/math";
import { add, clamp, expSmoothingAlpha, horiz, len, q, qFromAxisAngle, scale, smoothVec3, sub, v3 } from "@/lib/math";
import type { RigIO } from "@/rig/RigIO";

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** How fast the filtered support/COM signals track raw values (seconds). */
const FILTER_TAU = 0.08;

/**
 * Default compliance knee bend (radians). A small bend lowers the COM and
 * gives the ankle/hip loop room to correct without hitting joint limits.
 */
const DEFAULT_KNEE_BEND = 0.08;

/**
 * How much knee bend increases per unit of balance error magnitude (rad/m).
 * Bending the knees lowers the COM and absorbs disturbances.
 */
const KNEE_BEND_PER_ERROR = 0.6;

/** Maximum extra knee bend from error (radians, ~15 deg). */
const MAX_EXTRA_KNEE_BEND = 0.26;

// Gain tables -- joint stiffness / damping for the controller outputs.
// These are intentionally moderate. The controller produces *angle targets*,
// and the PD drives in RigIO / Rapier motors enforce them.

const GAINS = {
  torso: { kp: 55, kd: 8, max: 150 },
  hip: { kp: 50, kd: 8, max: 120 },
  knee: { kp: 150, kd: 18, max: 350 },
  ankle: { kp: 8, kd: 4, max: 25 },
} as const;

// ---------------------------------------------------------------------------
// Balance error -> joint angle mapping
// ---------------------------------------------------------------------------

/**
 * Phase 1 strategy: ankle-only balance correction.
 *
 * Torso and hips are driven to identity (rest pose) to keep them stiff.
 * Ankles are the sole balance actuator (ankle strategy), active only when
 * the corresponding foot is grounded. This avoids:
 * - Multiple joints fighting each other
 * - Wild ankle motion when feet are airborne
 * - Sign confusion from complex postural corrections
 */

// ---------------------------------------------------------------------------
// Debug output
// ---------------------------------------------------------------------------

export interface BalanceDebug {
  /** Support point on ground (world). */
  support: Vec3;
  /** COM projected to ground plane (world). */
  comProj: Vec3;
  /** Raw balance error xz (world). */
  errorRaw: Vec3;
  /** Filtered balance error xz (world). */
  errorFiltered: Vec3;
  /** Error magnitude (meters). */
  errorMag: number;
  /** Whether each foot is grounded. */
  leftGrounded: boolean;
  rightGrounded: boolean;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class BalanceController {
  // Filtered signals
  private filteredSupport: Vec3 = v3(0, 0, 0);
  private filteredCom: Vec3 = v3(0, 0, 0);
  private initialized = false;

  // Last debug snapshot
  private _debug: BalanceDebug | null = null;

  /** Read the most recent debug snapshot (null before first update). */
  get debug(): BalanceDebug | null {
    return this._debug;
  }

  /**
   * Run one tick of the balance controller.
   *
   * Call this once per physics step, BEFORE the physics world steps.
   * It reads body/foot state via `io`, computes posture targets, and
   * issues driveJoint commands.
   */
  update(io: RigIO, dt: number): void {
    // ------------------------------------------------------------------
    // A) Compute support point
    // ------------------------------------------------------------------
    const leftFC = io.footContact("LeftFoot");
    const rightFC = io.footContact("RightFoot");
    const anyGrounded = leftFC.grounded || rightFC.grounded;

    let support: Vec3;

    if (leftFC.grounded && rightFC.grounded && leftFC.avgPoint && rightFC.avgPoint) {
      support = horiz(scale(add(leftFC.avgPoint, rightFC.avgPoint), 0.5));
    } else if (leftFC.grounded && leftFC.avgPoint) {
      support = horiz(leftFC.avgPoint);
    } else if (rightFC.grounded && rightFC.avgPoint) {
      support = horiz(rightFC.avgPoint);
    } else {
      // Airborne -- project root position as a fallback
      const rootPos = io.sampleBody("Root").pos;
      support = horiz(rootPos);
    }

    // ------------------------------------------------------------------
    // B) COM projection onto ground plane
    // ------------------------------------------------------------------
    const comWorld = io.comWorld();
    const comProj = horiz(comWorld);

    // ------------------------------------------------------------------
    // C) Filter signals
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

    // ------------------------------------------------------------------
    // D) Balance error
    // ------------------------------------------------------------------
    const errorRaw = sub(comProj, support);
    const errorFiltered = sub(this.filteredCom, this.filteredSupport);
    const errorMag = len(errorFiltered);

    // ------------------------------------------------------------------
    // E) Drive joints
    // ------------------------------------------------------------------

    // Identity quaternion -- rest pose for all non-balance joints
    const rest = q(0, 0, 0, 1);

    // Torso: hold rest pose (stiff)
    io.driveJoint("Root_Torso", {
      targetLocalRot: rest,
      kp: GAINS.torso.kp,
      kd: GAINS.torso.kd,
      maxTorque: GAINS.torso.max,
    });

    // Hips: hold rest pose (stiff)
    io.driveJoint("Root_LeftUpperLeg", {
      targetLocalRot: rest,
      kp: GAINS.hip.kp,
      kd: GAINS.hip.kd,
      maxTorque: GAINS.hip.max,
    });
    io.driveJoint("Root_RightUpperLeg", {
      targetLocalRot: rest,
      kp: GAINS.hip.kp,
      kd: GAINS.hip.kd,
      maxTorque: GAINS.hip.max,
    });

    // Knees: small compliance bend + error-based extra bend
    const extraBend = clamp(KNEE_BEND_PER_ERROR * errorMag, 0, MAX_EXTRA_KNEE_BEND);
    const kneeBend = DEFAULT_KNEE_BEND + extraBend;
    const kneeTarget = qFromAxisAngle(v3(1, 0, 0), kneeBend);

    io.driveJoint("LeftUpperLeg_LeftLowerLeg", {
      targetLocalRot: kneeTarget,
      kp: GAINS.knee.kp,
      kd: GAINS.knee.kd,
      maxTorque: GAINS.knee.max,
    });
    io.driveJoint("RightUpperLeg_RightLowerLeg", {
      targetLocalRot: kneeTarget,
      kp: GAINS.knee.kp,
      kd: GAINS.knee.kd,
      maxTorque: GAINS.knee.max,
    });

    // Ankles: sole balance actuator, only when grounded.
    // Ankle pitch gain (rad/m). COM forward (errorZ > 0) -> dorsiflex
    // (positive pitch around X) -> reaction from ground pushes shin back.
    const ANKLE_PITCH_GAIN = 2.0;
    const anklePitchRad = anyGrounded ? clamp(ANKLE_PITCH_GAIN * errorFiltered.z, -0.2, 0.2) : 0;

    // Drive each ankle only when its own foot is grounded.
    // When airborne, hold rest pose with very low gains so the foot
    // hangs naturally instead of whipping around.
    if (leftFC.grounded) {
      const ankleTarget = qFromAxisAngle(v3(1, 0, 0), anklePitchRad);
      io.driveJoint("LeftLowerLeg_LeftFoot", {
        targetLocalRot: ankleTarget,
        kp: GAINS.ankle.kp,
        kd: GAINS.ankle.kd,
        maxTorque: GAINS.ankle.max,
      });
    } else {
      io.driveJoint("LeftLowerLeg_LeftFoot", {
        targetLocalRot: rest,
        kp: 1,
        kd: 2,
        maxTorque: 5,
      });
    }

    if (rightFC.grounded) {
      const ankleTarget = qFromAxisAngle(v3(1, 0, 0), anklePitchRad);
      io.driveJoint("RightLowerLeg_RightFoot", {
        targetLocalRot: ankleTarget,
        kp: GAINS.ankle.kp,
        kd: GAINS.ankle.kd,
        maxTorque: GAINS.ankle.max,
      });
    } else {
      io.driveJoint("RightLowerLeg_RightFoot", {
        targetLocalRot: rest,
        kp: 1,
        kd: 2,
        maxTorque: 5,
      });
    }

    // ------------------------------------------------------------------
    // F) Debug snapshot
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
  }
}
