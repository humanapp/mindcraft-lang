---
applyTo: 'apps/sws/**'
---
<!-- Last reviewed: 2026-02-25 -->

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

Standing balance is achieved. The rig holds an upright rest pose using
ForceBased PD joint motors and an ankle inverted-pendulum strategy.

The current milestone is: refine balance quality, begin gait planning.

The rig should:

- Not self-collide.
- Not explode or jitter.
- Not rely on massive damping to remain stable.
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
