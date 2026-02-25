// src/physics/RapierRigIO.ts
//
// Implements RigIO on top of RapierRig + Rapier world.
//
// This version is intentionally "v0":
// - driveJoint applies PD torques directly to parent/child bodies (world-space).
// - footContact uses raycasts from soleLocalPoint downward.
// - comWorld/comVelWorld are mass-weighted averages of rigid bodies.
//
// You can expand this incrementally without changing the controller surface area.

import type { RayColliderIntersection } from "@dimforge/rapier3d-compat";
import type { Quat, Vec3 } from "@/lib/math";
import { clamp, dot, len, normalize, qInverse, qMul, qNormalize, qRotateVec3, scale, sub, v3 } from "@/lib/math";
import type { BodySample, FootName, JointName, PartName, RigDefinition } from "@/rig/RigDefinition";
import type { FootContact, JointDriveCommand, JointReadout, RigIO } from "@/rig/RigIO";
import type { RapierModule, RapierRig, RapierWorld } from "./RapierRig";

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

    const footBody = this.sampleBody(footDef.part as PartName);

    // Sole world point = footPos + footRot * soleLocalPoint
    const soleWorld = add(footBody.pos, qRotateVec3(footBody.rot, footDef.soleLocalPoint));

    const rayOrigin = soleWorld;
    const rayDir = { x: 0, y: -1, z: 0 };

    const ray = new this.RAPIER.Ray(rayOrigin, rayDir);
    const hit: RayColliderIntersection | null = this.world.castRayAndGetNormal(ray, this.footRayLen, true);

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

    const parent = this.sampleBody(jd.parent as PartName);
    const child = this.sampleBody(jd.child as PartName);

    // Compute joint frame rotations in world:
    // parentJointRotWorld = parent.rot * parentFrameRot
    // childJointRotWorld  = child.rot  * childFrameRot
    const parentJointRotWorld = qMul(parent.rot, jd.parentFrameRot);
    const childJointRotWorld = qMul(child.rot, jd.childFrameRot);

    // Current relative rotation in JOINT SPACE:
    // currentRel = inv(parentJoint) * childJoint
    const currentRel = qMul(qInverse(parentJointRotWorld), childJointRotWorld);

    // Error: target * inv(current)
    const qErr = qMul(cmd.targetLocalRot, qInverse(currentRel));
    const qErrN = qNormalize(qErr);

    // Axis-angle from quaternion error
    const aa = quatToAxisAngle(qErrN);
    const axisLocal = aa.axis; // in JOINT SPACE
    let angle = aa.angle; // radians, signed-ish

    // Wrap to [-pi, pi] for stability
    if (angle > Math.PI) angle -= 2 * Math.PI;
    if (angle < -Math.PI) angle += 2 * Math.PI;

    // If tiny error, skip
    if (Math.abs(angle) < 1e-5) return;

    // Convert axis to WORLD for torque direction:
    // axisWorld = parentJointRotWorld * axisLocal
    const axisWorld = qRotateVec3(parentJointRotWorld, axisLocal);

    // Relative angular velocity along axis (world)
    // relAngVel = child.angVel - parent.angVel
    const relAngVel = sub(child.angVel, parent.angVel);
    const relOmega = dot(relAngVel, axisWorld);

    // PD torque magnitude
    const torqueMag = cmd.kp * angle - cmd.kd * relOmega;

    // Clamp
    const maxT = Math.max(0, cmd.maxTorque);
    const clampedMag = clamp(torqueMag, -maxT, maxT);

    const torqueWorld = scale(axisWorld, clampedMag);

    // Apply equal/opposite torques as impulses for this tick.
    // Use applyTorqueImpulse if available; else applyTorque (depends on build).
    this.applyTorqueImpulse(jd.parent as PartName, scale(torqueWorld, -1));
    this.applyTorqueImpulse(jd.child as PartName, torqueWorld);
  }

  applyTorque(part: PartName, torqueWorld: Vec3): void {
    // Continuous torque. Not all bindings expose this; we use impulse below.
    this.applyTorqueImpulse(part, torqueWorld);
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

  private applyTorqueImpulse(part: PartName, torqueWorld: Vec3): void {
    const rb = this.rig.getBody(part);

    // Convert torque (N*m) to torque impulse (N*m*s) for this tick
    const impulse = scale(torqueWorld, this._dt);
    rb.applyTorqueImpulse(impulse, true);
  }
}

// -----------------------------------------------------------------------------
// Local helpers
// -----------------------------------------------------------------------------

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function quatToAxisAngle(qq: Quat): { axis: Vec3; angle: number } {
  // qq assumed normalized
  const w = clamp(qq.w, -1, 1);
  const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));

  // If very small, axis doesn't matter
  if (sinHalf < 1e-8) {
    return { axis: { x: 1, y: 0, z: 0 }, angle: 0 };
  }

  const axis = {
    x: qq.x / sinHalf,
    y: qq.y / sinHalf,
    z: qq.z / sinHalf,
  };

  const angle = 2 * Math.atan2(sinHalf, w);
  return { axis: normalize(axis), angle };
}
