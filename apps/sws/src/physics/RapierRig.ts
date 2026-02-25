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
  private readonly world: RapierWorld;

  private readonly bodiesByPart = new Map<PartName, BuiltBody>();
  private readonly jointsByName = new Map<JointName, BuiltJoint>();

  constructor(RAPIER: RapierModule, world: RapierWorld, def: RigDefinition, spawn: RapierRigSpawn) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.def = def;

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

      const worldPos = addVec3(spawn.rootWorldPos, part.restPos);
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
      .setLinearDamping(0.05)
      .setAngularDamping(0.08);

    const rb = this.world.createRigidBody(rbDesc);

    // Colliders -- density drives mass contribution; we also add explicit mass below.
    for (const shape of part.collision) {
      const colDesc = this.createColliderDesc(shape).setDensity(1.0);
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

    return this.world.createImpulseJoint(jointData, parentBody, childBody, true);
  }
}

// -----------------------------------------------------------------------------
// Minimal math helpers local to this file (avoid importing controller math)
// -----------------------------------------------------------------------------

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function mulQuat(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}
