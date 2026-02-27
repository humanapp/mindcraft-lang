// src/physics/RapierRigIO.ts
//
// Implements RigIO on top of RapierRig + Rapier world.
//
// - driveJoint uses Rapier's built-in constraint-solver motors for ALL
//   joint types (revolute + spherical). This gives bidirectional torques
//   (Newton's 3rd law) and implicit integration (high stiffness, no lag).
// - footContact uses raycasts from soleLocalPoint downward.
// - comWorld/comVelWorld are mass-weighted averages of rigid bodies.

import type { RayColliderIntersection } from "@dimforge/rapier3d-compat";
import type { Quat, Vec3 } from "@/lib/math";
import {
  add,
  clamp,
  cross,
  dot,
  len,
  normalize,
  qRotateVec3,
  quatToAxisAngle,
  quatToEulerXYZ,
  scale,
  sub,
  v3,
} from "@/lib/math";
import type { BodySample, FootName, JointDef, JointName, PartName, RigDefinition } from "@/rig/RigDefinition";
import type { FootContact, JointDriveCommand, JointReadout, RigIO } from "@/rig/RigIO";
import type { RapierModule, RapierRig, RapierWorld } from "./RapierRig";

/** Minimal type for Rapier's raw WASM impulse joint set. */
interface RawJointSet {
  jointConfigureMotorPosition(handle: number, axis: number, target: number, stiffness: number, damping: number): void;
  jointConfigureMotorModel(handle: number, axis: number, model: number): void;
}

export class RapierRigIO implements RigIO {
  private readonly RAPIER: RapierModule;
  private readonly world: RapierWorld;
  private readonly rig: RapierRig;
  private readonly def: RigDefinition;

  private _dt = 1 / 60;

  // Cache for foot raycast length
  private readonly footRayLen = 0.14;

