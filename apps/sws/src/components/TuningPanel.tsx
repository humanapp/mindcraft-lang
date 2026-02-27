import { folder, useControls } from "leva";
import type { RefObject } from "react";
import { useEffect } from "react";
import type { BalanceConfig } from "@/controllers/BalanceController";
import { BALANCE_DEFAULTS } from "@/controllers/BalanceController";
import type { CatchStepConfig, CatchStepController } from "@/controllers/CatchStepController";
import { CATCH_STEP_DEFAULTS } from "@/controllers/CatchStepController";

// -- Gain sub-schema helper ------------------------------------------------

interface GainSchema {
  kp: number;
  kd: number;
  max: number;
}

function gainFolder(label: string, defaults: GainSchema) {
  return folder({
    [`${label} kp`]: { value: defaults.kp, min: 0, max: 500, step: 0.01 },
    [`${label} kd`]: { value: defaults.kd, min: 0, max: 100, step: 0.01 },
    [`${label} max`]: { value: defaults.max, min: 0, max: 1000, step: 0.01 },
  });
}

// -- Balance panel ---------------------------------------------------------

function useBalanceControls() {
  const bd = BALANCE_DEFAULTS;

  return useControls("Balance", {
    Ankle: folder({
      ankleP: { value: bd.ankleP, min: 0, max: 30, step: 0.01 },
      ankleD: { value: bd.ankleD, min: 0, max: 15, step: 0.01 },
      ankleMaxRad: { value: bd.ankleMaxRad, min: 0, max: 1, step: 0.01 },
    }),
    "Torso Lean": folder({
      torsoLeanP: { value: bd.torsoLeanP, min: 0, max: 20, step: 0.01 },
      torsoLeanD: { value: bd.torsoLeanD, min: 0, max: 10, step: 0.01 },
      torsoLeanMaxRad: { value: bd.torsoLeanMaxRad, min: 0, max: 1.5, step: 0.01 },
    }),
    Thresholds: folder({
      filterTau: { value: bd.filterTau, min: 0.001, max: 0.2, step: 0.01 },
      fallenTiltRad: { value: bd.fallenTiltRad, min: 0.1, max: 1.5, step: 0.01 },
      recoverTiltRad: { value: bd.recoverTiltRad, min: 0.05, max: 1.0, step: 0.01 },
      defaultKneeBend: { value: bd.defaultKneeBend, min: 0, max: 0.5, step: 0.01 },
    }),
    "Standing Gains": folder(
      {
        "S Torso": gainFolder("sTorso", bd.standingTorso),
        "S Hip": gainFolder("sHip", bd.standingHip),
        "S Knee": gainFolder("sKnee", bd.standingKnee),
        "S Ankle": gainFolder("sAnkle", bd.standingAnkle),
        "S Head": gainFolder("sHead", bd.standingHead),
        "S Arm": gainFolder("sArm", bd.standingArm),
      },
      { collapsed: true }
    ),
    "Fallen Gains": folder(
      {
        "F Torso": gainFolder("fTorso", bd.fallenTorso),
        "F Hip": gainFolder("fHip", bd.fallenHip),
        "F Knee": gainFolder("fKnee", bd.fallenKnee),
        "F Ankle": gainFolder("fAnkle", bd.fallenAnkle),
        "F Head": gainFolder("fHead", bd.fallenHead),
        "F Arm": gainFolder("fArm", bd.fallenArm),
      },
      { collapsed: true }
    ),
  });
}

// -- Catch Step panel ------------------------------------------------------

