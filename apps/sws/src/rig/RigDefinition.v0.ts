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
  // Root as a capsule makes balance less "catchy" on corners.
  {
    name: "Root",
    mass: 6,
    collision: [capY(0.16, 0.135)], // ~0.59m tall capsule
    restPos: v3(0, 0, 0),
    restRot: ID,
  },
  {
    name: "Torso",
    mass: 8,
    collision: [box(0.22, 0.19, 0.14)], // ~0.44 x 0.38 x 0.28
    restPos: v3(0, 0.37, 0),
    restRot: ID,
  },
  {
    name: "Head",
    mass: 0.1,
    collision: [box(0.16, 0.16, 0.16)], // ~0.32 cube
    restPos: v3(0, 0.72, 0),
    restRot: ID,
  },

  // Arms (single segment, Roblox-y)
  {
    name: "LeftArm",
    mass: 0.1,
    collision: [capY(0.07, 0.18)], // ~0.50m
    restPos: v3(-0.33, 0.49, 0),
    restRot: ID,
  },
  {
    name: "RightArm",
    mass: 0.1,
    collision: [capY(0.07, 0.18)],
    restPos: v3(0.33, 0.49, 0),
    restRot: ID,
  },

  // Legs: upper + lower + foot (lower/foot can be invisible in rendering)
  {
    name: "LeftUpperLeg",
    mass: 3,
    collision: [capY(0.075, 0.2)], // ~0.55m
    restPos: v3(-0.18, -0.33, 0),
    restRot: ID,
  },
  {
    name: "LeftLowerLeg",
    mass: 2,
    collision: [capY(0.07, 0.18)], // ~0.50m
    restPos: v3(-0.18, -0.75, 0),
    restRot: ID,
  },
  {
    name: "LeftFoot",
    mass: 5,
    collision: [box(0.1, 0.04, 0.14)], // ~0.20 x 0.08 x 0.28
    restPos: v3(-0.18, -0.98, 0),
    restRot: ID,
  },

  {
    name: "RightUpperLeg",
    mass: 3,
    collision: [capY(0.075, 0.2)],
    restPos: v3(0.18, -0.33, 0),
    restRot: ID,
  },
  {
    name: "RightLowerLeg",
    mass: 2,
    collision: [capY(0.07, 0.18)],
    restPos: v3(0.18, -0.75, 0),
    restRot: ID,
  },
  {
    name: "RightFoot",
    mass: 5,
    collision: [box(0.1, 0.04, 0.14)],
    restPos: v3(0.18, -0.98, 0),
    restRot: ID,
  },
];

// ----------------------------------------------------------------------------
// Joint limits + default drives
// ----------------------------------------------------------------------------

const joints: JointDef[] = [
  // Root <-> Torso (ball)
  {
    name: "Root_Torso",
    parent: "Root",
    child: "Torso",
    parentFramePos: v3(0, 0.165, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, -0.19, 0),
    childFrameRot: ID,
    limits: { kind: "ball", swingDeg: 22, twistDeg: 16 },
    drive: { kp: 120, kd: 20, maxTorque: 320 },
  },

  // Torso <-> Head (ball, loose-ish)
  {
    name: "Torso_Head",
    parent: "Torso",
    child: "Head",
    parentFramePos: v3(0, 0.2, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, -0.16, 0),
    childFrameRot: ID,
    limits: { kind: "ball", swingDeg: 30, twistDeg: 25 },
    drive: { kp: 35, kd: 7, maxTorque: 70 },
  },

  // Torso <-> Arms (ball)
  {
    name: "Torso_LeftArm",
    parent: "Torso",
    child: "LeftArm",
    parentFramePos: v3(-0.24, 0.12, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, 0.18, 0),
    childFrameRot: ID,
    limits: { kind: "ball", swingDeg: 70, twistDeg: 55 },
    drive: { kp: 45, kd: 9, maxTorque: 90 },
  },
  {
    name: "Torso_RightArm",
    parent: "Torso",
    child: "RightArm",
    parentFramePos: v3(0.24, 0.12, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, 0.18, 0),
    childFrameRot: ID,
    limits: { kind: "ball", swingDeg: 70, twistDeg: 55 },
    drive: { kp: 45, kd: 9, maxTorque: 90 },
  },

  // Root <-> Upper legs (ball, fairly tight to keep Roblox-y)
  {
    name: "Root_LeftUpperLeg",
    parent: "Root",
    child: "LeftUpperLeg",
    parentFramePos: v3(-0.16, -0.135, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, 0.22, 0),
    childFrameRot: ID,
    limits: { kind: "ball", swingDeg: 38, twistDeg: 22 },
    drive: { kp: 90, kd: 14, maxTorque: 240 },
  },
  {
    name: "Root_RightUpperLeg",
    parent: "Root",
    child: "RightUpperLeg",
    parentFramePos: v3(0.16, -0.135, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, 0.22, 0),
    childFrameRot: ID,
    limits: { kind: "ball", swingDeg: 38, twistDeg: 22 },
    drive: { kp: 90, kd: 14, maxTorque: 240 },
  },

  // Knees (hinge, bend forward only)
  // Axis is local X (right) in parent joint frame; rotation around X = pitch.
  {
    name: "LeftUpperLeg_LeftLowerLeg",
    parent: "LeftUpperLeg",
    child: "LeftLowerLeg",
    parentFramePos: v3(0, -0.22, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, 0.2, 0),
    childFrameRot: ID,
    limits: { kind: "hinge", axisLocalParent: v3(1, 0, 0), minDeg: 0, maxDeg: 95 },
    drive: { kp: 75, kd: 12, maxTorque: 190 },
  },
  {
    name: "RightUpperLeg_RightLowerLeg",
    parent: "RightUpperLeg",
    child: "RightLowerLeg",
    parentFramePos: v3(0, -0.22, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, 0.2, 0),
    childFrameRot: ID,
    limits: { kind: "hinge", axisLocalParent: v3(1, 0, 0), minDeg: 0, maxDeg: 95 },
    drive: { kp: 75, kd: 12, maxTorque: 190 },
  },

  // Ankles (hinge, small range)
  {
    name: "LeftLowerLeg_LeftFoot",
    parent: "LeftLowerLeg",
    child: "LeftFoot",
    parentFramePos: v3(0, -0.2, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, 0.05, 0),
    childFrameRot: ID,
    limits: { kind: "hinge", axisLocalParent: v3(1, 0, 0), minDeg: -25, maxDeg: 25 },
    drive: { kp: 15, kd: 5, maxTorque: 40 },
  },
  {
    name: "RightLowerLeg_RightFoot",
    parent: "RightLowerLeg",
    child: "RightFoot",
    parentFramePos: v3(0, -0.2, 0),
    parentFrameRot: ID,
    childFramePos: v3(0, 0.05, 0),
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