  constructor(RAPIER: RapierModule, world: RapierWorld, rig: RapierRig) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.rig = rig;
    this.def = rig.def;
  }

  setDt(dt: number): void {
    // Clamp dt to avoid huge impulses if the tab hitches
    this._dt = clamp(dt, 1 / 240, 1 / 20);
  }

  dt(): number {
    return this._dt;
  }

  worldUp(): Vec3 {
    return { x: 0, y: 1, z: 0 };
  }

  // ---------------------------------------------------------------------------
  // Samples
  // ---------------------------------------------------------------------------

  sampleBody(part: PartName): BodySample {
    const rb = this.rig.getBody(part);

    const t = rb.translation();
    const r = rb.rotation();
    const lv = rb.linvel();
    const av = rb.angvel();

    const mass = rb.mass();

    return {
      pos: { x: t.x, y: t.y, z: t.z },
      rot: { x: r.x, y: r.y, z: r.z, w: r.w },
      linVel: { x: lv.x, y: lv.y, z: lv.z },
      angVel: { x: av.x, y: av.y, z: av.z },
      mass,
    };
  }

  comWorld(): Vec3 {
    const parts = this.rig.listParts();
    let total = 0;
    let acc = v3(0, 0, 0);

    for (const p of parts) {
      const s = this.sampleBody(p);
      total += s.mass;
      acc = add(acc, scale(s.pos, s.mass));
    }

    if (total <= 1e-9) return v3(0, 0, 0);
    return scale(acc, 1 / total);
  }

  comVelWorld(): Vec3 {
    const parts = this.rig.listParts();
    let total = 0;
    let acc = v3(0, 0, 0);

    for (const p of parts) {
      const s = this.sampleBody(p);
      total += s.mass;
      acc = add(acc, scale(s.linVel, s.mass));
    }

    if (total <= 1e-9) return v3(0, 0, 0);
    return scale(acc, 1 / total);
  }

  // ---------------------------------------------------------------------------
  // Feet / ground contact
  // ---------------------------------------------------------------------------

  footContact(foot: FootName): FootContact {
    const footDef = this.def.feet.find((f) => f.name === foot);
    if (!footDef) throw new Error(`RigDefinition missing foot ${foot}`);

    const footRb = this.rig.getBody(footDef.part as PartName);
    const footBody = this.sampleBody(footDef.part as PartName);

    // Sole world point = footPos + footRot * soleLocalPoint
    const soleWorld = add(footBody.pos, qRotateVec3(footBody.rot, footDef.soleLocalPoint));

    const rayOrigin = soleWorld;
    const rayDir = { x: 0, y: -1, z: 0 };

    const ray = new this.RAPIER.Ray(rayOrigin, rayDir);

    // Exclude the foot's own rigid body from the raycast so we don't
    // self-intersect. Parameters 4-6 (filterFlags, filterGroups,
    // filterExcludeCollider) are left undefined; parameter 7 is the
    // rigid body to exclude.
    const hit: RayColliderIntersection | null = this.world.castRayAndGetNormal(
      ray,
      this.footRayLen,
      true,
      undefined,
      undefined,
      undefined,
      footRb
    );

    if (!hit) {
      return { grounded: false, contacts: [] };
    }

    const point = {
      x: rayOrigin.x + rayDir.x * hit.timeOfImpact,
      y: rayOrigin.y + rayDir.y * hit.timeOfImpact,
      z: rayOrigin.z + rayDir.z * hit.timeOfImpact,
    };

    const n = hit.normal;

    return {
      grounded: true,
      contacts: [{ point, normal: { x: n.x, y: n.y, z: n.z } }],
      avgPoint: point,
      avgNormal: { x: n.x, y: n.y, z: n.z },
    };
  }

  // ---------------------------------------------------------------------------
  // Joints
  // ---------------------------------------------------------------------------

  readJoint(_joint: JointName): JointReadout {
    // Optional in v0. You can compute currentLocalRot similarly to driveJoint.
    return {};
  }

  driveJoint(joint: JointName, cmd: JointDriveCommand): void {
    const jd = this.rig.getJointDef(joint);

    // Both hinge and ball joints use Rapier's built-in constraint-solver
    // motor. This is solved implicitly (no one-frame lag), applies
    // equal-and-opposite torques to parent and child (Newton's 3rd law),
    // and transmits forces through the kinematic chain naturally.
    if (jd.limits.kind === "hinge") {
      this.driveHingeMotor(joint, jd, cmd);
      return;
    }

    this.driveBallMotor(joint, cmd);
  }

  /**
   * Update the Rapier built-in motor target for a revolute (hinge) joint.
   *
   * Extracts the signed angle around the hinge axis from the target
   * quaternion and sets it as the motor's target position. The stiffness
   * and damping from the command are scaled by 10x for Rapier's
   * constraint-force units.
   */
  private driveHingeMotor(joint: JointName, jd: JointDef, cmd: JointDriveCommand): void {
    const hingeAxis = jd.limits.axisLocalParent ?? { x: 1, y: 0, z: 0 };

    // Extract hinge angle from the target quaternion by projecting its
    // axis-angle representation onto the hinge axis.
    const aa = quatToAxisAngle(cmd.targetLocalRot);
    const proj = dot(aa.axis, hingeAxis);
    let targetAngle = aa.angle * proj;

    // Wrap to [-pi, pi]
    if (targetAngle > Math.PI) targetAngle -= 2 * Math.PI;
    if (targetAngle < -Math.PI) targetAngle += 2 * Math.PI;

    const rapierJoint = this.rig.getJoint(joint);
    const revolute = rapierJoint as unknown as {
      configureMotorPosition(target: number, stiffness: number, damping: number): void;
    };
    revolute.configureMotorPosition(targetAngle, cmd.kp * 10, cmd.kd * 10);

    // Override motor model: configureMotorPosition always sets
    // AccelerationBased (torque scaled by effective mass -- too weak for
    // balance actuation). ForceBased (1) uses stiffness as N*m/rad.
    // Revolute joints use AngX (3) as their motor axis.
    const rawSet = (rapierJoint as unknown as { rawSet: RawJointSet }).rawSet;
    rawSet.jointConfigureMotorModel(rapierJoint.handle, 3, 1);
  }

  /**
   * Drive a spherical (ball) joint using Rapier's per-axis built-in motor.
   *
   * Rapier's constraint solver handles the motor implicitly -- same as the
   * revolute motor but applied independently on AngX, AngY, AngZ. This
   * gives us:
   * - No one-frame lag (solved inside the constraint step)
   * - Newton's 3rd law (equal-and-opposite torques on parent and child)
   * - Higher effective stiffness than external torque impulses
   * - Natural force chain through the kinematic tree
   *
   * The target quaternion is decomposed into intrinsic XYZ Euler angles.
   * For small angles (typical for balance perturbations) this is accurate.
   */
  private driveBallMotor(joint: JointName, cmd: JointDriveCommand): void {
    const rapierJoint = this.rig.getJoint(joint);

    // Access the raw impulse joint set directly. The joint wrapper itself
    // stores the same rawSet reference used by the revolute motor path.
    const rawSet = (rapierJoint as unknown as { rawSet: RawJointSet }).rawSet;
    const handle = rapierJoint.handle;

    // RawJointAxis enum values (NOT the JointAxesMask bitmask!)
    // RawJointAxis: LinX=0, LinY=1, LinZ=2, AngX=3, AngY=4, AngZ=5
    const ANG_X = 3;
    const ANG_Y = 4;
    const ANG_Z = 5;

    // Decompose target quaternion into intrinsic XYZ Euler angles.
    // For rest pose (identity quat), all angles are 0.
    const euler = quatToEulerXYZ(cmd.targetLocalRot);

    const stiffness = cmd.kp * 10;
    const damping = cmd.kd * 10;

    rawSet.jointConfigureMotorPosition(handle, ANG_X, euler.x, stiffness, damping);
    rawSet.jointConfigureMotorPosition(handle, ANG_Y, euler.y, stiffness, damping);
    rawSet.jointConfigureMotorPosition(handle, ANG_Z, euler.z, stiffness, damping);

    // Override motor model: configureMotorPosition always sets
    // AccelerationBased (torque scaled by effective mass -- too weak for
    // balance). ForceBased (1) uses stiffness directly as N*m/rad.
    const FORCE_BASED = 1;
    rawSet.jointConfigureMotorModel(handle, ANG_X, FORCE_BASED);
    rawSet.jointConfigureMotorModel(handle, ANG_Y, FORCE_BASED);
    rawSet.jointConfigureMotorModel(handle, ANG_Z, FORCE_BASED);
  }

  applyTorque(part: PartName, torqueWorld: Vec3): void {
    // Continuous torque. Not all bindings expose this; we use impulse below.
    this.applyTorqueImpulse(part, torqueWorld);
  }

  /**
   * Apply a PD torque that tries to keep a body's local Y axis aligned with
   * world up AND resists yaw (spin around world Y).
   *
   * Tilt correction: aligns local Y with world Y (pitch + roll).
   * Yaw damping: resists angular velocity around world Y so asymmetric
   * joint reactions don't cause the rig to spiral.
   */
  applyUprightTorque(part: PartName, params: { kp: number; kd: number; maxTorque: number; yawKd?: number }): void {
    const sample = this.sampleBody(part);

    // --- Tilt correction (pitch + roll) ---
    // Current local Y in world space
    const localUp = qRotateVec3(sample.rot, { x: 0, y: 1, z: 0 });
    const worldUp = { x: 0, y: 1, z: 0 };

    // Cross product gives the rotation axis and sin(angle)
    const c = cross(localUp, worldUp);
    const sinAngle = len(c);
    const cosAngle = clamp(dot(localUp, worldUp), -1, 1);

    let tiltTorque = v3(0, 0, 0);
    if (sinAngle > 1e-6) {
      const axis = normalize(c);
      const angle = Math.atan2(sinAngle, cosAngle);

      // Project angular velocity onto the correction axis for damping
      const omegaProj = dot(sample.angVel, axis);

      const torqueMag = clamp(params.kp * angle - params.kd * omegaProj, -params.maxTorque, params.maxTorque);
      tiltTorque = scale(axis, torqueMag);
    }

    // --- Yaw damping (resist spin around world Y) ---
    // Without this, asymmetric PD reactions from hip joints create net yaw
    // torque with nothing to resist it, causing a spiral.
    const yawKd = params.yawKd ?? params.kd;
    const omegaY = sample.angVel.y;
    const yawDamp = clamp(-yawKd * omegaY, -params.maxTorque, params.maxTorque);
    const yawTorque = v3(0, yawDamp, 0);

    const total = add(tiltTorque, yawTorque);
    this.applyTorqueImpulse(part, total);
  }

  groundRaycast(from: Vec3, to: Vec3): { hit: boolean; point?: Vec3; normal?: Vec3 } {
    // Cast a ray from "from" to "to". Returns the first hit.
    // Note: Depending on your Rapier binding/version, castRay signature differs.
    const dir = sub(to, from);
    const dist = len(dir);
    if (dist <= 1e-9) return { hit: false };

    const dirN = scale(dir, 1 / dist);

    const ray = new this.RAPIER.Ray(from, dirN);
    const hit: RayColliderIntersection | null = this.world.castRayAndGetNormal(ray, dist, true);

    if (!hit) return { hit: false };

    const p = {
      x: from.x + dirN.x * hit.timeOfImpact,
      y: from.y + dirN.y * hit.timeOfImpact,
      z: from.z + dirN.z * hit.timeOfImpact,
    };

    const n = hit.normal;

    return { hit: true, point: p, normal: { x: n.x, y: n.y, z: n.z } };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  applyForce(part: PartName, forceWorld: Vec3): void {
    const rb = this.rig.getBody(part);

    // Convert continuous force (N) to impulse (N*s) for this tick
    const impulse = scale(forceWorld, this._dt);
    rb.applyImpulse(impulse, true);
  }

  setAllLinearDamping(damping: number): void {
    for (const part of this.rig.listParts()) {
      this.rig.getBody(part).setLinearDamping(damping);
    }
  }

  private applyTorqueImpulse(part: PartName, torqueWorld: Vec3): void {
    const rb = this.rig.getBody(part);

    // Convert torque (N*m) to torque impulse (N*m*s) for this tick
    const impulse = scale(torqueWorld, this._dt);
    rb.applyTorqueImpulse(impulse, true);
  }
}