function useCatchStepControls() {
  const cd = CATCH_STEP_DEFAULTS;

  return useControls("Catch Step", {
    Trigger: folder({
      filterTau: { value: cd.filterTau, min: 0.001, max: 0.2, step: 0.01 },
      triggerErrorHi: { value: cd.triggerErrorHi, min: 0, max: 0.3, step: 0.01 },
      triggerErrorLo: { value: cd.triggerErrorLo, min: 0, max: 0.2, step: 0.01 },
      triggerVelXZ: { value: cd.triggerVelXZ, min: 0, max: 2, step: 0.01 },
      triggerHoldTime: { value: cd.triggerHoldTime, min: 0, max: 0.2, step: 0.01 },
      maxTiltForStepRad: { value: cd.maxTiltForStepRad, min: 0.1, max: 1.2, step: 0.01 },
      driftRecoveryDelay: { value: cd.driftRecoveryDelay, min: 0.5, max: 5, step: 0.1 },
      driftRecoveryErrorMin: { value: cd.driftRecoveryErrorMin, min: 0.01, max: 0.1, step: 0.005 },
      driftRecoveryVelMax: { value: cd.driftRecoveryVelMax, min: 0.05, max: 0.5, step: 0.01 },
    }),
    Timing: folder({
      cooldownTime: { value: cd.cooldownTime, min: 0, max: 2, step: 0.01 },
      settleTime: { value: cd.settleTime, min: 0, max: 1, step: 0.01 },
      prepTime: { value: cd.prepTime, min: 0, max: 0.3, step: 0.01 },
      prepTimeUrgent: { value: cd.prepTimeUrgent, min: 0, max: 0.2, step: 0.01 },
      swingTime: { value: cd.swingTime, min: 0.1, max: 1, step: 0.01 },
      swingTimeUrgent: { value: cd.swingTimeUrgent, min: 0.05, max: 0.8, step: 0.01 },
      swingTimeExtMax: { value: cd.swingTimeExtMax, min: 0, max: 0.4, step: 0.01 },
      swingExtDistThresh: { value: cd.swingExtDistThresh, min: 0, max: 0.4, step: 0.01 },
      landTime: { value: cd.landTime, min: 0, max: 0.5, step: 0.01 },
      liftMinTime: { value: cd.liftMinTime, min: 0, max: 0.4, step: 0.01 },
    }),
    Placement: folder(
      {
        lipmHeight: { value: cd.lipmHeight, min: 0.3, max: 1.2, step: 0.01 },
        captureMarginK: { value: cd.captureMarginK, min: 0, max: 0.5, step: 0.01 },
        captureMarginMax: { value: cd.captureMarginMax, min: 0, max: 0.8, step: 0.01 },
        stepDistMin: { value: cd.stepDistMin, min: 0, max: 0.3, step: 0.01 },
        stepDistMax: { value: cd.stepDistMax, min: 0.1, max: 0.8, step: 0.01 },
        stepDistMaxUrgent: { value: cd.stepDistMaxUrgent, min: 0.2, max: 1.2, step: 0.01 },
        kVel: { value: cd.kVel, min: 0, max: 1, step: 0.01 },
        maxLateralFromRoot: { value: cd.maxLateralFromRoot, min: 0.1, max: 1, step: 0.01 },
        maxLateralFromRootUrgent: { value: cd.maxLateralFromRootUrgent, min: 0.2, max: 1.2, step: 0.01 },
        maxForwardFromRoot: { value: cd.maxForwardFromRoot, min: 0.2, max: 1.2, step: 0.01 },
        maxForwardFromRootUrgent: { value: cd.maxForwardFromRootUrgent, min: 0.3, max: 1.5, step: 0.01 },
        maxBackwardFromRoot: { value: cd.maxBackwardFromRoot, min: 0.1, max: 1, step: 0.01 },
        maxBackwardFromRootUrgent: { value: cd.maxBackwardFromRootUrgent, min: 0.2, max: 1.2, step: 0.01 },
        lateralDistBoostK: { value: cd.lateralDistBoostK, min: 1, max: 3, step: 0.01 },
        minLateralSpread: { value: cd.minLateralSpread, min: 0.05, max: 0.4, step: 0.01 },
      },
      { collapsed: true }
    ),
    Swing: folder({
      weightShiftRollRad: { value: cd.weightShiftRollRad, min: 0, max: 0.5, step: 0.01 },
      stanceAdductRollRad: { value: cd.stanceAdductRollRad, min: 0, max: 0.3, step: 0.01 },
      swingLiftAssistN: { value: cd.swingLiftAssistN, min: 0, max: 200, step: 0.01 },
      swingUpperLegAssistN: { value: cd.swingUpperLegAssistN, min: 0, max: 100, step: 0.01 },
      swingLowerLegAssistN: { value: cd.swingLowerLegAssistN, min: 0, max: 80, step: 0.01 },
      swingReachForceN: { value: cd.swingReachForceN, min: 0, max: 200, step: 0.01 },
      hipFlexLift: { value: cd.hipFlexLift, min: 0, max: 1.5, step: 0.01 },
      hipPitchMax: { value: cd.hipPitchMax, min: 0, max: 1.5, step: 0.01 },
      hipPitchDistScale: { value: cd.hipPitchDistScale, min: 0, max: 5, step: 0.01 },
      hipRollMax: { value: cd.hipRollMax, min: 0, max: 1.2, step: 0.01 },
      hipRollInwardMax: { value: cd.hipRollInwardMax, min: 0, max: 0.3, step: 0.01 },
      kneeBendLift: { value: cd.kneeBendLift, min: 0, max: 2, step: 0.01 },
      kneeBendLand: { value: cd.kneeBendLand, min: 0, max: 0.5, step: 0.01 },
      urgencyKneeLiftBoost: { value: cd.urgencyKneeLiftBoost, min: 0, max: 1, step: 0.01 },
      anklePitchLift: { value: cd.anklePitchLift, min: -0.8, max: 0, step: 0.01 },
    }),
    "Swing Gains": folder(
      {
        "Swing Hip": gainFolder("swHip", cd.swingHipGains),
        "Swing Knee": gainFolder("swKnee", cd.swingKneeGains),
        "Swing Ankle": gainFolder("swAnkle", cd.swingAnkleGains),
        stanceGainMult: { value: cd.stanceGainMult, min: 1, max: 5, step: 0.01 },
      },
      { collapsed: true }
    ),
    "Stance Hip Shift": folder(
      {
        stanceHipShiftP: { value: cd.stanceHipShiftP, min: 0, max: 15, step: 0.01 },
        stanceHipShiftD: { value: cd.stanceHipShiftD, min: 0, max: 5, step: 0.01 },
        stanceHipShiftRollOutward: { value: cd.stanceHipShiftRollOutward, min: 0, max: 1, step: 0.01 },
        stanceHipShiftRollInward: { value: cd.stanceHipShiftRollInward, min: 0, max: 0.5, step: 0.01 },
        stanceHipShiftPitchMax: { value: cd.stanceHipShiftPitchMax, min: 0, max: 0.8, step: 0.01 },
      },
      { collapsed: true }
    ),
    Urgency: folder(
      {
        urgencyLo: { value: cd.urgencyLo, min: 0, max: 0.3, step: 0.01 },
        urgencyHi: { value: cd.urgencyHi, min: 0.1, max: 1, step: 0.01 },
        urgencyVelK: { value: cd.urgencyVelK, min: 0, max: 1, step: 0.01 },
        urgencyTiltK: { value: cd.urgencyTiltK, min: 0, max: 1, step: 0.01 },
        urgencyGainMult: { value: cd.urgencyGainMult, min: 1, max: 3, step: 0.01 },
        urgencyLiftMult: { value: cd.urgencyLiftMult, min: 1, max: 3, step: 0.01 },
        cooldownTimeUrgent: { value: cd.cooldownTimeUrgent, min: 0, max: 1, step: 0.01 },
      },
      { collapsed: true }
    ),
    "Multi-Step": folder(
      {
        maxConsecutiveSteps: { value: cd.maxConsecutiveSteps, min: 1, max: 10, step: 1 },
        multiStepSettleTime: { value: cd.multiStepSettleTime, min: 0, max: 0.3, step: 0.01 },
        multiStepErrorThresh: { value: cd.multiStepErrorThresh, min: 0, max: 0.3, step: 0.01 },
        multiStepVelThresh: { value: cd.multiStepVelThresh, min: 0, max: 1, step: 0.01 },
      },
      { collapsed: true }
    ),
    "Stance Recovery": folder(
      {
        idealFootSpread: { value: cd.idealFootSpread, min: 0.1, max: 0.5, step: 0.01 },
        minFootSpreadForRecovery: { value: cd.minFootSpreadForRecovery, min: 0.05, max: 0.3, step: 0.01 },
        stanceRecoveryDelay: { value: cd.stanceRecoveryDelay, min: 0, max: 2, step: 0.01 },
        stanceRecoveryErrorMax: { value: cd.stanceRecoveryErrorMax, min: 0, max: 0.1, step: 0.01 },
        stanceRecoveryVelMax: { value: cd.stanceRecoveryVelMax, min: 0, max: 0.5, step: 0.01 },
      },
      { collapsed: true }
    ),
    "Torso Bias": folder(
      {
        torsoBiasRad: { value: cd.torsoBiasRad, min: -0.5, max: 0.5, step: 0.01 },
        torsoBiasDecayTau: { value: cd.torsoBiasDecayTau, min: 0.01, max: 1, step: 0.01 },
      },
      { collapsed: true }
    ),
    "Counter-Rotation": folder(
      {
        counterRotYawMax: { value: cd.counterRotYawMax, min: 0, max: 0.5, step: 0.01 },
        counterRotUrgencyMin: { value: cd.counterRotUrgencyMin, min: 0, max: 0.5, step: 0.01 },
        counterRotDecayTau: { value: cd.counterRotDecayTau, min: 0.01, max: 0.5, step: 0.01 },
      },
      { collapsed: true }
    ),
    Arms: folder(
      {
        armExtendRollMax: { value: cd.armExtendRollMax, min: 0, max: 1.5, step: 0.01 },
        armExtendPitchMax: { value: cd.armExtendPitchMax, min: -0.5, max: 0.5, step: 0.01 },
        armTuckRollMax: { value: cd.armTuckRollMax, min: 0, max: 0.5, step: 0.01 },
        armTuckPitchMax: { value: cd.armTuckPitchMax, min: 0, max: 0.5, step: 0.01 },
        armExtendUrgencyMin: { value: cd.armExtendUrgencyMin, min: 0, max: 0.3, step: 0.01 },
        armExtendDecayTau: { value: cd.armExtendDecayTau, min: 0.01, max: 1, step: 0.01 },
        "Arm Gains": gainFolder("armExt", cd.armExtendGains),
      },
      { collapsed: true }
    ),
  });
}

