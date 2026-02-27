// src/physics/RapierRig.ts
//
// Builds a physics puppet in Rapier from a RigDefinition.
// This module does NOT depend on Three.js or React.
//
// Notes:
// - Uses only a subset of Rapier joint features (spherical + revolute).
// - Ball joint limits are left as TODO (Rapier support varies by version).
// - Joint frames (pos/rot) are stored for controller math in RapierRigIO.

import type RAPIER from "@dimforge/rapier3d-compat";
import type { World } from "@dimforge/rapier3d-compat";
import type { Quat, Vec3 } from "@/lib/math";
import type { CollisionShape, JointDef, JointName, PartDef, PartName, RigDefinition } from "@/rig/RigDefinition";

/** Minimal type for Rapier's raw WASM impulse joint set. */
interface RawJointSet {
  jointConfigureMotorPosition(handle: number, axis: number, target: number, stiffness: number, damping: number): void;
  jointConfigureMotorModel(handle: number, axis: number, model: number): void;
}

export type RapierModule = typeof RAPIER;
export type RapierWorld = World;

export interface RapierRigSpawn {
  rootWorldPos: Vec3;
  rootWorldRot: Quat;
}

export interface BuiltJoint {
  def: JointDef;
  joint: RAPIER.ImpulseJoint;
}

export interface BuiltBody {
  part: PartDef;
  body: RAPIER.RigidBody;
}

export class RapierRig {
  public readonly def: RigDefinition;

  private readonly RAPIER: RapierModule;
  public readonly world: RapierWorld;

  private readonly bodiesByPart = new Map<PartName, BuiltBody>();
  private readonly jointsByName = new Map<JointName, BuiltJoint>();

  constructor(RAPIER: RapierModule, world: RapierWorld, def: RigDefinition, spawn: RapierRigSpawn) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.def = def;

    // The rig's joint chain (root -> hip -> knee -> ankle -> foot -> ground)
    // is 5-6 constraints deep. Rapier's default 4 solver iterations is not
    // enough to propagate motor forces through this chain in a single step,
    // making joint motors almost completely ineffective. 8 iterations lets
    // the constraint solver propagate forces end-to-end reliably.
    if (world.numSolverIterations < 8) {
      world.numSolverIterations = 8;
    }

