// controllers/CatchStepController.ts
//
// Phase 2: single catch-step reflex layered on top of BalanceController.
// - BalanceController remains the default stand behavior.
// - This controller adds a small state machine that (sometimes) takes ONE step
//   to recover from large disturbances, then returns to stable standing.
//
// Layering rules respected:
// - Controller uses only plain {x,y,z}/{x,y,z,w} math (no engine types).
// - No world-frame magic torques. Uses joint posture targets + foot placement.
// - BalanceController is treated as working and is NOT rewritten.
//
// Notes:
// - During stepping states we call balance.update(io, dt) first to keep torso/arms
//   and stance leg stable, then we override swing-leg joint targets.
// - The step is heuristic (no IK). It should be explicit and debuggable.
//
// Swing leg trajectory (the key design):
//   The swing phase is split into LIFT and REACH sub-phases.
//   - LIFT (t = 0..~0.4): Hip flexes forward (positive pitch around +X)
//     regardless of step direction + knee bends deeply. This lifts the foot
//     off the ground.
//   - REACH (t = ~0.4..1.0): Hip moves toward the step-direction target, knee
//     extends, ankle goes neutral. This positions the foot over the target.
//   Ground contact is NOT checked during early swing (before liftMinFraction)
//   to prevent premature transitions before the foot clears the ground.

import type { Vec3 } from "@/lib/math";
import { clamp, expSmoothingAlpha, horiz, len, q, qFromAxisAngle, qMul, smoothstep, v3 } from "@/lib/math";
import type { RigIO } from "@/rig/RigIO";
import type { BalanceController } from "./BalanceController";

type FootName = "LeftFoot" | "RightFoot";
type StepState = "STAND" | "STEP_PREP" | "STEP_SWING" | "STEP_LAND" | "SETTLE";

export interface CatchStepDebug {
  state: StepState;
  cooldown: number;

  // Trigger signals
  errorMagFiltered: number;
  comVelXZFiltered: number;
  overErrorTime: number;

  // Step plan
  stepFoot: FootName | null;
  stanceFoot: FootName | null;
  supportPoint: Vec3 | null;
  stepTarget: Vec3 | null;
  stepDir: Vec3 | null;
  stepDistance: number;

  // Timers
  tState: number;
  tSwing: number;
  tLand: number;
}

