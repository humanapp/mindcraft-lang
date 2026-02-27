---
applyTo: 'apps/sws/**'
---
<!-- Last reviewed: 2026-02-26 -->

# SWS Rig Architecture

## Overview

SWS (Silly Walk Simulator) implements a physically simulated humanoid rig.

- Seed implementation for a future Roblox R6-based game.
- Built in TypeScript.
- Runs on Three.js + Rapier for the prototype.
- Controller logic must be portable to a roblox-ts backend later.

## 1. Separation of Concerns

Maintain strict layering:

- **RigDefinition** -- static structure (parts, joints, limits).
- **RapierRig** -- physics construction + world ownership.
- **RigIO** -- sampling and force/torque application.
- **Controllers** (stabilizer, gait planner, etc.) -- policy and behavior.

Do NOT:

- Put controller logic into RapierRig (except temporary debugging helpers --
  see note below).
- Put engine-specific math into controllers.
- Introduce Three.js types into controller code.

**Temporary controller logic in RapierRig/RigIO:** It is acceptable to place
controller-like helpers (e.g., `applyUprightTorque`) directly in RapierRig or
RigIO during active troubleshooting. These must be removed or migrated to a
proper controller once the issue is resolved.

All controller math must use plain `{x,y,z}` and `{x,y,z,w}` types.

## 2. Physics Philosophy

We are building a springy, self-balancing puppet, not a kinematic animation system.

Movement must emerge from:

- Gravity
- Mass distribution
- PD-driven joints
- Ground reaction forces

Avoid:

- Teleporting transforms
- Directly setting rotations
- Kinematic bodies for main parts
- Fake upright constraints that bypass physics

Temporary hacks for debugging are allowed but must be removable.

## 3. Stability Goals (Current Phase)

Standing balance is achieved with Roblox R6-proportioned box-geometry
body parts. The rig holds an upright rest pose using ForceBased PD joint
motors and an ankle inverted-pendulum strategy. Multi-step catch-step
recovery is functional: all 8 small (30 N*s) and all 8 medium (70 N*s)
impulse directions pass the headless harness. Large impulses (120 N*s)
pass in 4/8 directions (the lateral-heavy ones: right, left,
forward-right, forward-left). Overall: 20/24.

The 4 remaining large-impulse failures (forward, back, back-right,
back-left) produce peak tilt > pi/2 rad -- complete topple that no
catch step can arrest. These are at the physical limit of what ankle
strategy + catch stepping can recover for this rig geometry.

The rig should:

- Not self-collide.
- Not explode or jitter.
- Respect hinge limits on knees and ankles.
- Use reasonable kp/kd values, not extreme stiffness.

Prefer:

- Correct joint anchors
- Proper hinge axis math
- Hinge-specific PD driving
- Gradual gain tuning

Over:

- Increasing damping to hide instability
- Adding arbitrary torques everywhere
- Hard-clamping rotations outside physics

## 4. Joint Driving Rules

