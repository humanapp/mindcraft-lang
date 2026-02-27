// src/rig/RigDefinition.v0.ts
//
// R6 silhouette + hidden leg articulation (knees + ankles/feet).
// Units: meters. Right-handed. +Y up, +Z forward, +X right.
// Rest pose is specified ROOT-RELATIVE (Root at origin). Your builder can
// place Root at spawn and add these offsets.
//
// This is a "stable starting point" rig, not final tuning.

import { q, rad, v3 } from "@/lib/math";
import type { FootDef, JointDef, PartDef, RigDefinition } from "./RigDefinition";

// Identity rotation
const ID = q(0, 0, 0, 1);

// Helpers
const box = (hx: number, hy: number, hz: number) => ({ kind: "box" as const, halfExtents: v3(hx, hy, hz) });
const capY = (radius: number, halfHeight: number) => ({
  kind: "capsule" as const,
  radius,
  halfHeight,
  // Capsule is assumed oriented along local Y in your backend.
});

// ----------------------------------------------------------------------------
// Parts
// ----------------------------------------------------------------------------

const parts: PartDef[] = [
  // Root (pelvis) -- lower half of R6 torso block.
  // R6 torso: 2x2x1 studs (0.56x0.56x0.28m). Split into Root + Torso,
  // each 0.28m tall. Combined: 0.56m, matching R6.
  {
    name: "Root",
    mass: 6,
    collision: [box(0.28, 0.14, 0.14)], // 0.56 x 0.28 x 0.28m (R6 torso width, lower half)
    restPos: v3(0, 0, 0),
    restRot: ID,
  },
  {
    name: "Torso",
    mass: 5,
    collision: [box(0.28, 0.14, 0.14)], // 0.56 x 0.28 x 0.28m (R6 torso width, upper half)
    restPos: v3(0, 0.28, 0),
    restRot: ID,
  },
  {
    name: "Head",
    mass: 0.1,
    collision: [box(0.175, 0.168, 0.175)], // 0.35 x 0.336 x 0.35m (~1.25 stud cube, R6 SpecialMesh Head)
    restPos: v3(0, 0.588, 0),
    restRot: ID,
  },

  // Arms (single segment). R6 arm: 1x2x1 studs (0.28x0.56x0.28m).
  {
    name: "LeftArm",
    mass: 1.5,
    collision: [box(0.14, 0.28, 0.14)], // 0.28 x 0.56 x 0.28m (1 x 2 x 1 studs)
    restPos: v3(-0.42, 0.14, 0),
    restRot: ID,
  },
  {
    name: "RightArm",
    mass: 1.5,
    collision: [box(0.14, 0.28, 0.14)], // 0.28 x 0.56 x 0.28m (1 x 2 x 1 studs)
    restPos: v3(0.42, 0.14, 0),
    restRot: ID,
  },

  // Legs: upper + lower + foot. R6 leg: 1x2x1 studs (0.28x0.56x0.28m).
  // Split into upper(0.24m) + lower(0.24m) + foot(0.08m) = 0.56m.
  {
    name: "LeftUpperLeg",
    mass: 3,
    collision: [box(0.14, 0.12, 0.14)], // 0.28 x 0.24 x 0.28m
    restPos: v3(-0.14, -0.26, 0),
    restRot: ID,
  },
  {
    name: "LeftLowerLeg",
    mass: 2.5,
    collision: [box(0.14, 0.12, 0.14)], // 0.28 x 0.24 x 0.28m
    restPos: v3(-0.14, -0.5, 0),
    restRot: ID,
  },
  {
    name: "LeftFoot",
    mass: 2.5,
    collision: [box(0.14, 0.04, 0.14)], // 0.28 x 0.08 x 0.28m
    restPos: v3(-0.14, -0.66, 0),
    restRot: ID,
  },

  {
    name: "RightUpperLeg",
    mass: 3,
    collision: [box(0.14, 0.12, 0.14)], // 0.28 x 0.24 x 0.28m
    restPos: v3(0.14, -0.26, 0),
    restRot: ID,
  },
  {
    name: "RightLowerLeg",
    mass: 2.5,
    collision: [box(0.14, 0.12, 0.14)], // 0.28 x 0.24 x 0.28m
    restPos: v3(0.14, -0.5, 0),
    restRot: ID,
  },
  {
    name: "RightFoot",
    mass: 2.5,
    collision: [box(0.14, 0.04, 0.14)], // 0.28 x 0.08 x 0.28m
    restPos: v3(0.14, -0.66, 0),
    restRot: ID,
  },
];

// ----------------------------------------------------------------------------
// Joint limits + default drives
// ----------------------------------------------------------------------------