export const CATCH_STEP_DEFAULTS = {
  // Filtering
  filterTau: 0.06, // seconds (slower than BalanceController's 0.04)

  // Trigger thresholds
  triggerErrorHi: 0.18, // meters -- COM-over-support error to start counting hold time
  triggerErrorLo: 0.12, // meters -- lower threshold if combined with high COM velocity
  triggerVelXZ: 0.8, // m/s -- COM velocity threshold for combined trigger
  triggerHoldTime: 0.1, // seconds -- error must exceed triggerErrorHi for this long

  // Hysteresis / anti-spam
  cooldownTime: 0.55, // seconds after a step completes before another can trigger
  settleTime: 0.2, // seconds of stable stance before returning to STAND

  // Step placement heuristic
  kVel: 0.35, // blends COM velocity into step direction
  stepDistK: 0.35, // maps |dir| to distance
  stepDistMin: 0.15, // meters
  stepDistMax: 0.45, // meters

  // Reasonable bounds relative to root position (world axes)
  maxLateralFromRoot: 0.35, // meters
  maxForwardFromRoot: 0.6, // meters (in +Z)
  maxBackwardFromRoot: 0.2, // meters (in -Z)

  // Swing timing
  prepTime: 0.18, // seconds -- weight-transfer phase before swing
  swingTime: 0.4, // seconds -- slightly longer for the foot to clear and return
  landTime: 0.12, // seconds (time budget to find contact before fallback)

  // Lift sub-phase: ground contact is not checked until this fraction of
  // swingTime has elapsed. Prevents detecting "still on ground" as a
  // landing before the foot has lifted.
  liftMinFraction: 0.65,

  // Weight transfer: during STEP_PREP, the swing hip abducts to push
  // the root laterally over the stance foot. This unloads the swing foot
  // so the motors can lift it freely. Without this the swing foot is still
  // bearing half the body weight and no motor gain can cleanly lift it.
  weightShiftRollRad: 0.12, // rad -- swing hip abduction during prep/early swing

  // Swing-phase gravity compensation: an upward assist force (Newtons)
  // applied directly to the swing foot body during the lift phase.
  // Compensates for the foot's 5 kg mass * gravity (49 N). Without this,
  // the foot mass + ground contact pinch prevents joint motors alone from
  // achieving lift-off.
  swingLiftAssistN: 55, // N -- slightly above foot weight (5 kg * 9.81)

  // Joint posture parameters for swing (heuristic, all in radians)

  // Hip flexion lift: fixed forward pitch during lift phase to clear the foot.
  // This is the PRIMARY mechanism that gets the foot off the ground and is
  // applied regardless of step direction.
  hipFlexLift: 0.75, // rad (~43 deg)

  // Direction-dependent hip targets during reach phase.
  // hipPitchMax is SMALL so the foot descends during reach rather than
  // staying elevated (the sine-wave bug).
  hipPitchMax: 0.15, // rad -- small directional bias, NOT continued lift
  hipRollMax: 0.3, // max hip roll (lateral step)

  // Knee and ankle during lift vs landing
  kneeBendLift: 1.1, // rad (~63 deg) -- deep bend to shorten swing leg
  kneeBendLand: 0.18, // slight bend at landing
  anklePitchLift: -0.4, // rad -- dorsiflex during lift (within joint limit of -0.436)

  // Drive gains for the swing leg joints.
  swingHipGains: { kp: 150, kd: 30, max: 500 },
  swingKneeGains: { kp: 250, kd: 30, max: 700 },
  swingAnkleGains: { kp: 100, kd: 20, max: 300 },

  // Stance leg gain multiplier during single-leg support.
  stanceGainMult: 2.5,
} as const;

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function footSideSign(foot: FootName): number {
  // +1 for right foot, -1 for left foot.
  // Used to flip hip roll direction so each leg abducts outward.
  return foot === "RightFoot" ? +1 : -1;
}

function normalizeXZ(v: Vec3): Vec3 {
  const x = v.x;
  const z = v.z;
  const m = Math.sqrt(x * x + z * z);
  if (m < 1e-6) return v3(0, 0, 0);
  return v3(x / m, 0, z / m);
}

function lenXZ(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.z * v.z);
}

