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
//   - LIFT (t = 0..~0.4): Hip flexes forward (NEGATIVE pitch around +X)
//     regardless of step direction + knee bends deeply. This lifts the foot
//     off the ground.
//   - REACH (t = ~0.4..1.0): Hip moves toward the step-direction target, knee
//     extends, ankle goes neutral. This positions the foot over the target.
//   Ground contact is NOT checked during early swing (before liftMinFraction)
//   to prevent premature transitions before the foot clears the ground.

import type { Vec3 } from "@/lib/math";
import {
  clamp,
  clamp01,
  expSmoothingAlpha,
  horiz,
  lenXZ,
  lerp,
  normalizeXZ,
  qFromAxisAngle,
  qInverse,
  qMul,
  qRotateVec3,
  smoothstep,
  sub,
  v3,
} from "@/lib/math";
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

  // Urgency (0..1) -- how aggressively the step needs to act
  urgency: number;

  // Timers
  tState: number;
  tSwing: number;
  tLand: number;

  // Multi-step
  consecutiveSteps: number;
}

export const CATCH_STEP_DEFAULTS = {
  // Filtering
  filterTau: 0.03, // seconds -- fast filter to avoid adding latency

  // Trigger thresholds
  triggerErrorHi: 0.07, // meters -- COM-over-support error to start counting hold time
  triggerErrorLo: 0.05, // meters -- lower threshold if combined with high COM velocity
  triggerVelXZ: 0.4, // m/s -- COM velocity threshold for combined trigger
  triggerHoldTime: 0.02, // seconds -- error must exceed triggerErrorHi for this long

  // Hysteresis / anti-spam
  cooldownTime: 0.45, // seconds after a step completes before another can trigger
  settleTime: 0.2, // seconds of stable stance before returning to STAND

  // Maximum root tilt (radians) at which stepping is allowed. Beyond this
  // the rig is too far gone for a catch step to help. This is intentionally
  // lower than BalanceController's FALLEN_TILT_RAD (0.75 / 43 degrees).
  maxTiltForStepRad: 0.65, // ~37 degrees (higher for shorter rig)

  // Step placement: LIPM (Linear Inverted Pendulum Model) capture point.
  //
  // The capture point is the ground position where the foot must land to
  // bring the COM to rest above the new support. For a point-mass on a
  // massless leg of height h:
  //
  //   x_cp = x_com + v_com * sqrt(h / g)
  //
  // omega0 = sqrt(g / h) is the natural frequency of the inverted pendulum.
  // For leg height ~0.7m: omega0 ~ 3.74, 1/omega0 ~ 0.267s.
  //
  // The step target = capture point + safety margin that grows with urgency.
  // This replaces the old heuristic direction + distance + overshoot approach.
  lipmHeight: 0.44, // meters -- effective pendulum height (ankle-to-COM, R6 proportions)
  captureMarginK: 0.15, // meters -- extra distance beyond capture point, scaled by urgency
  captureMarginMax: 0.35, // meters -- max extra margin at full urgency

  // Minimum step distance: even if capture point is close, take at least
  // this distance to avoid stomping in place.
  stepDistMin: 0.12, // meters
  // Maximum step distance: physical limit of leg reach.
  stepDistMax: 0.35, // meters -- base max
  stepDistMaxUrgent: 0.65, // meters -- max distance at full urgency

  // Direction blending: the step direction is derived from the capture
  // point offset. kVel controls how much COM velocity biases the step
  // direction beyond the pure LIPM term (accounts for rotational momentum
  // and model inaccuracies).
  kVel: 0.15, // additional velocity blend on top of LIPM

  // Reasonable bounds relative to root position (world axes)
  maxLateralFromRoot: 0.35, // meters (base lateral clamp)
  maxLateralFromRootUrgent: 0.5, // meters -- wider lateral clamp at full urgency
  maxForwardFromRoot: 0.45, // meters (in +Z)
  maxForwardFromRootUrgent: 0.65, // meters at full urgency
  maxBackwardFromRoot: 0.45, // meters (in -Z) -- needs room for backward catch steps
  maxBackwardFromRootUrgent: 0.65, // meters at full urgency

  // Lateral step boost: lateral falls need the foot placed further out
  // than forward steps because the base of support is narrower side-to-side.
  // The boost scales with how lateral the step direction is (|dir.x|).
  lateralDistBoostK: 1.5, // multiplier on step distance for purely lateral steps
  minLateralSpread: 0.14, // meters -- roughly hip half-width (R6)

  // Swing timing
  prepTime: 0.06, // seconds -- weight-transfer phase before swing
  prepTimeUrgent: 0.02, // seconds -- minimal prep at full urgency
  swingTime: 0.3, // seconds -- fast swing to minimize fall time during flight
  swingTimeUrgent: 0.22, // seconds -- faster swing at full urgency
  swingTimeExtMax: 0.15, // seconds -- max extra swing time when foot hasn't reached target
  swingExtDistThresh: 0.15, // meters -- extend swing if foot is still this far from target
  landTime: 0.12, // seconds (time budget to find contact before fallback)

  // Lift sub-phase: ground contact is not checked until this absolute
  // time (seconds) has elapsed since swing start. Using an absolute floor
  // instead of a fraction prevents the foot from immediately triggering
  // STEP_LAND when urgency compresses swing time.
  liftMinTime: 0.15, // seconds -- absolute minimum before ground contact counts

  // Weight transfer: during STEP_PREP, the swing hip abducts to push
  // the root laterally over the stance foot, and the stance hip adducts
  // slightly to pull the root over. This unloads the swing foot so the
  // motors can lift it. Without transfer the swing foot bears half the
  // body weight and no motor gain can cleanly lift it.
  weightShiftRollRad: 0.2, // rad -- swing hip abduction during prep/early swing
  stanceAdductRollRad: 0.08, // rad -- stance hip adduction during prep (pulls root over)

  // Swing-phase gravity compensation: upward assist forces (Newtons)
  // applied to the swing leg bodies during the lift phase. The foot
  // lift force must exceed foot gravity AND overcome any remaining body
  // load that hasn't transferred to the stance side. The upper/lower
  // leg forces compensate their gravity so joint motors only fight
  // inertia, not dead weight.
  swingLiftAssistN: 70, // N -- foot force, above foot weight (2.5 kg * 9.81 = 24.5 N)
  swingUpperLegAssistN: 35, // N -- gravity comp for upper leg (3 kg * 9.81 = 29.4 N)
  swingLowerLegAssistN: 28, // N -- gravity comp for lower leg (2.5 kg * 9.81 = 24.5 N)

  // Forward reach force applied to the swing foot during the reach phase.
  // Helps the foot arrive at the step target -- joint motors alone often
  // can't overcome inertia of the extended leg at longer distances.
  swingReachForceN: 80, // N -- peak forward force on foot during reach (increased for lateral)

  // Joint posture parameters for swing (heuristic, all in radians)

  // Hip flexion lift: fixed forward pitch during lift phase to clear the foot.
  // This is the PRIMARY mechanism that gets the foot off the ground and is
  // applied regardless of step direction.
  hipFlexLift: 0.75, // rad (~43 deg) -- strong lift within 90-deg cone

  // Direction-dependent hip targets during reach phase.
  // hipPitchMax controls how far forward the leg reaches to place the foot
  // ahead of the COM. Larger values = longer steps.
  hipPitchMax: 0.75, // rad (~43 deg) -- forward reach for catch step
  hipPitchDistScale: 2.0, // multiplier on stepDistance to scale reach pitch
  hipRollMax: 0.6, // max hip abduction (outward) -- increased for lateral reach
  hipRollInwardMax: 0.08, // max hip adduction (inward) -- small to prevent leg crossing

  // Knee and ankle during lift vs landing
  kneeBendLift: 1.2, // rad (~69 deg) -- deep bend to shorten swing leg and clear ground
  kneeBendLand: 0.18, // slight bend at landing
  urgencyKneeLiftBoost: 0.35, // rad -- extra knee bend at full urgency during lift
  anklePitchLift: -0.4, // rad -- dorsiflex during lift (within joint limit of -0.436)

  // Drive gains for the swing leg joints.
  // The Rapier motor multiplies kp/kd by 10 internally. For a leg chain
  // with effective inertia ~1.4 kg*m^2, critical damping is ~107.
  // ~2x critical damping: responsive enough to reach targets in 0.3s
  // without overshooting into a kick.
  swingHipGains: { kp: 280, kd: 22, max: 700 },
  swingKneeGains: { kp: 320, kd: 18, max: 800 },
  swingAnkleGains: { kp: 120, kd: 14, max: 350 },

  // Stance leg gain multiplier during single-leg support.
  stanceGainMult: 2.5,

  // Active stance-hip COM shifting: during swing, the stance hip actively
  // adjusts pitch/roll to push the COM over the stance foot. This is the
  // hip strategy for single-leg balance -- without it the COM drifts
  // laterally away from the stance foot during swing, causing the
  // progressive lean that makes multi-step recovery fail.
  //
  // The stance hip target is computed from the COM-to-stanceFoot error:
  //   roll  = stanceHipShiftP * lateralError + stanceHipShiftD * lateralVel
  //   pitch = stanceHipShiftP * forwardError + stanceHipShiftD * forwardVel
  // Values are in joint-local space (relative to root).
  stanceHipShiftP: 6.0, // rad/m -- proportional gain for COM error -> hip angle
  stanceHipShiftD: 1.2, // rad/(m/s) -- derivative gain for COM velocity damping
  // Asymmetric roll limits: outward abduction (pushes COM toward stance foot)
  // needs more range than inward adduction (which crosses the midline and
  // destabilizes single-leg stance).
  stanceHipShiftRollOutward: 0.5, // rad (~29 deg) -- abduction, pushing COM over stance foot
  stanceHipShiftRollInward: 0.15, // rad (~9 deg) -- adduction, limited to avoid crossing midline
  stanceHipShiftPitchMax: 0.3, // rad (~17 deg) -- max stance hip pitch adjustment

  // Urgency scaling
  // urgency = clamp01((combinedSignal - urgencyLo) / (urgencyHi - urgencyLo))
  // where combinedSignal = errorMag + urgencyVelK * comVelXZ + urgencyTiltK * tiltRad
  urgencyLo: 0.08, // signal below this -> urgency = 0
  urgencyHi: 0.35, // signal at or above this -> urgency = 1
  urgencyVelK: 0.15, // weight for COM velocity in urgency signal
  urgencyTiltK: 0.25, // weight for root tilt in urgency signal

  // Gain/force multiplier at full urgency (lerp from 1.0 to this)
  urgencyGainMult: 1.6, // swing gain multiplier at full urgency
  urgencyLiftMult: 1.8, // lift assist force multiplier at full urgency

  // Cooldown at full urgency (lerp from cooldownTime to this)
  cooldownTimeUrgent: 0.12, // seconds -- fast re-step when urgent

  // Stance recovery: when balance error is small, the controller checks
  // if the feet are too close together and takes a small corrective step
  // to restore a stable, natural-looking stance.
  idealFootSpread: 0.28, // meters -- desired lateral distance between feet (R6 hip width)
  minFootSpreadForRecovery: 0.1, // meters -- trigger recovery step if spread is below this
  stanceRecoveryDelay: 0.6, // seconds of stable STAND before recovery is considered
  stanceRecoveryErrorMax: 0.04, // meters -- error must be below this for recovery
  stanceRecoveryVelMax: 0.15, // m/s -- COM velocity must be below this for recovery

  // Torso bias: during a step, the CatchStepController biases the
  // BalanceController's torso lean INTO the step direction. This prevents
  // the normal "oppose error" lean from pitching the torso backward
  // during a forward step, which causes a backward fall after landing.
  torsoBiasRad: 0.0, // rad -- peak torso lean INTO step direction (disabled for now)
  torsoBiasDecayTau: 0.25, // seconds -- exponential decay time constant during SETTLE

  // Multi-step recovery: when a single step isn't enough to recover,
  // the controller can take rapid consecutive steps. After each step,
  // if the error is still high the controller re-triggers with minimal
  // settle time and zero cooldown instead of waiting.
  maxConsecutiveSteps: 7, // hard cap on rapid re-stepping
  multiStepSettleTime: 0.2, // seconds -- brief settle between consecutive steps
  multiStepErrorThresh: 0.08, // meters -- error above this allows rapid re-step
  multiStepVelThresh: 0.6, // m/s -- COM velocity above this allows rapid re-step

  // Drift recovery: when the rig settles with a persistent moderate
  // error that the balance controller (ankle + torso lean) cannot
  // resolve -- typically a lateral offset where the pitch-only ankle
  // has no authority -- force a corrective step after a timeout.
  // This catches the dead zone between stable idle (error < 0.06m)
  // and the catch step trigger (error > 0.07m), and also handles
  // cases where anti-stomp boost raises the trigger above the error.
  driftRecoveryDelay: 2.0, // seconds of persistent error before forcing a step
  driftRecoveryErrorMin: 0.04, // meters -- error must exceed this to count as drifted
  driftRecoveryVelMax: 0.25, // m/s -- COM velocity must be below this (rig is settled)

  // Upper-body counter-rotation: during stepping, yaw the torso opposite
  // to the fall direction. The torso's angular momentum change creates a
  // reaction torque on the root that helps resist the topple. Most
  // effective for lateral falls where the base of support is narrowest.
  // The yaw target is clamped to the Root_Torso twist limit (16 deg = 0.28 rad).
  counterRotYawMax: 0.25, // rad -- peak yaw during stepping (~14 deg, within twist limit)
  counterRotUrgencyMin: 0.2, // urgency below this -> no counter-rotation
  counterRotDecayTau: 0.15, // seconds -- fast decay after step completes

  // Asymmetric arm extension: during stepping, the HIGH-side arm (opposite
  // the fall direction) extends outward/upward for balance while the
  // LOW-side (fall direction) arm tucks. This mimics a tightrope walker's
  // reflex: swinging the high-side arm upward generates angular momentum
  // that resists the topple rotation.
  // Arm joints have 70-deg swing range (1.22 rad) so there is plenty of room.
  //
  // The arm targets are expressed as pitch (around +X) and roll (around +Z)
  // in torso-local space. Roll sign convention:
  //   - Left arm:  negative roll = abduction (outward), positive = adduction
  //   - Right arm: positive roll = abduction (outward), negative = adduction
  armExtendRollMax: 1.0, // rad (~57 deg) -- high-side arm abduction (outward)
  armExtendPitchMax: 0.15, // rad (~9 deg) -- slight forward reach (positive = forward)
  armTuckRollMax: 0.1, // rad (~6 deg) -- low-side arm slight inward tuck
  armTuckPitchMax: 0.1, // rad (~6 deg) -- low-side arm slight forward
  armExtendUrgencyMin: 0.05, // urgency below this -> no arm extension
  armExtendDecayTau: 0.2, // seconds -- arm returns to rest after step
  armExtendGains: { kp: 45, kd: 9, max: 90 }, // match RigDefinition arm drive gains
} as const;

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function footSideSign(foot: FootName): number {
  // +1 for right foot, -1 for left foot.
  // Used to flip hip roll direction so each leg abducts outward.
  return foot === "RightFoot" ? +1 : -1;
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

export type CatchStepConfig = { [K in keyof typeof CATCH_STEP_DEFAULTS]: Widen<(typeof CATCH_STEP_DEFAULTS)[K]> };

export class CatchStepController {
  readonly balance: BalanceController;
  private cfg: CatchStepConfig;

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
  private urgency = 0; // 0..1 -- computed at step trigger, held for entire step

  // Per-state timers
  private tSwing = 0;
  private tLand = 0;
  private footWasAirborne = false; // tracks whether swing foot lifted off

  // Torso bias state (decays exponentially during SETTLE, cleared in STAND)
  private torsoBiasActive = false;

  // Multi-step tracking
  private consecutiveSteps = 0;

  // Anti-stomp: tracks how many step sequences have completed without
  // the rig reaching a truly stable idle (low error + low velocity for
  // a sustained period). Each fruitless sequence raises the effective
  // trigger threshold so the rig stops stomping and lets the ankle
  // strategy settle the residual offset.
  private recentSequences = 0;
  private stableIdleTime = 0;

  // Drift recovery: tracks how long the rig has been standing with a
  // persistent moderate error that ankle/torso lean cannot resolve.
  private driftTime = 0;

  private _debug: CatchStepDebug | null = null;
  get debug(): CatchStepDebug | null {
    return this._debug;
  }

  constructor(balance: BalanceController, cfg?: Partial<CatchStepConfig>) {
    this.balance = balance;
    this.cfg = { ...CATCH_STEP_DEFAULTS, ...cfg };
  }

  /** Merge partial overrides into the live config. */
  updateConfig(overrides: Partial<CatchStepConfig>): void {
    Object.assign(this.cfg, overrides);
  }

  update(io: RigIO, dt: number): void {
    // Update torso bias BEFORE balance.update() so it takes effect this frame.
    this.updateTorsoBias(io, dt);

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
      this.errorMagF = lerp(this.errorMagF, errMag, alpha);
      this.comVelXZF = lerp(this.comVelXZF, comVelXZ, alpha);
    }

    // Anti-stomp: track how long the rig has been in a truly stable
    // idle state (STAND with low error and low velocity). Reset the
    // sequence counter once the rig proves it can stand still.
    if (this.state === "STAND" && this.errorMagF < 0.06 && this.comVelXZF < 0.15) {
      this.stableIdleTime += dt;
      if (this.stableIdleTime > 0.5) {
        this.recentSequences = 0;
      }
    } else {
      this.stableIdleTime = 0;
    }

    // Safety valve: if the rig is stuck in STAND with a large error for
    // too long, the anti-stomp boost is preventing a needed corrective
    // step. Reset the counter so a step can fire.
    if (this.state === "STAND" && this.recentSequences > 0 && this.errorMagF > 0.1 && this.tState > 1.5) {
      console.log("[CatchStep] anti-stomp safety valve: resetting recentSequences", this.recentSequences);
      this.recentSequences = 0;
    }

    // hipLateralScale is left at its default (0) -- hip lateral balance
    // is currently disabled. Opposite hip roll tilts the pelvis visually
    // without effectively shifting COM. Catch steps and torso lean PD
    // handle lateral correction instead.

    // Effective trigger threshold: raised by 0.02m per recent fruitless
    // sequence, up to +0.06m (3 sequences). This makes the controller
    // progressively less eager to re-step when steps aren't helping.
    const triggerBoost = Math.min(this.recentSequences * 0.02, 0.06);
    const effectiveTriggerHi = this.cfg.triggerErrorHi + triggerBoost;
    const effectiveTriggerLo = this.cfg.triggerErrorLo + triggerBoost;

    // Hold timer: "error has been above triggerErrorHi for X seconds"
    if (this.errorMagF > effectiveTriggerHi) {
      this.overErrorTime += dt;
    } else {
      // Decay quickly to avoid sticky triggering
      this.overErrorTime = Math.max(0, this.overErrorTime - dt * 2.0);
    }

    // Query BalanceController's fallen state to suppress stepping.
    // BalanceController already computes tilt with hysteresis -- reuse
    // that instead of duplicating measurement logic.
    const balanceFallen = bdbg ? bdbg.fallen : false;
    const tiltTooHigh = bdbg ? bdbg.tiltRad > this.cfg.maxTiltForStepRad : false;

    // Drift recovery: track how long the rig has been standing with a
    // persistent moderate error. The balance controller (ankle pitch +
    // torso lean) has had time to act; if the error persists, only a
    // corrective step can resolve it (common for lateral offsets where
    // the pitch-only ankle has no authority).
    if (
      this.state === "STAND" &&
      !balanceFallen &&
      !tiltTooHigh &&
      this.errorMagF > this.cfg.driftRecoveryErrorMin &&
      this.comVelXZF < this.cfg.driftRecoveryVelMax
    ) {
      this.driftTime += dt;
    } else {
      this.driftTime = 0;
    }

    // State machine
    this.tState += dt;

    switch (this.state) {
      case "STAND": {
        // Don't trigger a step if tilt is too high or BalanceController
        // has entered FALLEN. Stepping while toppled just flails the legs.
        const shouldTrigger =
          !balanceFallen &&
          !tiltTooHigh &&
          this.cooldown <= 0 &&
          (this.overErrorTime >= this.cfg.triggerHoldTime ||
            (this.errorMagF > effectiveTriggerLo && this.comVelXZF > this.cfg.triggerVelXZ));

        // Drift recovery: if the balance controller has been unable to
        // resolve a moderate error for driftRecoveryDelay seconds, force
        // a corrective step. Reset anti-stomp counter since the error is
        // genuinely persistent, not a stomp cycle artifact.
        const driftTrigger = !shouldTrigger && this.cooldown <= 0 && this.driftTime >= this.cfg.driftRecoveryDelay;

        if (shouldTrigger || driftTrigger) {
          if (driftTrigger) {
            console.log(
              `[CatchStep] drift recovery: err=${this.errorMagF.toFixed(3)}`,
              `driftTime=${this.driftTime.toFixed(2)}s, resetting anti-stomp`
            );
            this.recentSequences = 0;
            this.driftTime = 0;
          }
          this.enterStepPrep(io, err);
        } else if (this.cooldown <= 0 && !balanceFallen && !tiltTooHigh) {
          // Stance recovery: if error is small and feet are too close,
          // take a small step to widen stance to ideal spread.
          this.tryStanceRecovery(io);
        }
        break;
      }

      case "STEP_PREP": {
        // Once committed to a step, only abort on full fallen (43 degrees).
        // The lower tilt threshold prevents triggering but should not
        // cancel a step already in progress.
        if (balanceFallen) {
          this.enterSettle();
          break;
        }

        // Drive swing hip into abduction to shift COM over stance foot.
        // This unloads the swing foot so it can be lifted.
        this.applyWeightShiftTargets(io);

        const effectivePrepTime = lerp(this.cfg.prepTime, this.cfg.prepTimeUrgent, this.urgency);
        if (this.tState >= effectivePrepTime) {
          this.enterStepSwing();
        }
        break;
      }

      case "STEP_SWING": {
        // Do NOT abort on high tilt during swing. The step IS the recovery
        // mechanism -- cancelling it mid-flight makes things worse.

        this.tSwing += dt;
        this.applySwingLegTargets(io);

        // Track whether the foot has lifted off at any point during the
        // swing. Landing detection only fires after the foot was airborne
        // at least once -- prevents "never lifted" from being misread as
        // "already landed".
        if (this.stepFoot) {
          const fc = io.footContact(this.stepFoot);
          if (!fc.grounded) {
            this.footWasAirborne = true;
          }

          const effectiveSwingTime = lerp(this.cfg.swingTime, this.cfg.swingTimeUrgent, this.urgency);
          const canDetectLanding = this.footWasAirborne && this.tSwing >= this.cfg.liftMinTime;

          // Extend swing if the foot hasn't reached the target yet.
          // Without this, the swing expires at effectiveSwingTime and
          // the foot lands wherever it happens to be -- often far short.
          let timeUp = this.tSwing >= effectiveSwingTime;
          if (timeUp && this.stepTarget) {
            const footPos = io.sampleBody(this.stepFoot).pos;
            const dxT = footPos.x - this.stepTarget.x;
            const dzT = footPos.z - this.stepTarget.z;
            const distToTarget = Math.sqrt(dxT * dxT + dzT * dzT);
            const maxExt = effectiveSwingTime + this.cfg.swingTimeExtMax;
            if (distToTarget > this.cfg.swingExtDistThresh && this.tSwing < maxExt) {
              timeUp = false; // keep swinging
            }
          }

          if ((fc.grounded && canDetectLanding) || timeUp) {
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
        // BalanceController is running; wait for stability.
        // If error is still high and we haven't exceeded the consecutive
        // step cap, re-trigger a step with minimal delay instead of
        // returning to STAND and waiting through the full cooldown.
        const needsMoreSteps =
          this.consecutiveSteps < this.cfg.maxConsecutiveSteps &&
          !balanceFallen &&
          !tiltTooHigh &&
          (this.errorMagF > this.cfg.multiStepErrorThresh || this.comVelXZF > this.cfg.multiStepVelThresh);

        const effectiveSettleTime = needsMoreSteps ? this.cfg.multiStepSettleTime : this.cfg.settleTime;

        if (this.tState >= effectiveSettleTime) {
          if (needsMoreSteps) {
            // Rapid re-step: skip STAND, go directly to new STEP_PREP
            this.cooldown = 0;
            this.enterStepPrep(io, err);
          } else {
            this.enterStand();
          }
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

      urgency: this.urgency,

      tState: this.tState,
      tSwing: this.tSwing,
      tLand: this.tLand,

      consecutiveSteps: this.consecutiveSteps,
    };
  }

  // --------------------------------------------------------------------------
  // Torso bias management
  //
  // During stepping states, bias the BalanceController's torso lean INTO
  // the step direction. This counteracts the normal "oppose error" lean
  // that pitches the torso backward during forward steps (and vice versa).
  // The bias decays exponentially during SETTLE and is cleared in STAND.
  // --------------------------------------------------------------------------

  private updateTorsoBias(io: RigIO, dt: number): void {
    if (this.stepDir && (this.state === "STEP_PREP" || this.state === "STEP_SWING" || this.state === "STEP_LAND")) {
      // During stepping, suppress the error-based PD lean -- the step IS
      // the recovery mechanism, so the torso fighting the error is
      // counterproductive (it leans away from the step direction).
      // Keep a mild bias INTO the step direction for posture.
      this.balance.torsoLeanScale = 0.2; // suppress 80% of error-based lean
      const bias = this.cfg.torsoBiasRad;

      // Transform world-space step direction into root-local frame so
      // that torso pitch/roll biases are correct at any yaw orientation.
      const rootSample = io.sampleBody("Root");
      const rootInv = qInverse(rootSample.rot);
      const localDir = qRotateVec3(rootInv, this.stepDir);

      this.balance.torsoBiasPitch = localDir.z * bias;
      // Roll bias is NEGATED: lean AWAY from the step direction laterally
      // (toward the stance foot). Leaning into a lateral fall accelerates
      // the topple; leaning toward the stance foot maintains single-leg
      // balance while the swing foot catches.
      this.balance.torsoBiasRoll = -localDir.x * bias;

      // Upper-body counter-rotation: yaw the torso OPPOSITE to the step
      // direction's lateral component. For a leftward fall (stepDir.x < 0),
      // yaw right (positive Y). The torso's angular momentum change
      // generates a reaction torque opposing the lateral topple.
      // Scale with urgency so calm steps don't twist unnecessarily.
      if (this.urgency > this.cfg.counterRotUrgencyMin) {
        const urgencyFactor = clamp01(
          (this.urgency - this.cfg.counterRotUrgencyMin) / (1.0 - this.cfg.counterRotUrgencyMin)
        );
        // Counter-rotation uses the root-local lateral component.
        const yawTarget = clamp(
          -localDir.x * this.cfg.counterRotYawMax * urgencyFactor,
          -this.cfg.counterRotYawMax,
          this.cfg.counterRotYawMax
        );
        this.balance.torsoYawBias = yawTarget;
      } else {
        this.balance.torsoYawBias = 0;
      }

      // Asymmetric arm extension: extend the HIGH-side arm (opposite the
      // fall direction) outward/upward, like a tightrope walker. The
      // angular momentum from swinging the high-side arm opposes the
      // topple rotation. The low-side (fall direction) arm tucks.
      // localDir.x > 0 -> falling right in root frame -> left arm extends.
      this.updateArmExtension(localDir);

      this.torsoBiasActive = true;
    } else if (this.torsoBiasActive) {
      // Restore lean scale and decay bias during SETTLE and STAND
      const decay = Math.exp(-dt / this.cfg.torsoBiasDecayTau);
      this.balance.torsoLeanScale = lerp(1.0, this.balance.torsoLeanScale, decay);
      this.balance.torsoBiasPitch *= decay;
      this.balance.torsoBiasRoll *= decay;

      // Counter-rotation decays faster (separate time constant)
      const crDecay = Math.exp(-dt / this.cfg.counterRotDecayTau);
      this.balance.torsoYawBias *= crDecay;

      // Arm extension decay: interpolate targets toward zero (rest pose)
      const armDecay = Math.exp(-dt / this.cfg.armExtendDecayTau);
      this.decayArmTargets(armDecay);

      // Clear when small enough
      const biasSmall = Math.abs(this.balance.torsoBiasPitch) < 0.005 && Math.abs(this.balance.torsoBiasRoll) < 0.005;
      const scaleRestored = this.balance.torsoLeanScale > 0.99;
      const yawSmall = Math.abs(this.balance.torsoYawBias) < 0.005;
      const armsSmall = this.armTargetsSmall();
      if (biasSmall && scaleRestored && yawSmall && armsSmall) {
        this.balance.torsoBiasPitch = 0;
        this.balance.torsoBiasRoll = 0;
        this.balance.torsoLeanScale = 1.0;
        this.balance.torsoYawBias = 0;
        this.balance.leftArmTarget = null;
        this.balance.rightArmTarget = null;
        this.balance.armGainsOverride = null;
        this.torsoBiasActive = false;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Arm extension helpers
  //
  // During stepping, the fall-side arm extends outward/upward to generate
  // a corrective angular momentum and provide a visual balance reflex.
  // The opposite arm tucks slightly. Both targets are expressed as
  // {pitch, roll} in torso-local space and applied by BalanceController.
  // --------------------------------------------------------------------------

  /**
   * Compute and set arm targets based on the current step direction and
   * urgency. Called each frame during STEP_PREP/SWING/LAND states.
   *
   * HIGH-side arm extends: if falling right (localDirX > 0), the LEFT arm
   * (high side) extends outward/upward. This is the tightrope-walker
   * reflex -- swinging the high-side arm generates angular momentum that
   * opposes the topple rotation.
   *
   * For forward/backward falls (laterality near 0), both arms extend
   * symmetrically at reduced magnitude.
   *
   * Roll sign convention:
   *   Left arm:  negative roll = abduction (outward)
   *   Right arm: positive roll = abduction (outward)
   *
   * @param localDir Step direction in root-local frame. Uses localDir.x
   *   to determine lateral fall direction (positive = rightward).
   */
  private updateArmExtension(localDir: Vec3): void {
    if (!this.stepDir) return;

    if (this.urgency < this.cfg.armExtendUrgencyMin) {
      return;
    }

    const urgencyFactor = clamp01((this.urgency - this.cfg.armExtendUrgencyMin) / (1.0 - this.cfg.armExtendUrgencyMin));

    // Laterality: how much of the fall is sideways vs front/back.
    // |localDir.x| = 1 for pure lateral, 0 for pure forward/backward.
    const laterality = Math.abs(localDir.x);

    // High-side arm: full extension scaled by urgency.
    // For lateral falls, extend strongly on the high side.
    // For forward/backward falls, partial symmetric extension.
    const extendScale = urgencyFactor * lerp(0.5, 1.0, laterality);
    const extendRoll = this.cfg.armExtendRollMax * extendScale;
    const extendPitch = this.cfg.armExtendPitchMax * extendScale;

    // Low-side (fall-direction) arm: mild inward tuck.
    const tuckScale = urgencyFactor * lerp(0.3, 1.0, laterality);
    const tuckRoll = this.cfg.armTuckRollMax * tuckScale;
    const tuckPitch = this.cfg.armTuckPitchMax * tuckScale;

    // Assign targets. The HIGH-side arm is OPPOSITE the fall direction.
    // localDir.x > 0 -> falling right in root frame -> high side is LEFT arm.
    if (localDir.x >= 0) {
      // Falling right: LEFT arm (high side) extends, RIGHT arm (low side) tucks.
      this.balance.leftArmTarget = {
        pitch: extendPitch,
        roll: -extendRoll, // negative = abduction for left arm
      };
      this.balance.rightArmTarget = {
        pitch: tuckPitch,
        roll: -tuckRoll, // negative = adduction for right arm
      };
    } else {
      // Falling left: RIGHT arm (high side) extends, LEFT arm (low side) tucks.
      this.balance.rightArmTarget = {
        pitch: extendPitch,
        roll: extendRoll, // positive = abduction for right arm
      };
      this.balance.leftArmTarget = {
        pitch: tuckPitch,
        roll: tuckRoll, // positive = adduction for left arm
      };
    }

    // Override arm drive gains for more responsive arm movement during stepping.
    this.balance.armGainsOverride = this.cfg.armExtendGains;
  }

  /**
   * Decay arm targets toward zero (rest pose) using exponential smoothing.
   * Called during SETTLE to gradually return arms to neutral.
   */
  private decayArmTargets(decay: number): void {
    if (this.balance.leftArmTarget) {
      this.balance.leftArmTarget = {
        pitch: this.balance.leftArmTarget.pitch * decay,
        roll: this.balance.leftArmTarget.roll * decay,
      };
    }
    if (this.balance.rightArmTarget) {
      this.balance.rightArmTarget = {
        pitch: this.balance.rightArmTarget.pitch * decay,
        roll: this.balance.rightArmTarget.roll * decay,
      };
    }
  }

  /**
   * Check if arm targets are close enough to zero to clear.
   */
  private armTargetsSmall(): boolean {
    const lt = this.balance.leftArmTarget;
    const rt = this.balance.rightArmTarget;
    if (lt && (Math.abs(lt.pitch) > 0.01 || Math.abs(lt.roll) > 0.01)) return false;
    if (rt && (Math.abs(rt.pitch) > 0.01 || Math.abs(rt.roll) > 0.01)) return false;
    return true;
  }

  // --------------------------------------------------------------------------
  // State transitions
  // --------------------------------------------------------------------------

  private enterStand(): void {
    console.log("[CatchStep] -> STAND", `steps:${this.consecutiveSteps}`, `seqCount:${this.recentSequences}`);
    this.state = "STAND";
    this.tState = 0;
    this.tSwing = 0;
    this.tLand = 0;

    // Track fruitless sequences for anti-stomp logic. Only count if
    // we actually took steps (consecutiveSteps > 0). The counter is
    // reset once the rig reaches a stable idle in the state machine.
    if (this.consecutiveSteps > 0) {
      this.recentSequences++;
    }
    this.consecutiveSteps = 0;

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

    // Initial step direction for foot selection: use error + velocity to
    // determine which foot is trailing. This direction is preliminary --
    // the actual step target will be derived from the LIPM capture point.
    const errXZ = horiz(errorFiltered);
    const vel = io.comVelWorld();
    const velXZ = v3(vel.x, 0, vel.z);

    const dirRaw = v3(errXZ.x + 0.3 * velXZ.x, 0, errXZ.z + 0.3 * velXZ.z);
    const dir = normalizeXZ(dirRaw);
    this.stepDir = dir; // preliminary; overridden by LIPM direction below

    // Pick which foot steps.
    // If only one foot is grounded, step the airborne one.
    // When both are grounded, score each foot by how far it trails behind
    // the COM in the step direction. The trailing foot is better: it is
    // already unloaded, and stepping it forward covers more distance.
    // A small lateral bias breaks ties so the rig prefers the lean-side foot.
    let stepFoot: FootName;
    if (leftFC.grounded && !rightFC.grounded) {
      stepFoot = "RightFoot";
    } else if (rightFC.grounded && !leftFC.grounded) {
      stepFoot = "LeftFoot";
    } else {
      const comProj = horiz(io.comWorld());
      const leftPos = horiz(io.sampleBody("LeftFoot").pos);
      const rightPos = horiz(io.sampleBody("RightFoot").pos);

      // Project each foot's offset from COM onto the step direction.
      // Negative = foot is behind the COM along step dir (trailing).
      const leftAlong = (leftPos.x - comProj.x) * dir.x + (leftPos.z - comProj.z) * dir.z;
      const rightAlong = (rightPos.x - comProj.x) * dir.x + (rightPos.z - comProj.z) * dir.z;

      // Score: more negative (further behind COM) is better.
      // Negate so that "behind" gives a higher score.
      //
      // For lateral falls, the ipsilateral foot (same side as the fall)
      // MUST be selected -- stepping the contralateral foot across the
      // body can't widen the base of support in the fall direction.
      // The same-side bonus scales with laterality (|localDir.x|) in the
      // root's local frame so it works regardless of yaw orientation.
      const trailWeight = 1.0;
      const rootInvForSel = qInverse(root.rot);
      const localDirForSel = qRotateVec3(rootInvForSel, dir);
      const laterality = Math.abs(localDirForSel.x);
      const sameSideK = 0.8; // strong ipsilateral preference for lateral steps
      const leftScore = -leftAlong * trailWeight + (localDirForSel.x < 0 ? sameSideK * laterality : 0);
      const rightScore = -rightAlong * trailWeight + (localDirForSel.x >= 0 ? sameSideK * laterality : 0);

      stepFoot = leftScore >= rightScore ? "LeftFoot" : "RightFoot";
    }

    this.stepFoot = stepFoot;
    this.stanceFoot = stepFoot === "LeftFoot" ? "RightFoot" : "LeftFoot";

    // Use the step foot's current position as the origin. The step target
    // is placed along the step direction from this foot so both the debug
    // line and the physics target are consistent.
    const stepFC = stepFoot === "LeftFoot" ? leftFC : rightFC;
    const stepFootSample = io.sampleBody(stepFoot);
    const stepFootPos = stepFC.avgPoint ? horiz(stepFC.avgPoint) : horiz(stepFootSample.pos);
    this.supportPoint = stepFootPos;

    // -- Urgency (0..1) --
    // Combines error magnitude, COM velocity, and root tilt into a single
    // signal. Higher urgency -> longer steps, faster timing, stronger forces.
    const tiltRad = this.balance.debug?.tiltRad ?? 0;
    const urgencySignal = this.errorMagF + this.cfg.urgencyVelK * this.comVelXZF + this.cfg.urgencyTiltK * tiltRad;
    this.urgency = clamp01((urgencySignal - this.cfg.urgencyLo) / (this.cfg.urgencyHi - this.cfg.urgencyLo));

    // -- LIPM Capture Point --
    // The capture point is the ground position where the foot must land
    // to bring the COM velocity to zero above the new support.
    //
    // omega0 = sqrt(g / h), where h is the effective pendulum height.
    // x_cp = x_com + v_com / omega0
    //
    // We compute this in 2D (XZ plane). The step target is the capture
    // point plus a safety margin that grows with urgency.
    const g = 9.81;
    const omega0 = Math.sqrt(g / this.cfg.lipmHeight); // ~3.74 rad/s for h=0.7m
    const invOmega0 = 1.0 / omega0; // ~0.267s

    const comProj = horiz(io.comWorld());
    const comVelFull = io.comVelWorld();
    const comVelXZVec = v3(comVelFull.x, 0, comVelFull.z);

    // Capture point in world XZ coordinates
    const cpX = comProj.x + comVelXZVec.x * invOmega0;
    const cpZ = comProj.z + comVelXZVec.z * invOmega0;

    // The step target starts at the capture point. Add a safety margin
    // along the step direction to account for model inaccuracies and
    // ensure the foot lands slightly past the capture point.
    // Also add extra velocity-based extension (kVel) to handle angular
    // momentum not captured by the point-mass LIPM model.
    const cpOffsetX = cpX - stepFootPos.x + this.cfg.kVel * comVelXZVec.x;
    const cpOffsetZ = cpZ - stepFootPos.z + this.cfg.kVel * comVelXZVec.z;

    // Step direction from foot to capture point (this is where we NEED to go)
    const cpDist = Math.sqrt(cpOffsetX * cpOffsetX + cpOffsetZ * cpOffsetZ);
    const cpDir = cpDist > 1e-4 ? v3(cpOffsetX / cpDist, 0, cpOffsetZ / cpDist) : dir;

    // Override step direction with capture-point-derived direction.
    // This ensures the foot aims at where the COM will be, not just
    // where the error vector points now.
    this.stepDir = cpDir;

    // Step distance = distance to capture point + urgency-scaled margin.
    // Lateral boost: side steps need extra reach because the base of
    // support is narrower in the lateral direction. Use root-local frame
    // to determine laterality so the boost works at any yaw.
    const rootInvForLat = qInverse(root.rot);
    const cpDirLocal = qRotateVec3(rootInvForLat, cpDir);
    const laterality = Math.abs(cpDirLocal.x);
    const lateralBoost = 1.0 + (this.cfg.lateralDistBoostK - 1.0) * laterality;
    const margin = lerp(this.cfg.captureMarginK, this.cfg.captureMarginMax, this.urgency);
    const distMax = lerp(this.cfg.stepDistMax, this.cfg.stepDistMaxUrgent, this.urgency);
    const dist = clamp((cpDist + margin) * lateralBoost, this.cfg.stepDistMin, distMax);
    this.stepDistance = dist;

    // Widen clamp bounds at high urgency so the target isn't pulled back.
    const maxFwd = lerp(this.cfg.maxForwardFromRoot, this.cfg.maxForwardFromRootUrgent, this.urgency);
    const maxLat = lerp(this.cfg.maxLateralFromRoot, this.cfg.maxLateralFromRootUrgent, this.urgency);
    const maxBack = lerp(this.cfg.maxBackwardFromRoot, this.cfg.maxBackwardFromRootUrgent, this.urgency);

    // Target position = step foot origin + captureDir * dist.
    // Clamp relative to root in root-local frame so that forward/lateral
    // limits are correct regardless of the rig's yaw orientation.
    const targetXZ = v3(stepFootPos.x + cpDir.x * dist, 0, stepFootPos.z + cpDir.z * dist);
    const rootInv = qInverse(root.rot);
    const offsetWorld = sub(targetXZ, horiz(root.pos));
    const offsetLocal = qRotateVec3(rootInv, offsetWorld);

    // Enforce minimum lateral spread in root-local X: the step foot's
    // target must be at least minLateralSpread from root center on the
    // foot's side. This prevents "stomping in place" when stepping the
    // lean-side foot during a lateral fall.
    const sideSign = footSideSign(stepFoot); // +1 right, -1 left
    const minLocalX = sideSign * this.cfg.minLateralSpread;
    let localX = offsetLocal.x;
    if (sideSign > 0) {
      localX = Math.max(localX, minLocalX);
    } else {
      localX = Math.min(localX, minLocalX);
    }

    const clampedLocalX = clamp(localX, -maxLat, maxLat);
    const clampedLocalZ = clamp(offsetLocal.z, -maxBack, maxFwd);
    const clampedLocal = v3(clampedLocalX, 0, clampedLocalZ);
    const clampedWorld = qRotateVec3(root.rot, clampedLocal);
    const clampedXZ = v3(root.pos.x + clampedWorld.x, 0, root.pos.z + clampedWorld.z);
    this.stepTarget = this.raycastToGround(io, clampedXZ, root.pos.y);

    // Prevent immediate re-triggering while stepping
    this.cooldown = Math.max(this.cooldown, 0.1);

    this.consecutiveSteps++;

    console.log(
      "[CatchStep] -> STEP_PREP",
      `foot:${stepFoot}`,
      `cpDir:(${cpDir.x.toFixed(2)},${cpDir.z.toFixed(2)})`,
      `dist:${dist.toFixed(3)} cpDist:${cpDist.toFixed(3)}`,
      `urgency:${this.urgency.toFixed(2)}`,
      `err:${this.errorMagF.toFixed(3)}`,
      `vel:${this.comVelXZF.toFixed(3)}`,
      `step#${this.consecutiveSteps}`
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
    this.footWasAirborne = false;
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

    this.cooldown = lerp(this.cfg.cooldownTime, this.cfg.cooldownTimeUrgent, this.urgency);

    // Immediately restore torso lean scale so the balancer has full PD
    // authority during settle. Without this, the suppressed lean (0.2)
    // prevents the balancer from correcting small residual errors,
    // causing unnecessary re-steps.
    this.balance.torsoLeanScale = 1.0;

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
  // Stance recovery
  //
  // When the rig has settled with feet too close together, take a small
  // corrective step to widen the stance to idealFootSpread. This prevents
  // the awkward "feet touching" posture after a catch step lands and
  // improves stability for subsequent perturbations.
  // --------------------------------------------------------------------------

  private tryStanceRecovery(io: RigIO): void {
    // Only attempt after spending enough time stable in STAND
    if (this.tState < this.cfg.stanceRecoveryDelay) return;

    // Only when truly stable -- low error, low velocity
    if (this.errorMagF > this.cfg.stanceRecoveryErrorMax) return;
    if (this.comVelXZF > this.cfg.stanceRecoveryVelMax) return;

    const leftFC = io.footContact("LeftFoot");
    const rightFC = io.footContact("RightFoot");

    // Both feet must be grounded
    if (!leftFC.grounded || !rightFC.grounded) return;

    const leftPos = horiz(io.sampleBody("LeftFoot").pos);
    const rightPos = horiz(io.sampleBody("RightFoot").pos);

    // Compute lateral spread in root-local frame so the measurement
    // is correct regardless of the rig's yaw orientation.
    // Root-local X is the rig's lateral axis.
    const root = io.sampleBody("Root");
    const rootInv = qInverse(root.rot);
    const leftLocal = qRotateVec3(rootInv, sub(leftPos, horiz(root.pos)));
    const rightLocal = qRotateVec3(rootInv, sub(rightPos, horiz(root.pos)));

    // Lateral spread in root-local X (right foot should be positive, left negative)
    const spread = rightLocal.x - leftLocal.x;

    // Only trigger if feet are too close
    if (spread >= this.cfg.minFootSpreadForRecovery) return;

    // Pick the foot that is more inboard (closer to center in root-local X).
    const leftOffset = leftLocal.x; // should be negative (left)
    const rightOffset = rightLocal.x; // should be positive (right)

    // The foot that is less far from center is the one to move
    let stepFoot: FootName;
    if (Math.abs(leftOffset) < Math.abs(rightOffset)) {
      stepFoot = "LeftFoot";
    } else {
      stepFoot = "RightFoot";
    }

    const sideSign = footSideSign(stepFoot);
    const footPos = stepFoot === "LeftFoot" ? leftPos : rightPos;

    // Ideal position in root-local frame, then transform back to world
    const idealLocalX = (sideSign * this.cfg.idealFootSpread) / 2;
    const footLocal = stepFoot === "LeftFoot" ? leftLocal : rightLocal;
    const offsetLocal = v3(idealLocalX - footLocal.x, 0, 0);
    const offsetWorld = qRotateVec3(root.rot, offsetLocal);

    // Step direction: lateral outward in root frame, projected to world XZ
    const dirWorld = normalizeXZ(v3(offsetWorld.x, 0, offsetWorld.z));
    const targetXZ = v3(footPos.x + offsetWorld.x, 0, footPos.z + offsetWorld.z);

    // Set up the step plan
    this.stepFoot = stepFoot;
    this.stanceFoot = stepFoot === "LeftFoot" ? "RightFoot" : "LeftFoot";
    this.stepDir = dirWorld;
    this.supportPoint = footPos;
    this.stepDistance = Math.abs(idealLocalX - footLocal.x);
    this.urgency = 0; // calm, small step
    this.stepTarget = this.raycastToGround(io, targetXZ, root.pos.y);
    this.cooldown = Math.max(this.cooldown, 0.1);

    console.log(
      "[CatchStep] -> STEP_PREP (stance recovery)",
      `foot:${stepFoot}`,
      `spread:${spread.toFixed(3)}`,
      `dist:${this.stepDistance.toFixed(3)}`
    );

    this.state = "STEP_PREP";
    this.tState = 0;
    this.tSwing = 0;
    this.tLand = 0;
  }

  // --------------------------------------------------------------------------
  // Support/target helpers
  // --------------------------------------------------------------------------

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
    const t = clamp01(this.tState / this.cfg.prepTime);
    const rollRad = this.cfg.weightShiftRollRad * t;

    // Swing hip: abduction only (no pitch yet)
    const swingHipTarget = this.composeHipTarget(0, rollRad, this.stepFoot);
    const swingHipCmd = {
      targetLocalRot: swingHipTarget,
      kp: this.cfg.swingHipGains.kp,
      kd: this.cfg.swingHipGains.kd,
      maxTorque: this.cfg.swingHipGains.max,
    };

    if (this.stepFoot === "LeftFoot") {
      io.driveJoint("Root_LeftUpperLeg", swingHipCmd);
    } else {
      io.driveJoint("Root_RightUpperLeg", swingHipCmd);
    }

    // Stance hip: slight adduction (roll inward) to pull the root
    // over the stance foot. Combined with swing abduction, this
    // approximately doubles the lateral COM shift rate.
    const stanceAdductRad = this.cfg.stanceAdductRollRad * t;
    const stanceHipTarget = this.composeHipTarget(0, -stanceAdductRad, this.stanceFoot);
    const mult = this.cfg.stanceGainMult;
    const stanceHipCmd = {
      targetLocalRot: stanceHipTarget,
      kp: 40 * mult,
      kd: 12 * mult,
      maxTorque: 120 * mult,
    };

    if (this.stanceFoot === "LeftFoot") {
      io.driveJoint("Root_LeftUpperLeg", stanceHipCmd);
    } else {
      io.driveJoint("Root_RightUpperLeg", stanceHipCmd);
    }

    // Anchor stance knee
    this.bumpStanceKneeGains(io);
  }

  // --------------------------------------------------------------------------
  // Joint driving during step
  //
  // Envelopes:
  //   weightShiftEnv: continues abduction from prep, decays mid-swing.
  //   liftEnv: trapezoidal -- ramps up quickly, sustains, ramps down.
  //   reachEnv / extendEnv: transition to directional target and leg extension.
  //
  // Additionally, upward gravity-compensation forces are applied to the
  // swing leg bodies during the lift phase. The foot force overcomes foot
  // weight plus remaining body load; upper/lower leg forces reduce the
  // gravitational burden on the hip and knee motors.
  // --------------------------------------------------------------------------

  private applySwingLegTargets(io: RigIO): void {
    if (!this.stepFoot || !this.stepTarget || !this.stepDir) return;

    const foot = this.stepFoot;

    // Phase 0..1 over effective swing time (urgency-scaled)
    const effectiveSwingTime = lerp(this.cfg.swingTime, this.cfg.swingTimeUrgent, this.urgency);
    const t = clamp01(this.tSwing / effectiveSwingTime);

    // -- Weight-shift envelope --
    // Starts at 1.0 (continuous from STEP_PREP), holds through early swing
    // while the foot is lifting, decays once foot is airborne.
    const weightShiftEnv = 1.0 - smoothstep(0.3, 0.65, t);

    // -- Lift envelope (trapezoidal) --
    // Quick ramp to 1.0 in t=[0, 0.12], sustained hold, ramp down in t=[0.35, 0.6].
    // The lift decays as the reach takes over, keeping the foot path
    // arcing forward rather than dropping straight down.
    const liftEnv = smoothstep(0, 0.12, t) * (1.0 - smoothstep(0.35, 0.6, t));

    // -- Reach envelope --
    // Ramps from 0 to 1 between t=0.25 and t=0.7.
    // Overlaps with lift decay so the hip smoothly transitions from
    // lift-dominant to reach-dominant flexion.
    const reachEnv = smoothstep(0.25, 0.7, t);

    // -- Extend envelope --
    // Ramps from 0 to 1 between t=0.4 and t=1.0.
    // Controls knee extension and ankle neutralization for landing.
    const extendEnv = smoothstep(0.4, 1.0, t);

    const dir = this.stepDir;

    // Transform step direction from world space into root-local space.
    // The hip pitch/roll targets are in joint-local frame, which is
    // aligned with the root body. Without this transform, stepping only
    // works correctly when the rig faces +Z.
    const rootSample = io.sampleBody("Root");
    const rootInv = qInverse(rootSample.rot);
    const localDir = qRotateVec3(rootInv, dir);

    // -- Root tilt compensation --
    // As the root tilts forward, the hip joint frame tilts with it.
    // This compresses the vertical space for the foot swing arc --
    // forward hip flexion increasingly drives the foot into the ground
    // rather than genuinely forward in world space. Compensate by adding
    // extra hip flexion proportional to the root's forward tilt projected
    // onto the step direction.
    const rootUp = qRotateVec3(rootSample.rot, v3(0, 1, 0));
    const fwdComponent = rootUp.x * dir.x + rootUp.z * dir.z;
    const fwdTiltRad = Math.atan2(fwdComponent, Math.max(rootUp.y, 0.01));
    // Apply during both lift and reach so the foot maintains clearance
    // throughout the swing.
    const tiltCompensation = -fwdTiltRad * Math.max(liftEnv, reachEnv);

    // -- Hip pitch (around +X in joint local frame) --
    // In the joint frame, NEGATIVE pitch around +X = forward flexion
    // (brings the knee toward the chest). POSITIVE pitch = extension
    // (pushes the leg backward).
    //
    // Lift component: flexion to raise the thigh.
    // For backward steps (negative localDir.z in root-local frame -- the
    // reach pitch formula uses -localDir.z, so negative Z = positive pitch
    // = hip extension = backward reach), reduce lift flexion so the foot
    // doesn't swing far forward before reversing backward.
    // Instead, the knee bend provides most of the ground clearance.
    const backwardness = clamp01(-localDir.z); // positive when stepping backward in root frame
    const liftReduction = 1.0 - 0.6 * backwardness; // reduce lift 60% for pure backward
    const hipLiftPitch = -this.cfg.hipFlexLift * liftEnv * liftReduction;

    // Reach component: directional forward flexion so the foot reaches
    // the step target. Uses root-local Z so it works regardless of
    // which direction the rig faces in world space.
    // Negative localDir.z (stepping in root's +Z / forward) needs negative
    // pitch (more flexion).
    //
    // Scale the reach pitch with step distance so that longer steps drive
    // the hip harder. Without this, a 0.15m step and a 0.7m step get
    // the same hip drive and the foot undershoots distant targets.
    const distScale = clamp01(this.stepDistance * this.cfg.hipPitchDistScale);
    const hipReachPitch =
      clamp(-localDir.z * this.cfg.hipPitchMax * distScale, -this.cfg.hipPitchMax, this.cfg.hipPitchMax) * reachEnv;

    const hipPitch = hipLiftPitch + hipReachPitch + tiltCompensation;

    // -- Hip roll (around +Z in joint local frame) --
    // Weight-shift abduction (continues from prep) + directional roll.
    //
    // localDir.x is the lateral step direction in root-local space.
    // Positive = rightward, negative = leftward. To map this to the
    // foot's abduction/adduction axis, multiply by footSideSign:
    //   - Ipsilateral step (same side): localDir.x and side share sign
    //     -> product is positive -> abduction (reach outward). Correct.
    //   - Contralateral step (cross-body): opposite signs
    //     -> product is negative -> adduction (reach inward). Correct.
    // Without this correction, left-foot-left steps would adduct
    // (pull inward) instead of abducting (pushing outward).
    const weightShiftRoll = this.cfg.weightShiftRollRad * weightShiftEnv;
    const sideRelX = localDir.x * footSideSign(foot);
    // Asymmetric roll: positive sideRelX = abduction (outward, large range),
    // negative = adduction (inward, small range to prevent leg crossing).
    const dirRollRaw = sideRelX * this.cfg.hipRollMax * distScale;
    const dirRollClamped =
      dirRollRaw >= 0 ? Math.min(dirRollRaw, this.cfg.hipRollMax) : Math.max(dirRollRaw, -this.cfg.hipRollInwardMax);
    const dirRoll = dirRollClamped * reachEnv;
    const hipRoll = weightShiftRoll + dirRoll;

    // -- Knee (hinge around +X) --
    // Extra bend proportional to forward tilt maintains ground clearance
    // when the root is tilted and the swing arc is compressed.
    const tiltKneeBoost = Math.max(0, fwdTiltRad) * 0.5 * (1.0 - extendEnv);
    // Urgency boosts the lift bend so the foot clears the ground more
    // aggressively at high urgency (faster swings compress the arc).
    const urgencyKneeBoost = this.cfg.urgencyKneeLiftBoost * this.urgency * liftEnv;
    const kneeBend = lerp(this.cfg.kneeBendLift, this.cfg.kneeBendLand, extendEnv) + tiltKneeBoost + urgencyKneeBoost;

    // -- Ankle (hinge around +X) --
    const anklePitch = lerp(this.cfg.anklePitchLift, 0, extendEnv);

    // Build joint target quaternions
    const hipTarget = this.composeHipTarget(hipPitch, hipRoll, foot);
    const kneeTarget = qFromAxisAngle(v3(1, 0, 0), kneeBend);
    const ankleTarget = qFromAxisAngle(v3(1, 0, 0), anklePitch);

    // Bump stance leg gains for single-leg support stability
    this.bumpStanceLegGains(io);

    // Urgency multipliers for gains and forces
    const gainMult = lerp(1.0, this.cfg.urgencyGainMult, this.urgency);
    const liftMult = lerp(1.0, this.cfg.urgencyLiftMult, this.urgency);

    // Override swing leg joints (after BalanceController has already set them)
    this.driveSwingLeg(io, foot, hipTarget, kneeTarget, ankleTarget, gainMult);

    // -- Lift assist forces --
    // Apply upward forces to the swing leg bodies during the lift phase.
    // The foot force must exceed foot gravity AND overcome any remaining
    // body load not yet transferred to the stance side.
    // Upper/lower leg forces compensate their gravity so the hip and knee
    // motors only fight inertia, not dead weight.
    // All forces decay with liftEnv so the leg is in free flight during
    // reach/landing.
    const footPart = foot;
    const upperLegPart = foot === "LeftFoot" ? ("LeftUpperLeg" as const) : ("RightUpperLeg" as const);
    const lowerLegPart = foot === "LeftFoot" ? ("LeftLowerLeg" as const) : ("RightLowerLeg" as const);

    const footLiftN = this.cfg.swingLiftAssistN * liftEnv * liftMult;
    const upperLegLiftN = this.cfg.swingUpperLegAssistN * liftEnv * liftMult;
    const lowerLegLiftN = this.cfg.swingLowerLegAssistN * liftEnv * liftMult;

    if (footLiftN > 0.1) {
      io.applyForce(footPart, v3(0, footLiftN, 0));
    }
    if (upperLegLiftN > 0.1) {
      io.applyForce(upperLegPart, v3(0, upperLegLiftN, 0));
    }
    if (lowerLegLiftN > 0.1) {
      io.applyForce(lowerLegPart, v3(0, lowerLegLiftN, 0));
    }

    // -- Forward reach force --
    // During the reach phase, apply a force along the step direction to
    // propel the swing foot toward its target. Joint motors alone often
    // can't overcome the inertia of an extended leg at longer distances.
    // The force scales with reachEnv (ramps in) and decays with extendEnv
    // (leg straightening for landing) so the foot decelerates before contact.
    const reachForceEnv = reachEnv * (1.0 - extendEnv);
    const reachForceN = this.cfg.swingReachForceN * reachForceEnv * liftMult;
    if (reachForceN > 0.1) {
      io.applyForce(footPart, v3(dir.x * reachForceN, 0, dir.z * reachForceN));
    }

    // Debug: log swing progress once per ~6 frames to avoid console flood.
    // Includes actual vs target joint angles and distance to step target
    // so the damping/gain tuning can be validated.
    if (Math.round(this.tSwing * 60) % 6 === 0) {
      const footSample = io.sampleBody(footPart);
      const fc = io.footContact(foot);

      // Distance from foot to step target (XZ plane)
      let distToTarget = 0;
      if (this.stepTarget) {
        const dxDbg = footSample.pos.x - this.stepTarget.x;
        const dzDbg = footSample.pos.z - this.stepTarget.z;
        distToTarget = Math.sqrt(dxDbg * dxDbg + dzDbg * dzDbg);
      }

      // Read actual joint angles to compare against targets
      const hipJointName = foot === "LeftFoot" ? "Root_LeftUpperLeg" : "Root_RightUpperLeg";
      const kneeJointName = foot === "LeftFoot" ? "LeftUpperLeg_LeftLowerLeg" : "RightUpperLeg_RightLowerLeg";
      const hipActual = io.readJoint(hipJointName);
      const kneeActual = io.readJoint(kneeJointName);
      const hipActX = hipActual.currentLocalRot ? hipActual.currentLocalRot.x.toFixed(2) : "?";
      const kneeActX = kneeActual.currentLocalRot ? kneeActual.currentLocalRot.x.toFixed(2) : "?";

      console.log(
        `[CatchStep SWING t=${t.toFixed(2)}]`,
        `env ws:${weightShiftEnv.toFixed(2)} lift:${liftEnv.toFixed(2)} reach:${reachEnv.toFixed(2)} ext:${extendEnv.toFixed(2)}`,
        `|`,
        `hipP tgt:${hipPitch.toFixed(2)} act:${hipActX}`,
        `knee tgt:${kneeBend.toFixed(2)} act:${kneeActX}`,
        `|`,
        `footY:${footSample.pos.y.toFixed(3)} distTgt:${distToTarget.toFixed(3)} gnd:${fc.grounded}`,
        `|`,
        `fLift:${footLiftN.toFixed(0)}N reach:${reachForceN.toFixed(0)}N`
      );
    }
  }

  private applyLandingLegTargets(io: RigIO): void {
    if (!this.stepFoot) return;

    const foot = this.stepFoot;

    // Near-neutral leg posture to accept ground contact.
    // Slight forward flexion (negative pitch) to maintain step direction.
    const hipTarget = this.composeHipTarget(-0.08, 0.0, foot);
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
    // Asymmetric roll limits: outward (abduction) gets the full range
    // (hipRollMax + weightShiftRollRad can stack), inward (adduction)
    // is capped to prevent leg crossing.
    const maxAbduct = this.cfg.hipRollMax + this.cfg.weightShiftRollRad;
    const maxAdduct = this.cfg.hipRollInwardMax;
    const rollClamped = rollRad >= 0 ? Math.min(rollRad, maxAbduct) : Math.max(rollRad, -maxAdduct);
    const rollSigned = rollClamped * side;

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
    ankleTarget: { x: number; y: number; z: number; w: number },
    gainMult = 1.0
  ): void {
    const hipCmd = {
      targetLocalRot: hipTarget,
      kp: this.cfg.swingHipGains.kp * gainMult,
      kd: this.cfg.swingHipGains.kd * gainMult,
      maxTorque: this.cfg.swingHipGains.max * gainMult,
    };
    const kneeCmd = {
      targetLocalRot: kneeTarget,
      kp: this.cfg.swingKneeGains.kp * gainMult,
      kd: this.cfg.swingKneeGains.kd * gainMult,
      maxTorque: this.cfg.swingKneeGains.max * gainMult,
    };
    const ankleCmd = {
      targetLocalRot: ankleTarget,
      kp: this.cfg.swingAnkleGains.kp * gainMult,
      kd: this.cfg.swingAnkleGains.kd * gainMult,
      maxTorque: this.cfg.swingAnkleGains.max * gainMult,
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
   * Active stance-hip COM shifting + elevated gains.
   *
   * During single-leg support, the stance hip actively adjusts to push
   * the COM over the stance foot. Without this, the COM drifts laterally
   * during swing, causing progressive lean across multi-step recovery.
   *
   * The hip target is computed from the COM-to-stanceFoot error:
   *   - Lateral error (world X) -> hip roll (pushes COM sideways)
   *   - Forward error (world Z) -> hip pitch (pushes COM fore/aft)
   *
   * The error is transformed into root-local space so the hip targets
   * work regardless of which direction the rig faces.
   *
   * Ankle is left under BalanceController control (primary balance actuator).
   */
  private bumpStanceLegGains(io: RigIO): void {
    if (!this.stanceFoot) return;

    const mult = this.cfg.stanceGainMult;

    // Compute COM-to-stance-foot error in world XZ.
    // Positive errorX = COM is to the right of stance foot.
    // Positive errorZ = COM is ahead of stance foot.
    const comProj = horiz(io.comWorld());
    const comVel = io.comVelWorld();
    const stanceFC = io.footContact(this.stanceFoot);
    const stanceSample = io.sampleBody(this.stanceFoot);
    const stancePos = stanceFC.avgPoint ? horiz(stanceFC.avgPoint) : horiz(stanceSample.pos);

    const errX = comProj.x - stancePos.x;
    const errZ = comProj.z - stancePos.z;

    // Transform world error into root-local frame so hip targets are
    // correct regardless of root yaw orientation.
    const rootSample = io.sampleBody("Root");
    const rootInv = qInverse(rootSample.rot);
    const errWorld = v3(errX, 0, errZ);
    const velWorld = v3(comVel.x, 0, comVel.z);
    const errLocal = qRotateVec3(rootInv, errWorld);
    const velLocal = qRotateVec3(rootInv, velWorld);

    // PD control: roll to push COM laterally, pitch to push COM fore/aft.
    // Hip roll around +Z: positive roll for right leg = abduction (pushes root left).
    // For the stance leg, we want to push the root TOWARD the stance foot:
    //   - If COM is to the right (errLocal.x > 0), push root left (positive roll for right stance).
    //   - Sign is handled by footSideSign: right foot roll is already positive = abduction.
    const stanceSide = footSideSign(this.stanceFoot);

    // Roll: push COM toward stance foot.
    // rawRoll > 0 means "abduct" (push COM toward stance foot).
    // rawRoll < 0 means "adduct" (pull COM away from stance foot).
    // These have asymmetric limits: outward has more range.
    const rawRoll = -(this.cfg.stanceHipShiftP * errLocal.x + this.cfg.stanceHipShiftD * velLocal.x);
    const clampedRoll =
      rawRoll >= 0
        ? Math.min(rawRoll, this.cfg.stanceHipShiftRollOutward)
        : Math.max(rawRoll, -this.cfg.stanceHipShiftRollInward);
    const rollRad = clampedRoll * stanceSide;

    // Pitch: push COM fore/aft toward stance foot.
    // errLocal.z > 0 means COM is ahead of stance foot in root frame.
    // Negative pitch (flexion) shifts the root forward, so we want
    // positive pitch (extension) to pull the root back when COM is ahead.
    const rawPitch = this.cfg.stanceHipShiftP * errLocal.z + this.cfg.stanceHipShiftD * velLocal.z;
    const pitchRad = clamp(rawPitch, -this.cfg.stanceHipShiftPitchMax, this.cfg.stanceHipShiftPitchMax);

    // Compose hip target: pitch around +X, roll around +Z.
    const hipTarget = qMul(qFromAxisAngle(v3(1, 0, 0), pitchRad), qFromAxisAngle(v3(0, 0, 1), rollRad));

    const hipCmd = {
      targetLocalRot: hipTarget,
      kp: 40 * mult,
      kd: 12 * mult,
      maxTorque: 120 * mult,
    };

    if (this.stanceFoot === "LeftFoot") {
      io.driveJoint("Root_LeftUpperLeg", hipCmd);
    } else {
      io.driveJoint("Root_RightUpperLeg", hipCmd);
    }

    this.bumpStanceKneeGains(io);
  }

  /**
   * Re-drive the stance knee with elevated gains.
   * Separated from bumpStanceLegGains so that STEP_PREP can call it
   * without overwriting the stance hip target (which it drives with
   * adduction during weight transfer).
   */
  private bumpStanceKneeGains(io: RigIO): void {
    if (!this.stanceFoot) return;

    const mult = this.cfg.stanceGainMult;
    const kneeRest = qFromAxisAngle(v3(1, 0, 0), 0.12);

    const kneeCmd = {
      targetLocalRot: kneeRest,
      kp: 80 * mult,
      kd: 14 * mult,
      maxTorque: 250 * mult,
    };

    if (this.stanceFoot === "LeftFoot") {
      io.driveJoint("LeftUpperLeg_LeftLowerLeg", kneeCmd);
    } else {
      io.driveJoint("RightUpperLeg_RightLowerLeg", kneeCmd);
    }
  }
}