- All joints use Rapier's built-in constraint-solver motors (not external
  torque impulses). This gives bidirectional torques (Newton's 3rd law),
  implicit integration (no one-frame lag), and natural force transmission
  through the kinematic chain.
- Hinge (revolute) joints: extract the signed angle from the target
  quaternion by projecting its axis-angle onto the hinge axis. Use
  `configureMotorPosition(target, stiffness, damping)`.
- Ball (spherical) joints: Rapier's `SphericalImpulseJoint` has NO
  high-level motor API. Use the raw WASM API via
  `rawSet.jointConfigureMotorPosition(handle, axis, target, stiffness, damping)`
  on each of AngX (3), AngY (4), AngZ (5). Target quaternion is decomposed
  into intrinsic XYZ Euler angles.
- Arms and head should not destabilize the torso during stability tuning.
  Drive them at low gains to hold rest pose.
- All joints (hinge and ball) must be initialized with a motor at
  construction time in RapierRig, not just on first controller call.

Always ask: "Is this a structural fix, or a symptom patch?"

## 5. Rapier Motor Model (Critical)

Rapier's `configureMotorPosition` and `jointConfigureMotorPosition` always
set the motor model to `AccelerationBased` (0). In this model, torque is
scaled by the body's effective angular mass at the constraint point. For
small bodies in a kinematic chain (e.g. foot inertia ~0.03 kg-m^2), this
produces negligibly small torques that cannot fight gravity.

**Always override to ForceBased (1)** using
`rawSet.jointConfigureMotorModel(handle, axis, 1)` after every call to
`configureMotorPosition` / `jointConfigureMotorPosition`. ForceBased uses
stiffness directly as N-m/rad, giving motors real authority.

- `RawMotorModel.AccelerationBased = 0` -- torque = effective_mass * stiffness * error (too weak)
- `RawMotorModel.ForceBased = 1` -- torque = stiffness * error (correct)
- Revolute motor axis: AngX (3)
- Ball joint motor axes: AngX (3), AngY (4), AngZ (5)
- The `RawJointSet` interface (defined in both RapierRig.ts and RapierRigIO.ts)
  wraps the WASM methods `jointConfigureMotorPosition` and
  `jointConfigureMotorModel`.
- Access `rawSet` via `(joint as unknown as { rawSet: RawJointSet }).rawSet`
  -- the `protected` modifier is not enforced at JS runtime.

## 6. Long-Term Target

This rig must eventually support:

- Capture-point based balance.
- Step planning.
- Composable high-level movement intents.
- Stylized but physically believable stumble and recovery.
- Portability to Roblox R6-like rigs.

Do NOT introduce solutions that:

- Depend on Three.js internals.
- Depend on Rapier-only APIs in controller logic.
- Prevent future balancing logic from working.

## 7. When Uncertain

Prefer:

- Simpler math
- Fewer special cases
- Clear coordinate frames
- Explicit axis definitions
- Deterministic behavior

Avoid:

- Implicit axis assumptions
- Frame-of-reference ambiguity
- Mixing local/world spaces without clarity

Always state:

- Which space vectors are in (local vs world).
- Why a chosen gain value makes sense.
- What physical behavior the change is expected to produce.

## 8. Orientation Independence (Critical)

All controller math must work identically regardless of the rig's yaw
orientation. The rig can face any direction in the world.

### Root-local frame

When determining lateral vs forward direction (e.g., for foot selection,
step target clamping, torso lean bias, arm extension side, laterality
calculations), always transform world-space vectors into root-local frame
using `qInverse(rootSample.rot)` before interpreting X as lateral and Z as
forward.

Common bugs from world-space assumptions:
- Ankle PD using world Z for pitch: drives lateral balance at 90-deg yaw.
- Torso lean PD using world X/Z: rolls instead of pitching at 90-deg yaw.
- Foot spread measured as `rightPos.x - leftPos.x`: reads zero at 90-deg yaw,
  triggers spurious stance recovery steps.
- Step target clamping with world X = lateral, world Z = forward: clamps
  incorrectly at non-zero yaw.
- Ipsilateral foot selection using `dir.x` (world): picks wrong foot at
  non-zero yaw.

### World-space is correct for:
- COM position and velocity (used for LIPM capture point).
- Step target XZ coordinates (the foot moves to a world position).
- Reach and lift forces (gravity is world-space, step target is world-space).
- Dot products between two world-space vectors (e.g., foot-to-COM projection
  onto step direction).

### RapierRig body spawning

`part.restPos` in `RigDefinition` is a root-relative offset. When spawning or
resetting with a non-identity `rootWorldRot`, the offset must be rotated by
the spawn quaternion before adding to `rootWorldPos`:
```
worldPos = rootWorldPos + rotateVec3(rootWorldRot, part.restPos)
```

## 9. Live Tuning Dashboard (leva)

The app includes a `TuningPanel` component (`components/TuningPanel.tsx`)
that uses [leva](https://github.com/pmndrs/leva) to expose all tunable
controller parameters in a browser-side GUI panel.

- `TuningPanel` is a renderless React component (`returns null`) mounted
  inside `CharacterRig`. It receives a ref to `CatchStepController` and
  accesses `catchStep.balance` for the balance controller.
- Two top-level leva panels: **Balance** and **Catch Step**, each with
  grouped folders (Ankle, Torso Lean, Trigger, Timing, Swing, etc.).
- `useEffect` hooks push changed values to controllers via `updateConfig()`
  whenever leva sliders change.
- Nested gain objects (`{ kp, kd, max }`) are flattened into prefixed
  scalar controls in leva, then reassembled by `extractGain()` before
  being passed to `updateConfig()`.

When adding new config fields:
1. Add the field to `BALANCE_DEFAULTS` or `CATCH_STEP_DEFAULTS`.
2. Add a corresponding leva control in the appropriate folder in
   `TuningPanel.tsx`.
3. Add the field to the `toBalanceConfig()` or `toCatchStepConfig()`
   mapping function.

## 10. Hip Roll Asymmetry (Anti-Crossing)

Swing leg hip roll must use asymmetric limits:
- **Abduction (outward):** full range (`hipRollMax`, currently 0.6 rad).
- **Adduction (inward):** small limit (`hipRollInwardMax`, currently 0.08 rad).

This prevents legs from crossing during catch steps. The asymmetry applies in
both the `dirRoll` computation and the final `composeHipTarget` clamp.

## 11. Balance Controller Architecture

### Ankle strategy (primary actuator)
The ankle hinge motor is the inverted-pendulum balance actuator. Error and
velocity are transformed to root-local frame; `errLocal.z` drives ankle pitch.

### Torso lean (hip strategy)
The Root_Torso ball joint leans opposite to COM error (root-local frame).
CatchStepController can override via `torsoBiasPitch`, `torsoBiasRoll`,
`torsoLeanScale`, and `torsoYawBias` fields on BalanceController.

### CatchStepController layering
CatchStepController calls `balance.update()` first, then overrides swing-leg
and stance-leg joints. It sets bias fields BEFORE `balance.update()` so they
take effect the same frame. Key subsystems:
- LIPM capture point for step target placement.
- Active stance-hip COM shifting (PD control on hip roll/pitch).
- Asymmetric arm extension (tightrope-walker reflex on high-side arm).
- Upper-body counter-rotation (torso yaw bias).

### Config pattern
Both controllers use the same defaults-object pattern:
- `BALANCE_DEFAULTS` (exported from `BalanceController.ts`) -- all balance
  gains, ankle/torso-lean PD coefficients, fallen/standing joint gains,
  filter constants, and tilt thresholds.
- `CATCH_STEP_DEFAULTS` (exported from `CatchStepController.ts`) -- trigger
  thresholds, swing timing, step placement, urgency scaling, arm/torso
  bias, multi-step recovery, stance recovery, and swing-leg gains.

Defaults objects are declared `as const`. A `Widen<T>` mapped type strips
readonly and widens numeric literals so `Partial<BalanceConfig>` and
`Partial<CatchStepConfig>` accept plain `number` values.

Each controller:
- Accepts `Partial<Config>` in its constructor (merged with defaults).
- Exposes `updateConfig(overrides: Partial<Config>)` to mutate the live
  config at runtime without reconstructing the controller.

When adding new tunable parameters, add them to the relevant defaults
object, not as module-level constants.

## 12. Rapier Solver Iterations (Critical)

Rapier's default `numSolverIterations` is 4. This is insufficient for the
rig's 5-6 constraint chain (root -> hip -> knee -> ankle -> foot -> ground).
At 4 iterations, motor forces cannot propagate end-to-end in a single step,
making joint motors almost completely ineffective -- even 6x gain increases
produce negligible changes in behavior.

`RapierRig` sets `world.numSolverIterations = 8` in its constructor. Do not
reduce this below 8. Higher values (12, 16) improve constraint convergence
but shift which directions recover best (the system is chaotic at the
boundary), so changes should be validated across all harness directions.

## 13. Reactive Damping System

Linear damping on rig bodies is the single most impactful parameter for
impulse recovery. It controls how quickly translational momentum decays.

Constant high damping (12.0) achieves good recovery (21/24) but acts as
a crutch that would fight walking/running locomotion. The current system
uses **reactive damping**: low base damping with a temporary spike on
impact that decays exponentially.

### How it works

Each frame, BalanceController computes the COM velocity delta. If the
delta exceeds `impactVelThreshold` (0.8 m/s), `dampingBoost` is set to
`impactDampingBoost` (12.0). The boost then decays with time constant
`impactDampingDecayTau` (0.5s). Effective standing damping per frame:
`standingLinearDamping + dampingBoost` (2.0 + 0..12.0).

This means:
- At rest, damping is 2.0 -- low enough for natural walking/running.
- On impact, damping spikes to 14.0 -- absorbs momentum quickly.
- Over ~1 second, damping decays back to 2.0.

### Current parameters (20/24)

- `standingLinearDamping`: 2.0 (base, set in both BALANCE_DEFAULTS and
  RapierRig initial body construction)
- `impactDampingBoost`: 12.0 (peak boost, effective peak = 14.0)
- `impactDampingDecayTau`: 0.5s (exponential decay time constant)
- `impactVelThreshold`: 0.8 m/s (COM delta-v trigger)

### Parameter sweep results

The boost value has a narrow optimal range:
- boost=10, tau=0.5: 19/24
- boost=12, tau=0.5: 20/24 (optimal)
- boost=13, tau=0.5: 19/24 (over-damps forward-right/medium)
- boost=14, tau=0.5: 19/24 (same issue)

Longer decay (tau=0.6) over-damps post-step settlement (18/24).
Lower threshold (0.5) is too sensitive (19/24).
Higher base (3.0) hurts lateral recovery (18/24).
Velocity-gated decay (freeze decay while COM moving) over-damps (19/24).

### Pareto trade-off

Reactive damping scores 20/24 vs constant 12.0 at 21/24. The 1-point
difference is forward-left/large, which is at the physical limit. The
6x reduction in base damping (12.0 -> 2.0) is essential for the next
feature layer (walking/running) where constant high damping would fight
locomotion forces.

### Fallen damping switch

When the rig enters fallen state (tilt > 43 deg) or is airborne (no foot
contact), BalanceController switches to `fallenLinearDamping` (0.5) for a
natural-looking topple, but ONLY after `fallenDampingDelay` (0.4s) of
continuous fallen/airborne state. This delay is critical: dropping damping
immediately removes the momentum absorption needed for borderline
recoveries.

Damping restores immediately when the rig recovers (tilt < recoverTiltRad
and foot contact restored).

Angular damping (6.0) is less sensitive. It acts on rotational momentum
and should stay moderate to prevent spin-out without over-damping joint
motor responses.

## 14. Multi-Step Re-Triggering

The CatchStepController's multi-step recovery allows rapid consecutive
steps when error remains high after a step. Key parameters:

- `multiStepSettleTime` -- how long to wait between consecutive steps.
  Too short (< 0.1s) causes over-stepping: the rig takes many rapid steps
  that destabilize rather than correct. Too long (> 0.4s) wastes recovery
  time. Current value: 0.20s.
- `multiStepVelThresh` -- COM velocity threshold for re-triggering. Below
  this threshold, the controller returns to STAND and waits for the full
  cooldown before stepping again. Current value: 0.6 m/s.
- `maxConsecutiveSteps` -- hard cap. Current value: 7. Needed for
  multi-step recovery from large impulses (some passing large trials
  use 4-6 consecutive steps). Values above ~8 tend to produce
  oscillatory stepping patterns rather than settling.

## 15. Headless Harness

The headless harness (`src/test/headless-harness.ts`) is the primary
validation tool for balance tuning. It runs 8 directions x 3 magnitudes
(30/70/120 N*s impulses) at yaw 0, with 120 settle frames + 300 sim
frames at 1/60s. Pass threshold: finalTilt < 0.1 rad.

Run with: `npm run test:harness`

Key behaviors:
- Console output from controllers is suppressed during trials.
- Each trial creates a fresh world, rig, and controllers.
- The harness exits with code 1 if any trial fails.
- Results are directionally sensitive -- a change that fixes forward
  can break backward. Always check all 24 trials.

## 16. Parameter Tuning Lessons

Tuning this rig is highly non-linear. Observations from systematic
parameter sweeps:

- **Motor gain changes have near-zero effect when solver iterations are
  too low.** Always verify solver iterations are >= 8 before tuning gains.
- **Ankle motor stiffness is destabilizing above ~kp=30.** The constraint
  solver with 8 iterations cannot converge with stiff ankle motors;
  higher stiffness causes oscillation and falls, especially laterally.
- **Torso lean gains above P=5 / D=1.5 hurt more than help.** Excessive
  lean fights the catch step mechanism.
- **Standing joint gains (hip/knee/torso) are relatively insensitive.**
  Changes of +/- 25% produce small or mixed effects.
- **Linear damping dominates all other parameters** for impulse recovery.
  A 2x change in damping has more effect than any combination of gain
  changes. With reactive damping, the boost level (not base damping) is
  the dominant parameter. The boost has a narrow optimal range (12.0);
  values 1-2 points above or below cause regressions.
- **Solver iteration count shifts directional bias.** iter=8 and iter=12
  favor different subsets of directions. Pick one and tune to it.
- **Faster step timing hurts.** Reducing prep/swing time below defaults
  causes worse outcomes because the foot doesn't reach the target and
  the single-leg phase becomes too compressed for the balance controller.
- **Reactive damping boost vs base split matters.** Higher base damping
  (e.g. 3.0) with proportionally lower boost (same peak) hurts lateral
  recovery. The base must stay low (2.0) for the ankle strategy to work
  freely between impacts.
- **Velocity-gated or longer decay hurts.** Attempts to sustain the
  damping boost longer (tau=0.6, or freezing decay while COM is moving)
  over-damp post-step settlement and regress the score.

## 17. Anti-Stomp Cycle Logic

After a catch step sequence finishes without reaching stable idle, the
rig can re-trigger steps immediately if error remains above the trigger
threshold. This produces a visible "stomp cycle" -- the rig leans to one
side, repeatedly stomps one foot, and never settles.

CatchStepController tracks `recentSequences` (count of fruitless step
sequences) and raises the effective trigger threshold by 0.02m per
sequence (capped at +0.06m). This progressively suppresses re-stepping
when steps aren't helping, letting ankle strategy and torso lean settle
the residual offset.

- **Stable idle reset:** error < 0.06m AND velocity < 0.15 m/s for 0.5s
  resets the counter.
- **Safety valve:** if STAND persists with error > 0.10m for > 1.5s, the
  counter resets to allow a corrective step.

## 18. Drift Recovery

When the rig settles after stepping with a moderate COM-over-support
error (0.04-0.07m) that the balance controller cannot resolve, it can
get stuck: the error is below the catch step trigger threshold (0.07m)
and ankle pitch has no lateral authority. The anti-stomp boost can raise
the effective trigger even higher.

The drift recovery mechanism tracks how long the rig has been standing
with persistent moderate error and low velocity. After
`driftRecoveryDelay` (2.0s), it forces a corrective step and resets the
anti-stomp counter.

- `driftRecoveryDelay`: 2.0s -- timeout before forcing a corrective step.
- `driftRecoveryErrorMin`: 0.04m -- error must exceed this to count.
- `driftRecoveryVelMax`: 0.25 m/s -- velocity must be below this (rig is
  settled, not mid-recovery).
- Timer resets whenever the rig leaves STAND (stepping), falls, or error
  drops below the minimum.

## 18. Fallen State Gains

When fallen, joint motor gains drop dramatically to prevent ground
spasming. Tuning notes:

- **Arm kp must be 0 when fallen.** Any stiffness creates a spring-back
  effect that makes the rig bounce when landing on an arm. Use kd-only
  (damped, no restoring force) for limp arms on landing.
- Other fallen gains (torso, hip, knee, ankle, head) keep small kp values
  to prevent total ragdoll but are low enough to not fight the fall.

## 19. Hip Lateral Balance (Disabled)

An attempt was made to add hip roll as a lateral COM actuator (since
ankles are pitch-only). Applying opposite Z-axis roll to left/right hips
tilts the pelvis but does NOT effectively shift COM laterally over the
support base. The result:

- Introduces visible sustained lean that hip motors maintain.
- Slows recovery to upright after stepping.
- Reduces overall robustness.

The config (`hipLateralP`, `hipLateralD`, `hipLateralMaxRad`) and plumbing
(`hipLateralScale` on BalanceController) remain in place but are disabled
(default scale = 0). Lateral correction relies on torso lean PD and catch
steps. A future approach might use ankle inversion/eversion if the rig
gains ankle roll joints.

## 20. RigIO Interface Extensions

`setAllLinearDamping(damping: number)` was added to RigIO for runtime
damping switching. Implemented in RapierRigIO by iterating all parts and
calling `setLinearDamping` on each rigid body. Used by BalanceController
for the fallen damping switch (section 13).

When adding new RigIO methods:
1. Add to the `RigIO` interface in `rig/RigIO.ts`.
2. Implement in `physics/RapierRigIO.ts`.
3. Will need a corresponding implementation in the Roblox backend later.