function smooth1(prev: number, next: number, alpha: number): number {
  return prev + (next - prev) * alpha;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function saturate(t: number): number {
  return clamp(t, 0, 1);
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class CatchStepController {
  private readonly balance: BalanceController;
  private readonly cfg: typeof CATCH_STEP_DEFAULTS;

  private state: StepState = "STAND";
  private tState = 0;

  // Filtered trigger signals
  private errorMagF = 0;
  private comVelXZF = 0;
  private overErrorTime = 0;
  private initialized = false;

  // Anti-spam
  private cooldown = 0;

  // Step plan (set during STEP_PREP, used during STEP_SWING/STEP_LAND)
  private stepFoot: FootName | null = null;
  private stanceFoot: FootName | null = null;
  private supportPoint: Vec3 | null = null;
  private stepTarget: Vec3 | null = null;
  private stepDir: Vec3 | null = null;
  private stepDistance = 0;

  // Per-state timers
  private tSwing = 0;
  private tLand = 0;

  private _debug: CatchStepDebug | null = null;
  get debug(): CatchStepDebug | null {
    return this._debug;
  }

  constructor(balance: BalanceController, cfg?: Partial<typeof CATCH_STEP_DEFAULTS>) {
    this.balance = balance;
    this.cfg = { ...CATCH_STEP_DEFAULTS, ...cfg } as typeof CATCH_STEP_DEFAULTS;
  }

  update(io: RigIO, dt: number): void {
    // Always tick base balance first; we override swing leg joints as needed.
    this.balance.update(io, dt);

    // Cooldown tick
    this.cooldown = Math.max(0, this.cooldown - dt);

    // Read balance debug signals (preferred, since BalanceController already
    // filters COM/support).
    const bdbg = this.balance.debug;
    const err = bdbg ? bdbg.errorFiltered : v3(0, 0, 0);
    const errMag = bdbg ? bdbg.errorMag : 0;
    const comVel = io.comVelWorld();
    const comVelXZ = lenXZ(comVel);

    // Filter trigger signals (slightly slower filter than BalanceController)
    const alpha = expSmoothingAlpha(dt, this.cfg.filterTau);
    if (!this.initialized) {
      this.errorMagF = errMag;
      this.comVelXZF = comVelXZ;
      this.initialized = true;
    } else {
      this.errorMagF = smooth1(this.errorMagF, errMag, alpha);
      this.comVelXZF = smooth1(this.comVelXZF, comVelXZ, alpha);
    }

    // Hold timer: "error has been above triggerErrorHi for X seconds"
    if (this.errorMagF > this.cfg.triggerErrorHi) {
      this.overErrorTime += dt;
    } else {
      // Decay quickly to avoid sticky triggering
      this.overErrorTime = Math.max(0, this.overErrorTime - dt * 2.0);
    }

    // State machine
    this.tState += dt;

    switch (this.state) {
      case "STAND": {
        const shouldTrigger =
          this.cooldown <= 0 &&
          (this.overErrorTime >= this.cfg.triggerHoldTime ||
            (this.errorMagF > this.cfg.triggerErrorLo && this.comVelXZF > this.cfg.triggerVelXZ));

        if (shouldTrigger) {
          this.enterStepPrep(io, err);
        }
        break;
      }

      case "STEP_PREP": {
        // Drive swing hip into abduction to shift COM over stance foot.
        // This unloads the swing foot so it can be lifted.
        this.applyWeightShiftTargets(io);

        if (this.tState >= this.cfg.prepTime) {
          this.enterStepSwing();
        }
        break;
      }

      case "STEP_SWING": {
        this.tSwing += dt;
        this.applySwingLegTargets(io);

        // Transition to STEP_LAND when:
        //   a) Swing foot contacts ground AND we are past the lift-min time, OR
        //   b) Swing time budget is exhausted.
        // The liftMinFraction guard prevents detecting "foot still on ground"
        // as a landing during the first part of the swing.
        const pastLiftMin = this.tSwing >= this.cfg.swingTime * this.cfg.liftMinFraction;
        const timeUp = this.tSwing >= this.cfg.swingTime;

        if (this.stepFoot) {
          const fc = io.footContact(this.stepFoot);
          if ((fc.grounded && pastLiftMin) || timeUp) {
            this.enterStepLand();
          }
        } else {
          this.enterSettle();
        }
        break;
      }

      case "STEP_LAND": {
        this.tLand += dt;
        this.applyLandingLegTargets(io);

        if (this.stepFoot) {
          const fc = io.footContact(this.stepFoot);
          if (fc.grounded || this.tLand >= this.cfg.landTime) {
            this.enterSettle();
          }
        } else {
          this.enterSettle();
        }
        break;
      }

      case "SETTLE": {
        // BalanceController is running; wait for stability then return to STAND.
        if (this.tState >= this.cfg.settleTime) {
          this.enterStand();
        }
        break;
      }
    }

    // Debug snapshot
    this._debug = {
      state: this.state,
      cooldown: this.cooldown,

      errorMagFiltered: this.errorMagF,
      comVelXZFiltered: this.comVelXZF,
      overErrorTime: this.overErrorTime,

      stepFoot: this.stepFoot,
      stanceFoot: this.stanceFoot,
      supportPoint: this.supportPoint,
      stepTarget: this.stepTarget,
      stepDir: this.stepDir,
      stepDistance: this.stepDistance,

      tState: this.tState,
      tSwing: this.tSwing,
      tLand: this.tLand,
    };
  }

  // --------------------------------------------------------------------------
  // State transitions
  // --------------------------------------------------------------------------

  private enterStand(): void {
    console.log("[CatchStep] -> STAND");
    this.state = "STAND";
    this.tState = 0;
    this.tSwing = 0;
    this.tLand = 0;

    this.stepFoot = null;
    this.stanceFoot = null;
    this.supportPoint = null;
    this.stepTarget = null;
    this.stepDir = null;
    this.stepDistance = 0;
  }

  private enterStepPrep(io: RigIO, errorFiltered: Vec3): void {
    // -- Choose step direction and foot --

    const leftFC = io.footContact("LeftFoot");
    const rightFC = io.footContact("RightFoot");

    const root = io.sampleBody("Root");
    const support = this.pickSupportPoint(root.pos, leftFC, rightFC);
    this.supportPoint = support;

    // Step direction: normalize( errorXZ + kVel * comVelXZ )
    const errXZ = horiz(errorFiltered);
    const vel = io.comVelWorld();
    const velXZ = v3(vel.x, 0, vel.z);

    const dirRaw = v3(errXZ.x + this.cfg.kVel * velXZ.x, 0, errXZ.z + this.cfg.kVel * velXZ.z);
    const dir = normalizeXZ(dirRaw);
    this.stepDir = dir;

    // Pick which foot steps. Prefer stepping on the side the COM is falling
    // toward. If only one foot is grounded, step the ungrounded one.
    const preferred: FootName = dir.x >= 0 ? "RightFoot" : "LeftFoot";

    let stepFoot: FootName;
    if (leftFC.grounded && !rightFC.grounded) {
      stepFoot = "RightFoot";
    } else if (rightFC.grounded && !leftFC.grounded) {
      stepFoot = "LeftFoot";
    } else {
      stepFoot = preferred;
    }

    this.stepFoot = stepFoot;
    this.stanceFoot = stepFoot === "LeftFoot" ? "RightFoot" : "LeftFoot";

    // Step distance: scaled from the raw (unnormalized) direction magnitude.
    const dirMag = lenXZ(dirRaw);
    const dist = clamp(this.cfg.stepDistK * dirMag, this.cfg.stepDistMin, this.cfg.stepDistMax);
    this.stepDistance = dist;

    // Target position = support + dir * dist, clamped relative to root.
    const targetXZ = v3(support.x + dir.x * dist, 0, support.z + dir.z * dist);
    const clampedXZ = this.clampTargetRelativeToRoot(targetXZ, root.pos);
    this.stepTarget = this.raycastToGround(io, clampedXZ, root.pos.y);

    // Prevent immediate re-triggering while stepping
    this.cooldown = Math.max(this.cooldown, 0.1);

    console.log(
      "[CatchStep] -> STEP_PREP",
      `foot:${stepFoot}`,
      `dir:(${dir.x.toFixed(2)},${dir.z.toFixed(2)})`,
      `dist:${dist.toFixed(3)}`,
      `err:${this.errorMagF.toFixed(3)}`,
      `vel:${this.comVelXZF.toFixed(3)}`
    );

    this.state = "STEP_PREP";
    this.tState = 0;
    this.tSwing = 0;
    this.tLand = 0;
  }

  private enterStepSwing(): void {
    if (!this.stepFoot || !this.stepTarget || !this.stepDir) {
      console.log("[CatchStep] -> SETTLE (no plan, fail-safe)");
      this.enterSettle();
      return;
    }

    console.log("[CatchStep] -> STEP_SWING");
    this.state = "STEP_SWING";
    this.tState = 0;
    this.tSwing = 0;
    this.tLand = 0;
  }

  private enterStepLand(): void {
    console.log("[CatchStep] -> STEP_LAND", `tSwing:${this.tSwing.toFixed(3)}`);
    this.state = "STEP_LAND";
    this.tState = 0;
    this.tLand = 0;
  }

  private enterSettle(): void {
    console.log("[CatchStep] -> SETTLE");
    this.state = "SETTLE";
    this.tState = 0;

    this.cooldown = this.cfg.cooldownTime;

    // Clear step plan
    this.stepFoot = null;
    this.stanceFoot = null;
    this.supportPoint = null;
    this.stepTarget = null;
    this.stepDir = null;
    this.stepDistance = 0;
    this.tSwing = 0;
    this.tLand = 0;
  }

  // --------------------------------------------------------------------------
  // Support/target helpers
  // --------------------------------------------------------------------------

  private pickSupportPoint(
    fallback: Vec3,
    leftFC: ReturnType<RigIO["footContact"]>,
    rightFC: ReturnType<RigIO["footContact"]>
  ): Vec3 {
    if (leftFC.grounded && rightFC.grounded && leftFC.avgPoint && rightFC.avgPoint) {
      return horiz(
        v3((leftFC.avgPoint.x + rightFC.avgPoint.x) * 0.5, 0, (leftFC.avgPoint.z + rightFC.avgPoint.z) * 0.5)
      );
    }
    if (leftFC.grounded && leftFC.avgPoint) return horiz(leftFC.avgPoint);
    if (rightFC.grounded && rightFC.avgPoint) return horiz(rightFC.avgPoint);
    return horiz(fallback);
  }

  private clampTargetRelativeToRoot(targetXZ: Vec3, rootPos: Vec3): Vec3 {
    const dx = targetXZ.x - rootPos.x;
    const dz = targetXZ.z - rootPos.z;

    const dxC = clamp(dx, -this.cfg.maxLateralFromRoot, this.cfg.maxLateralFromRoot);
    const dzC = clamp(dz, -this.cfg.maxBackwardFromRoot, this.cfg.maxForwardFromRoot);

    return v3(rootPos.x + dxC, 0, rootPos.z + dzC);
  }

  private raycastToGround(io: RigIO, targetXZ: Vec3, rootY: number): Vec3 {
    const from = v3(targetXZ.x, rootY + 1.2, targetXZ.z);
    const to = v3(targetXZ.x, rootY - 2.0, targetXZ.z);
    const hit = io.groundRaycast(from, to);
    if (hit?.point) return hit.point;
    return v3(targetXZ.x, rootY, targetXZ.z);
  }

  // --------------------------------------------------------------------------
  // Weight shift (STEP_PREP phase)
  //
  // Before the swing leg can lift, its weight must transfer to the stance
  // leg. We accomplish this by abducting the swing hip (rolling it outward).
  // Newton's 3rd law pushes the root laterally toward the stance foot,
  // shifting the COM over the stance base. After ~0.18s the swing foot
  // carries near-zero ground reaction force and the motors can lift it.
  // --------------------------------------------------------------------------

  private applyWeightShiftTargets(io: RigIO): void {
    if (!this.stepFoot || !this.stanceFoot) return;

    // Ramp abduction up over prepTime
    const t = saturate(this.tState / this.cfg.prepTime);
    const rollRad = this.cfg.weightShiftRollRad * t;

    // Swing hip: abduction only (no pitch yet)
    const hipTarget = this.composeHipTarget(0, rollRad, this.stepFoot);
    const hipCmd = {
      targetLocalRot: hipTarget,
      kp: this.cfg.swingHipGains.kp,
      kd: this.cfg.swingHipGains.kd,
      maxTorque: this.cfg.swingHipGains.max,
    };

    if (this.stepFoot === "LeftFoot") {
      io.driveJoint("Root_LeftUpperLeg", hipCmd);
    } else {
      io.driveJoint("Root_RightUpperLeg", hipCmd);
    }

    // Anchor stance side
    this.bumpStanceLegGains(io);
  }

  // --------------------------------------------------------------------------
  // Joint driving during step
  //
  // Envelopes:
  //   weightShiftEnv: continues abduction from prep, decays mid-swing.
  //   liftEnv: trapezoidal -- ramps up quickly, sustains, ramps down.
  //   reachEnv / extendEnv: transition to directional target and leg extension.
  //
  // Additionally, an upward "lift assist" force is applied directly to the
  // swing foot body during the lift phase. This compensates for the foot's
  // 5 kg mass being pinched between ground contact and gravitational load.
  // It is a physics-based force (not teleporting) and decays to 0 by mid-swing.
  // --------------------------------------------------------------------------

  private applySwingLegTargets(io: RigIO): void {
    if (!this.stepFoot || !this.stepTarget || !this.stepDir) return;

    const foot = this.stepFoot;

    // Phase 0..1 over swingTime
    const t = saturate(this.tSwing / this.cfg.swingTime);

    // -- Weight-shift envelope --
    // Starts at 1.0 (continuous from STEP_PREP), holds through early swing
    // while the foot is lifting, decays once foot is airborne.
    const weightShiftEnv = 1.0 - smoothstep(0.3, 0.65, t);

    // -- Lift envelope (trapezoidal) --
    // Quick ramp to 1.0 in t=[0, 0.12], sustained hold, ramp down in t=[0.5, 0.8].
    // Much better than a sine peak that decays before the foot clears.
    const liftEnv = smoothstep(0, 0.12, t) * (1.0 - smoothstep(0.5, 0.8, t));

    // -- Reach envelope --
    // Ramps from 0 to 1 between t=0.4 and t=0.9.
    // Directional bias for step placement.
    const reachEnv = smoothstep(0.4, 0.9, t);

    // -- Extend envelope --
    // Ramps from 0 to 1 between t=0.45 and t=1.0.
    // Controls knee extension and ankle neutralization for landing.
    const extendEnv = smoothstep(0.45, 1.0, t);

    const dir = this.stepDir;

    // -- Hip pitch (around +X in joint local frame) --
    // Lift component: fixed forward flexion to raise the thigh
    const hipLiftPitch = this.cfg.hipFlexLift * liftEnv;

    // Reach component: small directional bias so the foot aims at the target.
    // Deliberately small (hipPitchMax = 0.15) so the foot descends for landing.
    const hipReachPitch = clamp(dir.z * this.cfg.hipPitchMax, -this.cfg.hipPitchMax, this.cfg.hipPitchMax) * reachEnv;

    const hipPitch = hipLiftPitch + hipReachPitch;

    // -- Hip roll (around +Z in joint local frame) --
    // Weight-shift abduction (continues from prep) + directional roll.
    const weightShiftRoll = this.cfg.weightShiftRollRad * weightShiftEnv;
    const dirRoll = clamp(dir.x * this.cfg.hipRollMax, -this.cfg.hipRollMax, this.cfg.hipRollMax) * reachEnv;
    const hipRoll = weightShiftRoll + dirRoll;

    // -- Knee (hinge around +X) --
    const kneeBend = lerp(this.cfg.kneeBendLift, this.cfg.kneeBendLand, extendEnv);

    // -- Ankle (hinge around +X) --
    const anklePitch = lerp(this.cfg.anklePitchLift, 0, extendEnv);

    // Build joint target quaternions
    const hipTarget = this.composeHipTarget(hipPitch, hipRoll, foot);
    const kneeTarget = qFromAxisAngle(v3(1, 0, 0), kneeBend);
    const ankleTarget = qFromAxisAngle(v3(1, 0, 0), anklePitch);

    // Bump stance leg gains for single-leg support stability
    this.bumpStanceLegGains(io);

    // Override swing leg joints (after BalanceController has already set them)
    this.driveSwingLeg(io, foot, hipTarget, kneeTarget, ankleTarget);

    // -- Lift assist force --
    // Apply an upward force to the swing foot body during the lift phase.
    // This directly counteracts the foot's gravitational load (5 kg * 9.81 N)
    // and breaks the ground-contact pinch that prevents joint motors from
    // achieving lift-off. Decays with liftEnv so the foot is in free flight
    // during reach/landing.
    const footPart = foot === "LeftFoot" ? "LeftFoot" : "RightFoot";
    const liftForceY = this.cfg.swingLiftAssistN * liftEnv;
    if (liftForceY > 0.1) {
      io.applyForce(footPart, v3(0, liftForceY, 0));
    }

    // Debug: log swing progress once per ~6 frames to avoid console flood
    if (Math.round(this.tSwing * 60) % 6 === 0) {
      const footSample = io.sampleBody(footPart);
      const fc = io.footContact(foot);
      console.log(
        `[CatchStep SWING t=${t.toFixed(2)}]`,
        `ws:${weightShiftEnv.toFixed(2)} lift:${liftEnv.toFixed(2)} ext:${extendEnv.toFixed(2)}`,
        `hipP:${hipPitch.toFixed(2)} hipR:${hipRoll.toFixed(2)} knee:${kneeBend.toFixed(2)}`,
        `footY:${footSample.pos.y.toFixed(3)} gnd:${fc.grounded}`
      );
    }
  }

  private applyLandingLegTargets(io: RigIO): void {
    if (!this.stepFoot) return;

    const foot = this.stepFoot;

    // Near-neutral leg posture to accept ground contact.
    // Slight forward pitch to maintain step direction intent.
    const hipTarget = this.composeHipTarget(0.08, 0.0, foot);
    const kneeTarget = qFromAxisAngle(v3(1, 0, 0), this.cfg.kneeBendLand);
    const ankleTarget = qFromAxisAngle(v3(1, 0, 0), 0.0);

    this.bumpStanceLegGains(io);
    this.driveSwingLeg(io, foot, hipTarget, kneeTarget, ankleTarget);
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Compose a hip target quaternion from pitch (around +X) and roll (around +Z).
   * Roll sign is flipped for left vs right foot so the leg abducts outward.
   *
   * Composition order: roll first (abduction), then pitch (flexion).
   * In Hamilton convention, qMul(a, b) applies b first, then a, so:
   *   qMul(qPitch, qRoll) = "apply roll, then pitch" (intrinsic ZX order).
   */
  private composeHipTarget(
    pitchRad: number,
    rollRad: number,
    foot: FootName
  ): { x: number; y: number; z: number; w: number } {
    const side = footSideSign(foot);
    // Allow roll up to hipRollMax + weightShiftRollRad (the two can stack)
    const maxRoll = this.cfg.hipRollMax + this.cfg.weightShiftRollRad;
    const rollSigned = clamp(rollRad, -maxRoll, maxRoll) * side;

    const qPitch = qFromAxisAngle(v3(1, 0, 0), pitchRad);
    const qRoll = qFromAxisAngle(v3(0, 0, 1), rollSigned);

    return qMul(qPitch, qRoll);
  }

  /**
   * Drive the three joints of the swing leg (hip, knee, ankle) with the
   * given target rotations and swing-phase gains.
   */
  private driveSwingLeg(
    io: RigIO,
    foot: FootName,
    hipTarget: { x: number; y: number; z: number; w: number },
    kneeTarget: { x: number; y: number; z: number; w: number },
    ankleTarget: { x: number; y: number; z: number; w: number }
  ): void {
    const hipCmd = {
      targetLocalRot: hipTarget,
      kp: this.cfg.swingHipGains.kp,
      kd: this.cfg.swingHipGains.kd,
      maxTorque: this.cfg.swingHipGains.max,
    };
    const kneeCmd = {
      targetLocalRot: kneeTarget,
      kp: this.cfg.swingKneeGains.kp,
      kd: this.cfg.swingKneeGains.kd,
      maxTorque: this.cfg.swingKneeGains.max,
    };
    const ankleCmd = {
      targetLocalRot: ankleTarget,
      kp: this.cfg.swingAnkleGains.kp,
      kd: this.cfg.swingAnkleGains.kd,
      maxTorque: this.cfg.swingAnkleGains.max,
    };

    if (foot === "LeftFoot") {
      io.driveJoint("Root_LeftUpperLeg", hipCmd);
      io.driveJoint("LeftUpperLeg_LeftLowerLeg", kneeCmd);
      io.driveJoint("LeftLowerLeg_LeftFoot", ankleCmd);
    } else {
      io.driveJoint("Root_RightUpperLeg", hipCmd);
      io.driveJoint("RightUpperLeg_RightLowerLeg", kneeCmd);
      io.driveJoint("RightLowerLeg_RightFoot", ankleCmd);
    }
  }

  /**
   * Re-drive stance leg hip and knee with slightly higher gains.
   * BalanceController already set these; we bump them for single-leg stability.
   * Ankle is left under BalanceController control (primary balance actuator).
   */
  private bumpStanceLegGains(io: RigIO): void {
    if (!this.stanceFoot) return;

    const mult = this.cfg.stanceGainMult;
    const rest = q(0, 0, 0, 1);
    const kneeRest = qFromAxisAngle(v3(1, 0, 0), 0.12);

    const hipCmd = {
      targetLocalRot: rest,
      kp: 40 * mult,
      kd: 12 * mult,
      maxTorque: 120 * mult,
    };
    const kneeCmd = {
      targetLocalRot: kneeRest,
      kp: 80 * mult,
      kd: 14 * mult,
      maxTorque: 250 * mult,
    };

    if (this.stanceFoot === "LeftFoot") {
      io.driveJoint("Root_LeftUpperLeg", hipCmd);
      io.driveJoint("LeftUpperLeg_LeftLowerLeg", kneeCmd);
    } else {
      io.driveJoint("Root_RightUpperLeg", hipCmd);
      io.driveJoint("RightUpperLeg_RightLowerLeg", kneeCmd);
    }
  }
}
