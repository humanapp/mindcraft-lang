import type { Quat, Vec3 } from "@/lib/math";

export type PartName =
  | "Root"
  | "Torso"
  | "Head"
  | "LeftArm"
  | "RightArm"
  | "LeftUpperLeg"
  | "LeftLowerLeg"
  | "LeftFoot"
  | "RightUpperLeg"
  | "RightLowerLeg"
  | "RightFoot";

export type JointName =
  | "Root_Torso"
  | "Torso_Head"
  | "Torso_LeftArm"
  | "Torso_RightArm"
  | "Root_LeftUpperLeg"
  | "LeftUpperLeg_LeftLowerLeg"
  | "LeftLowerLeg_LeftFoot"
  | "Root_RightUpperLeg"
  | "RightUpperLeg_RightLowerLeg"
  | "RightLowerLeg_RightFoot";

export type FootName = "LeftFoot" | "RightFoot";

export interface BodySample {
  pos: Vec3; // world
  rot: Quat; // world
  linVel: Vec3; // world
  angVel: Vec3; // world
  mass: number;
}

export interface ContactSample {
  point: Vec3; // world
  normal: Vec3; // world
  // optional: impulse, friction, etc.
}

export interface BoxShape {
  kind: "box";
  halfExtents: Vec3; // meters (or your chosen units)
  offsetPos?: Vec3; // local to body
  offsetRot?: Quat; // local to body
}

export interface CapsuleShape {
  kind: "capsule";
  radius: number;
  halfHeight: number;
  offsetPos?: Vec3;
  offsetRot?: Quat;
}

export type CollisionShape = BoxShape | CapsuleShape;

export interface PartDef {
  name: PartName;
  mass: number;
  collision: CollisionShape[];
  // rest pose placement relative to Root (for initial build)
  restPos: Vec3; // world at spawn time, or root-relative if you prefer
  restRot: Quat;
}

export interface JointLimits {
  // Keep this abstract; backend maps to constraint limits.
  // For "ball": swing cone + twist
  // For "hinge": axis with min/max
  kind: "ball" | "hinge";
  // ball
  swingDeg?: number;
  twistDeg?: number;
  // hinge
  axisLocalParent?: Vec3; // normalized
  minDeg?: number;
  maxDeg?: number;
}

export interface JointDef {
  name: JointName;
  parent: PartName;
  child: PartName;

  // Joint frames: transforms from parent/child body local space into joint space.
  // This is the key to portability.
  parentFramePos: Vec3;
  parentFrameRot: Quat;
  childFramePos: Vec3;
  childFrameRot: Quat;

  limits: JointLimits;

  // Default drive tuning (controller can override each tick)
  drive: {
    kp: number; // stiffness
    kd: number; // damping
    maxTorque: number;
  };
}

export interface FootDef {
  name: FootName;
  part: PartName; // "LeftFoot" / "RightFoot"
  // For raycasts and ground contact points:
  soleLocalPoint: Vec3; // local point at bottom of foot
  // Optional: foot forward axis and up axis if you want foot alignment:
  forwardLocal?: Vec3;
  upLocal?: Vec3;
}

export interface RigDefinition {
  units: "meters";
  parts: PartDef[];
  joints: JointDef[];
  feet: FootDef[];
  root: "Root";
  torso: "Torso";
  head: "Head";
}