// -- Helpers to map flat leva values back to config objects -----------------

function extractGain(vals: Record<string, unknown>, prefix: string): GainSchema {
  return {
    kp: vals[`${prefix} kp`] as number,
    kd: vals[`${prefix} kd`] as number,
    max: vals[`${prefix} max`] as number,
  };
}

function toBalanceConfig(v: Record<string, unknown>): Partial<BalanceConfig> {
  return {
    ankleP: v.ankleP as number,
    ankleD: v.ankleD as number,
    ankleMaxRad: v.ankleMaxRad as number,
    torsoLeanP: v.torsoLeanP as number,
    torsoLeanD: v.torsoLeanD as number,
    torsoLeanMaxRad: v.torsoLeanMaxRad as number,
    filterTau: v.filterTau as number,
    fallenTiltRad: v.fallenTiltRad as number,
    recoverTiltRad: v.recoverTiltRad as number,
    defaultKneeBend: v.defaultKneeBend as number,
    standingTorso: extractGain(v, "sTorso"),
    standingHip: extractGain(v, "sHip"),
    standingKnee: extractGain(v, "sKnee"),
    standingAnkle: extractGain(v, "sAnkle"),
    standingHead: extractGain(v, "sHead"),
    standingArm: extractGain(v, "sArm"),
    fallenTorso: extractGain(v, "fTorso"),
    fallenHip: extractGain(v, "fHip"),
    fallenKnee: extractGain(v, "fKnee"),
    fallenAnkle: extractGain(v, "fAnkle"),
    fallenHead: extractGain(v, "fHead"),
    fallenArm: extractGain(v, "fArm"),
  };
}