    this.buildBodies(spawn);
    this.buildJoints();
  }

  // ---------------------------------------------------------------------------
  // Public accessors
  // ---------------------------------------------------------------------------

  getBody(part: PartName): RAPIER.RigidBody {
    const b = this.bodiesByPart.get(part);
    if (!b) throw new Error(`RapierRig: missing body for part ${part}`);
    return b.body;
  }

  getJoint(name: JointName): RAPIER.ImpulseJoint {
    const j = this.jointsByName.get(name);
    if (!j) throw new Error(`RapierRig: missing joint ${name}`);
    return j.joint;
  }

  getJointDef(name: JointName): JointDef {
    const j = this.jointsByName.get(name);
    if (!j) throw new Error(`RapierRig: missing joint def ${name}`);
    return j.def;
  }

  hasPart(part: PartName): boolean {
    return this.bodiesByPart.has(part);
  }

  hasJoint(name: JointName): boolean {
    return this.jointsByName.has(name);
  }

  listParts(): PartName[] {
    return Array.from(this.bodiesByPart.keys());
  }

  listJoints(): JointName[] {
    return Array.from(this.jointsByName.keys());
  }

  getBodyHandle(part: PartName): number {
    const b = this.bodiesByPart.get(part);
    if (!b) throw new Error(`RapierRig: missing body for part ${part}`);
    return b.body.handle;
  }

  tryGetBodyHandle(part: PartName): number | undefined {
    return this.bodiesByPart.get(part)?.body.handle;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  dispose(): void {
    // Remove joints first (they reference bodies)
    for (const j of this.jointsByName.values()) {
      try {
        this.world.removeImpulseJoint(j.joint, true);
      } catch {
        // ignore
      }
    }
    this.jointsByName.clear();

    // Remove bodies
    for (const b of this.bodiesByPart.values()) {
      try {
        this.world.removeRigidBody(b.body);
      } catch {
        // ignore
      }
    }
    this.bodiesByPart.clear();
  }

  // ---------------------------------------------------------------------------
  // Reset -- teleport all bodies back to rest pose and zero all velocities.
  // This avoids the timing issues of dispose + recreate within the same
  // Rapier world step.
  // ---------------------------------------------------------------------------

  reset(spawn: RapierRigSpawn): void {
    const rootName = this.def.root;

    for (const { part, body } of this.bodiesByPart.values()) {
      const isRoot = part.name === rootName;
      const worldPos = isRoot
        ? spawn.rootWorldPos
        : addVec3(spawn.rootWorldPos, rotateVec3(spawn.rootWorldRot, part.restPos));
      const worldRot = isRoot ? spawn.rootWorldRot : mulQuat(spawn.rootWorldRot, part.restRot);

      // Ensure the body is dynamic (may have been set to kinematic during drag)
      body.setBodyType(0, true); // 0 = Dynamic

      body.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true);
      body.setRotation({ x: worldRot.x, y: worldRot.y, z: worldRot.z, w: worldRot.w }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.resetForces(true);
      body.resetTorques(true);
      body.wakeUp();
    }
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  private buildBodies(spawn: RapierRigSpawn): void {
    const rootName = this.def.root;

    // Find the root part def
    const rootDef = this.def.parts.find((p) => p.name === rootName);
    if (!rootDef) throw new Error(`RigDefinition missing root part ${rootName}`);

    // Build root first
    const rootBody = this.createBodyFromPart(rootDef, spawn.rootWorldPos, spawn.rootWorldRot);
    this.bodiesByPart.set(rootName, { part: rootDef, body: rootBody });

    // Build other parts root-relative
    for (const part of this.def.parts) {
      if (part.name === rootName) continue;

      const worldPos = addVec3(spawn.rootWorldPos, rotateVec3(spawn.rootWorldRot, part.restPos));
      const worldRot = mulQuat(spawn.rootWorldRot, part.restRot);

      const body = this.createBodyFromPart(part, worldPos, worldRot);
      this.bodiesByPart.set(part.name as PartName, { part, body });
    }
  }

  private buildJoints(): void {
    for (const jd of this.def.joints) {
      const parentBody = this.getBody(jd.parent as PartName);
      const childBody = this.getBody(jd.child as PartName);

      const joint = this.createImpulseJoint(jd, parentBody, childBody);
      this.jointsByName.set(jd.name as JointName, { def: jd, joint });
    }
  }

  private createBodyFromPart(part: PartDef, worldPos: Vec3, worldRot: Quat): RAPIER.RigidBody {
    const R = this.RAPIER;

    // Use dynamic rigid bodies for all parts
    const rbDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(worldPos.x, worldPos.y, worldPos.z)
      .setRotation({ x: worldRot.x, y: worldRot.y, z: worldRot.z, w: worldRot.w })
      .setLinearDamping(6.5)
      .setAngularDamping(4.0);

    const rb = this.world.createRigidBody(rbDesc);

    // Colliders -- density drives mass contribution; we also add explicit mass below.
    // Collision groups: membership = group 1, filter = group 0 only.
    // This lets rig parts collide with the environment (group 0) but not
    // with each other (all in group 1, which is excluded from the filter).
    const rigCollisionGroups = (0x0002 << 16) | 0x0001;

    for (const shape of part.collision) {
      const colDesc = this.createColliderDesc(shape)
        .setDensity(1.0)
        .setCollisionGroups(rigCollisionGroups)
        .setSolverGroups(rigCollisionGroups);
      this.world.createCollider(colDesc, rb);
    }

    // Apply explicit additional mass (keeps collider-based inertia reasonable).
    rb.setAdditionalMass(part.mass, true);

    return rb;
  }

  private createColliderDesc(shape: CollisionShape): RAPIER.ColliderDesc {
    const RAPIER = this.RAPIER;

    let cd: RAPIER.ColliderDesc;

    if (shape.kind === "box") {
      cd = RAPIER.ColliderDesc.cuboid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
    } else if (shape.kind === "capsule") {
      // Capsule oriented along local Y by default
      cd = RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius);
    } else {
      throw new Error(`Unsupported collision shape ${(shape as CollisionShape).kind}`);
    }

    if (shape.offsetPos) cd.setTranslation(shape.offsetPos.x, shape.offsetPos.y, shape.offsetPos.z);
    if (shape.offsetRot)
      cd.setRotation({ x: shape.offsetRot.x, y: shape.offsetRot.y, z: shape.offsetRot.z, w: shape.offsetRot.w });

    // Friction/restitution defaults; tune later.
    cd.setFriction?.(1.0);
    cd.setRestitution?.(0.0);

    return cd;
  }

  private createImpulseJoint(
    jd: JointDef,
    parentBody: RAPIER.RigidBody,
    childBody: RAPIER.RigidBody
  ): RAPIER.ImpulseJoint {
    const R = this.RAPIER;

    // Joint anchors are specified in each body's local space.
    // Frame rotations are stored for controller math in RapierRigIO;
    // Rapier's basic spherical/revolute joints use anchor + axis only.
    const a1 = { x: jd.parentFramePos.x, y: jd.parentFramePos.y, z: jd.parentFramePos.z };
    const a2 = { x: jd.childFramePos.x, y: jd.childFramePos.y, z: jd.childFramePos.z };

    let jointData: RAPIER.JointData;

    if (jd.limits.kind === "hinge") {
      const axis = jd.limits.axisLocalParent ?? { x: 1, y: 0, z: 0 };
      const ax = { x: axis.x, y: axis.y, z: axis.z };

      jointData = R.JointData.revolute(a1, a2, ax);

      // Revolute limits (in radians)
      if (typeof jd.limits.minDeg === "number" && typeof jd.limits.maxDeg === "number") {
        const min = (jd.limits.minDeg * Math.PI) / 180;
        const max = (jd.limits.maxDeg * Math.PI) / 180;
        jointData.limitsEnabled = true;
        jointData.limits = [min, max];
      }
    } else {
      jointData = R.JointData.spherical(a1, a2);
    }

    const joint = this.world.createImpulseJoint(jointData, parentBody, childBody, true);

    // For revolute joints, enforce limits on the joint object (belt-and-
    // suspenders with the JointData properties) and configure the built-in
    // position motor.
    if (jd.limits.kind === "hinge") {
      const revolute = joint as unknown as {
        configureMotorPosition(target: number, stiffness: number, damping: number): void;
        setLimits(min: number, max: number): void;
      };

      if (typeof jd.limits.minDeg === "number" && typeof jd.limits.maxDeg === "number") {
        const minRad = (jd.limits.minDeg * Math.PI) / 180;
        const maxRad = (jd.limits.maxDeg * Math.PI) / 180;
        revolute.setLimits(minRad, maxRad);
      }

      revolute.configureMotorPosition(0, jd.drive.kp * 10, jd.drive.kd * 10);

      // Override motor model: configureMotorPosition always sets
      // AccelerationBased (torque scaled by effective mass -- too weak for
      // balance). ForceBased uses stiffness directly as N*m/rad.
      // Revolute joints use AngX (3); ForceBased = 1.
      const rawSet = (joint as unknown as { rawSet: RawJointSet }).rawSet;
      rawSet.jointConfigureMotorModel(joint.handle, 3, 1);
    } else {
      // Spherical (ball) joints: configure per-axis motors at rest pose (0)
      // using the raw WASM API. Without this, ball joints that are never
      // driven by a controller (e.g. head, arms) would have no motor at all
      // and flop freely under gravity.
      this.initBallJointMotor(joint, jd.drive.kp, jd.drive.kd);
    }

    return joint;
  }
  /**
   * Configure per-axis position motors on a spherical (ball) joint at rest
   * pose (target = 0 on all angular axes).
   *
   * Uses the raw WASM API because Rapier's SphericalImpulseJoint wrapper
   * does not expose a high-level motor API. The pattern mirrors
   * RapierRigIO.driveBallMotor.
   */
  private initBallJointMotor(joint: RAPIER.ImpulseJoint, kp: number, kd: number): void {
    const rawSet = (joint as unknown as { rawSet: RawJointSet }).rawSet;
    const handle = joint.handle;

    // RawJointAxis enum: AngX=3, AngY=4, AngZ=5
    const ANG_X = 3;
    const ANG_Y = 4;
    const ANG_Z = 5;

    const stiffness = kp * 10;
    const damping = kd * 10;

    rawSet.jointConfigureMotorPosition(handle, ANG_X, 0, stiffness, damping);
    rawSet.jointConfigureMotorPosition(handle, ANG_Y, 0, stiffness, damping);
    rawSet.jointConfigureMotorPosition(handle, ANG_Z, 0, stiffness, damping);

    // Override motor model: configureMotorPosition always sets
    // AccelerationBased. ForceBased (1) uses stiffness directly as N*m/rad.
    rawSet.jointConfigureMotorModel(handle, ANG_X, 1);
    rawSet.jointConfigureMotorModel(handle, ANG_Y, 1);
    rawSet.jointConfigureMotorModel(handle, ANG_Z, 1);
  }
}

// -----------------------------------------------------------------------------
// Minimal math helpers local to this file (avoid importing controller math)
// -----------------------------------------------------------------------------

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** Rotate a vector by a unit quaternion. */
function rotateVec3(qq: Quat, v: Vec3): Vec3 {
  // q * v * q^-1, expanded to avoid temporary quaternion allocations.
  const ix = qq.w * v.x + qq.y * v.z - qq.z * v.y;
  const iy = qq.w * v.y + qq.z * v.x - qq.x * v.z;
  const iz = qq.w * v.z + qq.x * v.y - qq.y * v.x;
  const iw = -qq.x * v.x - qq.y * v.y - qq.z * v.z;
  return {
    x: ix * qq.w + iw * -qq.x + iy * -qq.z - iz * -qq.y,
    y: iy * qq.w + iw * -qq.y + iz * -qq.x - ix * -qq.z,
    z: iz * qq.w + iw * -qq.z + ix * -qq.y - iy * -qq.x,
  };
}

function mulQuat(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}
