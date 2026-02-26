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

We are not walking yet.

The current milestone is: a rig that falls under gravity, stays connected,
and can settle into a plausible upright rest pose using PD joint drives.

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

- Ball joints use quaternion PD error.
- Hinge joints should compute hinge angle explicitly and drive around the
  hinge axis only.
- Avoid driving all joints simultaneously unless a clear rest pose is defined.
- Arms and head should not destabilize the torso during stability tuning.

Always ask: "Is this a structural fix, or a symptom patch?"

## 5. Long-Term Target

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

## 6. When Uncertain

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
