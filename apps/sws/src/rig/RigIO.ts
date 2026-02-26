import type { Quat, Vec3 } from "@/lib/math";
import type { BodySample, ContactSample, FootName, JointName, PartName } from "@/rig/RigDefinition";

export interface JointDriveCommand {
  targetLocalRot: Quat; // desired child-relative-to-parent rotation in JOINT SPACE
  kp: number;
  kd: number;
  maxTorque: number;
}

export interface JointReadout {
  // current child-relative-to-parent rotation in JOINT SPACE (optional but useful for debugging)
  currentLocalRot?: Quat;
  // optional: relative angVel in joint space
}

export interface FootContact {
  grounded: boolean;
  contacts: ContactSample[]; // can be empty
  // convenience:
  avgPoint?: Vec3;
  avgNormal?: Vec3;
}

export interface RigIO {
  // Time + axes
  dt(): number;
  worldUp(): Vec3;

  // Samples
  sampleBody(part: PartName): BodySample;
  comWorld(): Vec3;
  comVelWorld(): Vec3;

  // Feet
  footContact(foot: FootName): FootContact;

  // Read/drive joints
  readJoint(joint: JointName): JointReadout;
  driveJoint(joint: JointName, cmd: JointDriveCommand): void;

  // Apply direct torques (used by stabilizer upright correction)
  applyTorque(part: PartName, torqueWorld: Vec3): void;

  // Apply a world-space force at the body's center of mass.
  // Used for swing-leg gravity compensation during step.
  applyForce(part: PartName, forceWorld: Vec3): void;

  // Utility (optional)
  groundRaycast(from: Vec3, to: Vec3): { hit: boolean; point?: Vec3; normal?: Vec3 };
}