function toCatchStepConfig(v: Record<string, unknown>): Partial<CatchStepConfig> {
  return {
    filterTau: v.filterTau as number,
    triggerErrorHi: v.triggerErrorHi as number,
    triggerErrorLo: v.triggerErrorLo as number,
    triggerVelXZ: v.triggerVelXZ as number,
    triggerHoldTime: v.triggerHoldTime as number,
    maxTiltForStepRad: v.maxTiltForStepRad as number,
    driftRecoveryDelay: v.driftRecoveryDelay as number,
    driftRecoveryErrorMin: v.driftRecoveryErrorMin as number,
    driftRecoveryVelMax: v.driftRecoveryVelMax as number,
    cooldownTime: v.cooldownTime as number,
    settleTime: v.settleTime as number,
    prepTime: v.prepTime as number,
    prepTimeUrgent: v.prepTimeUrgent as number,
    swingTime: v.swingTime as number,
    swingTimeUrgent: v.swingTimeUrgent as number,
    swingTimeExtMax: v.swingTimeExtMax as number,
    swingExtDistThresh: v.swingExtDistThresh as number,
    landTime: v.landTime as number,
    liftMinTime: v.liftMinTime as number,
    lipmHeight: v.lipmHeight as number,
    captureMarginK: v.captureMarginK as number,
    captureMarginMax: v.captureMarginMax as number,
    stepDistMin: v.stepDistMin as number,
    stepDistMax: v.stepDistMax as number,
    stepDistMaxUrgent: v.stepDistMaxUrgent as number,
    kVel: v.kVel as number,
    maxLateralFromRoot: v.maxLateralFromRoot as number,
    maxLateralFromRootUrgent: v.maxLateralFromRootUrgent as number,
    maxForwardFromRoot: v.maxForwardFromRoot as number,
    maxForwardFromRootUrgent: v.maxForwardFromRootUrgent as number,
    maxBackwardFromRoot: v.maxBackwardFromRoot as number,
    maxBackwardFromRootUrgent: v.maxBackwardFromRootUrgent as number,
    lateralDistBoostK: v.lateralDistBoostK as number,
    minLateralSpread: v.minLateralSpread as number,
    weightShiftRollRad: v.weightShiftRollRad as number,
    stanceAdductRollRad: v.stanceAdductRollRad as number,
    swingLiftAssistN: v.swingLiftAssistN as number,
    swingUpperLegAssistN: v.swingUpperLegAssistN as number,
    swingLowerLegAssistN: v.swingLowerLegAssistN as number,
    swingReachForceN: v.swingReachForceN as number,
    hipFlexLift: v.hipFlexLift as number,
    hipPitchMax: v.hipPitchMax as number,
    hipPitchDistScale: v.hipPitchDistScale as number,
    hipRollMax: v.hipRollMax as number,
    hipRollInwardMax: v.hipRollInwardMax as number,
    kneeBendLift: v.kneeBendLift as number,
    kneeBendLand: v.kneeBendLand as number,
    urgencyKneeLiftBoost: v.urgencyKneeLiftBoost as number,
    anklePitchLift: v.anklePitchLift as number,
    swingHipGains: extractGain(v, "swHip"),
    swingKneeGains: extractGain(v, "swKnee"),
    swingAnkleGains: extractGain(v, "swAnkle"),
    stanceGainMult: v.stanceGainMult as number,
    stanceHipShiftP: v.stanceHipShiftP as number,
    stanceHipShiftD: v.stanceHipShiftD as number,
    stanceHipShiftRollOutward: v.stanceHipShiftRollOutward as number,
    stanceHipShiftRollInward: v.stanceHipShiftRollInward as number,
    stanceHipShiftPitchMax: v.stanceHipShiftPitchMax as number,
    urgencyLo: v.urgencyLo as number,
    urgencyHi: v.urgencyHi as number,
    urgencyVelK: v.urgencyVelK as number,
    urgencyTiltK: v.urgencyTiltK as number,
    urgencyGainMult: v.urgencyGainMult as number,
    urgencyLiftMult: v.urgencyLiftMult as number,
    cooldownTimeUrgent: v.cooldownTimeUrgent as number,
    maxConsecutiveSteps: v.maxConsecutiveSteps as number,
    multiStepSettleTime: v.multiStepSettleTime as number,
    multiStepErrorThresh: v.multiStepErrorThresh as number,
    multiStepVelThresh: v.multiStepVelThresh as number,
    idealFootSpread: v.idealFootSpread as number,
    minFootSpreadForRecovery: v.minFootSpreadForRecovery as number,
    stanceRecoveryDelay: v.stanceRecoveryDelay as number,
    stanceRecoveryErrorMax: v.stanceRecoveryErrorMax as number,
    stanceRecoveryVelMax: v.stanceRecoveryVelMax as number,
    torsoBiasRad: v.torsoBiasRad as number,
    torsoBiasDecayTau: v.torsoBiasDecayTau as number,
    counterRotYawMax: v.counterRotYawMax as number,
    counterRotUrgencyMin: v.counterRotUrgencyMin as number,
    counterRotDecayTau: v.counterRotDecayTau as number,
    armExtendRollMax: v.armExtendRollMax as number,
    armExtendPitchMax: v.armExtendPitchMax as number,
    armTuckRollMax: v.armTuckRollMax as number,
    armTuckPitchMax: v.armTuckPitchMax as number,
    armExtendUrgencyMin: v.armExtendUrgencyMin as number,
    armExtendDecayTau: v.armExtendDecayTau as number,
    armExtendGains: extractGain(v, "armExt"),
  };
}

// -- Component -------------------------------------------------------------

export function TuningPanel(props: { catchStepRef: RefObject<CatchStepController | null> }) {
  const balanceVals = useBalanceControls();
  const catchStepVals = useCatchStepControls();

  // Push leva values to controllers whenever they change.
  useEffect(() => {
    const ctrl = props.catchStepRef.current;
    if (!ctrl) return;
    ctrl.balance.updateConfig(toBalanceConfig(balanceVals));
  }, [balanceVals, props.catchStepRef]);

  useEffect(() => {
    const ctrl = props.catchStepRef.current;
    if (!ctrl) return;
    ctrl.updateConfig(toCatchStepConfig(catchStepVals));
  }, [catchStepVals, props.catchStepRef]);

  return null;
}