const joints: JointDef[] = [
  // Root <-> Torso (ball) -- joint at Root top / Torso bottom
  {
    name: "Root_Torso",
    parent: "Root",
    child: "Torso",
    parentFramePos: v3(0, 0.14, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, -0.14, 0),
    childFrameRot: ID,
    limits: { kind: "ball", swingDeg: 22, twistDeg: 16 },
    drive: { kp: 120, kd: 20, maxTorque: 320 },
  },

  // Torso <-> Head (ball, loose-ish) -- joint at Torso top / Head bottom
  {
    name: "Torso_Head",
    parent: "Torso",
    child: "Head",
    parentFramePos: v3(0, 0.14, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, -0.168, 0),
    childFrameRot: ID,
    limits: { kind: "ball", swingDeg: 30, twistDeg: 25 },
    drive: { kp: 35, kd: 7, maxTorque: 70 },
  },

  // Torso <-> Arms (ball) -- shoulders at R6 position (mid-height of Torso)
  {
    name: "Torso_LeftArm",
    parent: "Torso",
    child: "LeftArm",
    parentFramePos: v3(-0.28, 0.0, 0),
    parentFrameRot: ID,
    childFramePos: v3(0.14, 0.14, 0),
    childFrameRot: ID,
    limits: { kind: "ball", swingDeg: 70, twistDeg: 55 },
    drive: { kp: 45, kd: 9, maxTorque: 90 },
  },
  {
    name: "Torso_RightArm",
    parent: "Torso",
    child: "RightArm",
    parentFramePos: v3(0.28, 0.0, 0),
    parentFrameRot: ID,
    childFramePos: v3(-0.14, 0.14, 0),
    childFrameRot: ID,
    limits: { kind: "ball", swingDeg: 70, twistDeg: 55 },
    drive: { kp: 45, kd: 9, maxTorque: 90 },
  },

  // Root <-> Upper legs (ball) -- hips at Root bottom
  {
    name: "Root_LeftUpperLeg",
    parent: "Root",
    child: "LeftUpperLeg",
    parentFramePos: v3(-0.14, -0.14, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, 0.12, 0),
    childFrameRot: ID,
    limits: { kind: "ball", swingDeg: 90, twistDeg: 22 },
    drive: { kp: 90, kd: 14, maxTorque: 240 },
  },
  {
    name: "Root_RightUpperLeg",
    parent: "Root",
    child: "RightUpperLeg",
    parentFramePos: v3(0.14, -0.14, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, 0.12, 0),
    childFrameRot: ID,
    limits: { kind: "ball", swingDeg: 90, twistDeg: 22 },
    drive: { kp: 90, kd: 14, maxTorque: 240 },
  },

  // Knees (hinge, bend forward only)
  // Axis is local X (right) in parent joint frame; rotation around X = pitch.
  {
    name: "LeftUpperLeg_LeftLowerLeg",
    parent: "LeftUpperLeg",
    child: "LeftLowerLeg",
    parentFramePos: v3(0, -0.12, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, 0.12, 0),
    childFrameRot: ID,
    limits: { kind: "hinge", axisLocalParent: v3(1, 0, 0), minDeg: 0, maxDeg: 120 },
    drive: { kp: 75, kd: 12, maxTorque: 190 },
  },
  {
    name: "RightUpperLeg_RightLowerLeg",
    parent: "RightUpperLeg",
    child: "RightLowerLeg",
    parentFramePos: v3(0, -0.12, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, 0.12, 0),
    childFrameRot: ID,
    limits: { kind: "hinge", axisLocalParent: v3(1, 0, 0), minDeg: 0, maxDeg: 120 },
    drive: { kp: 75, kd: 12, maxTorque: 190 },
  },

  // Ankles (hinge, small range) -- at LowerLeg bottom / Foot top
  {
    name: "LeftLowerLeg_LeftFoot",
    parent: "LeftLowerLeg",
    child: "LeftFoot",
    parentFramePos: v3(0, -0.12, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, 0.04, 0),
    childFrameRot: ID,
    limits: { kind: "hinge", axisLocalParent: v3(1, 0, 0), minDeg: -25, maxDeg: 25 },
    drive: { kp: 15, kd: 5, maxTorque: 40 },
  },
  {
    name: "RightLowerLeg_RightFoot",
    parent: "RightLowerLeg",
    child: "RightFoot",
    parentFramePos: v3(0, -0.12, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, 0.04, 0),
    childFrameRot: ID,
    limits: { kind: "hinge", axisLocalParent: v3(1, 0, 0), minDeg: -25, maxDeg: 25 },
    drive: { kp: 15, kd: 5, maxTorque: 40 },
  },
];

// ----------------------------------------------------------------------------
// Feet
// ----------------------------------------------------------------------------

const feet: FootDef[] = [
  {
    name: "LeftFoot",
    part: "LeftFoot",
    // Center bottom of the foot sole. Determines the ground-contact
    // raycast origin and therefore the balance support point.
    soleLocalPoint: v3(0, -0.04, 0),
    forwardLocal: v3(0, 0, 1),
    upLocal: v3(0, 1, 0),
  },
  {
    name: "RightFoot",
    part: "RightFoot",
    soleLocalPoint: v3(0, -0.04, 0),
    forwardLocal: v3(0, 0, 1),
    upLocal: v3(0, 1, 0),
  },
];

// ----------------------------------------------------------------------------
// Export
// ----------------------------------------------------------------------------

export const RigDefinitionV0: RigDefinition = {
  units: "meters",
  root: "Root",
  torso: "Torso",
  head: "Head",
  parts,
  joints,
  feet,
};
