// Headless impulse-recovery test harness for the SWS humanoid rig.
//
// Spawns the rig in a pure Rapier physics world (no rendering), applies
// calibrated impulses from 8 directions x 3 magnitudes, steps physics for
// N seconds, and produces a pass/fail recovery scorecard.
//
// Usage:
//   cd apps/sws
//   npx tsx -r tsconfig-paths/register src/test/headless-harness.ts
//
// To test with custom CatchStepController overrides, edit the
// `catchStepOverrides` object below or import this module and call
// `runHarness(overrides)`.

import RAPIER from "@dimforge/rapier3d-compat";
import { BalanceController } from "@/controllers/BalanceController";
import type { CatchStepConfig } from "@/controllers/CatchStepController";
import { CatchStepController } from "@/controllers/CatchStepController";
import type { Vec3 } from "@/lib/math";
import { qFromAxisAngle, qRotateVec3, v3 } from "@/lib/math";
import { RapierRig } from "@/physics/RapierRig";
import { RapierRigIO } from "@/physics/RapierRigIO";
import { RigDefinitionV0 } from "@/rig/RigDefinition.v0";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DT = 1 / 60;
const SETTLE_FRAMES = 120; // 2s of standing to reach equilibrium before impulse
const SIM_FRAMES = 300; // 5s of simulation after impulse
const RECOVERY_TILT_THRESHOLD = 0.1; // rad -- below this = recovered

// Spawn position matches CharacterRig default
const SPAWN_POS = v3(0, 1.15, 0);

// 8 unit directions in the XZ plane (rig-local, +Z = forward)
const DIRECTION_LABELS = [
  "forward",
  "forward-right",
  "right",
  "back-right",
  "back",
  "back-left",
  "left",
  "forward-left",
] as const;

const DIRECTION_VECTORS: Vec3[] = [
  v3(0, 0, 1), // forward
  v3(Math.SQRT1_2, 0, Math.SQRT1_2), // forward-right
  v3(1, 0, 0), // right
  v3(Math.SQRT1_2, 0, -Math.SQRT1_2), // back-right
  v3(0, 0, -1), // back
  v3(-Math.SQRT1_2, 0, -Math.SQRT1_2), // back-left
  v3(-1, 0, 0), // left
  v3(-Math.SQRT1_2, 0, Math.SQRT1_2), // forward-left
];

interface MagnitudeLevel {
  label: string;
  newtonSeconds: number;
}

const MAGNITUDES: MagnitudeLevel[] = [
  { label: "small", newtonSeconds: 30 },
  { label: "medium", newtonSeconds: 70 },
  { label: "large", newtonSeconds: 120 },
];

// Facing yaws to test orientation independence (radians around +Y)
const FACING_YAWS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
const FACING_YAW_LABELS = ["0", "90", "180", "270"];

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

interface TrialResult {
  direction: string;
  magnitude: string;
  facingYawDeg: string;
  impulseNs: number;
  peakTiltRad: number;
  finalTiltRad: number;
  recovered: boolean;
  fallen: boolean;
  stepsUsed: number;
  finalState: string;
}

// ---------------------------------------------------------------------------
// World setup helpers
// ---------------------------------------------------------------------------

function createWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  return world;
}

function createGroundPlane(world: RAPIER.World): void {
  // Match Scene.tsx: a 20x20x0.2 box rotated -PI/2 around X at y=0.
  // In Three.js the boxGeometry args are full extents; Rapier cuboid
  // takes half-extents.  The rotation makes the 0.2 thickness go along
  // world Y, so half-extents after rotation are (10, 0.1, 10).
  // The fixed body sits at y=0, so the top surface is at y=+0.1.
  //
  // However the rig spawn at y=1.15 is calibrated for a ground surface
  // at y=0. The Scene.tsx mesh is at position [0,0,0] with rotation
  // [-PI/2, 0, 0] -- the boxGeometry(20,20,0.2) becomes a flat plane
  // about y=0 (top surface at y=+0.1, bottom at y=-0.1).
  //
  // We'll place a fixed cuboid centered at y=-0.1 with half-extents
  // (10, 0.1, 10) so the top surface sits at y=0.
  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = RAPIER.ColliderDesc.cuboid(10, 0.1, 10).setFriction(1.0).setRestitution(0.0);
  world.createCollider(colliderDesc, body);
}

// ---------------------------------------------------------------------------
// Single trial
// ---------------------------------------------------------------------------

function runTrial(
  facingYaw: number,
  dirLocal: Vec3,
  magnitude: number,
  catchStepOverrides?: Partial<CatchStepConfig>
): TrialResult {
  // Silence BalanceController's per-frame console.log during simulation
  const origLog = console.log;
  console.log = () => {};

  const world = createWorld();
  createGroundPlane(world);

  const facingQuat = qFromAxisAngle(v3(0, 1, 0), facingYaw);

  const rig = new RapierRig(RAPIER, world, RigDefinitionV0, {
    rootWorldPos: SPAWN_POS,
    rootWorldRot: facingQuat,
  });

  const io = new RapierRigIO(RAPIER, world, rig);
  const balance = new BalanceController();
  const catchStep = new CatchStepController(balance, catchStepOverrides);

  // -- Settle phase: let the rig reach equilibrium --
  for (let i = 0; i < SETTLE_FRAMES; i++) {
    io.setDt(DT);
    catchStep.update(io, DT);
    world.step();
  }

  // -- Apply impulse --
  // Transform local direction to world direction using facing quat
  const dirWorld = qRotateVec3(facingQuat, dirLocal);
  const impulse = {
    x: dirWorld.x * magnitude,
    y: dirWorld.y * magnitude,
    z: dirWorld.z * magnitude,
  };
  rig.getBody("Root").applyImpulse(impulse, true);

  // -- Sim phase: step and record --
  let peakTiltRad = 0;
  let finalTiltRad = 0;
  let everFallen = false;
  let maxConsecutiveSteps = 0;

  for (let i = 0; i < SIM_FRAMES; i++) {
    io.setDt(DT);
    catchStep.update(io, DT);
    world.step();

    const balDebug = balance.debug;
    if (balDebug) {
      if (balDebug.tiltRad > peakTiltRad) peakTiltRad = balDebug.tiltRad;
      finalTiltRad = balDebug.tiltRad;
      if (balDebug.fallen) everFallen = true;
    }

    const csDebug = catchStep.debug;
    if (csDebug && csDebug.consecutiveSteps > maxConsecutiveSteps) {
      maxConsecutiveSteps = csDebug.consecutiveSteps;
    }
  }

  const finalState = catchStep.debug?.state ?? "???";
  const recovered = finalTiltRad < RECOVERY_TILT_THRESHOLD;

  rig.dispose();
  world.free();

  console.log = origLog;

  return {
    direction: "",
    magnitude: "",
    facingYawDeg: "",
    impulseNs: magnitude,
    peakTiltRad,
    finalTiltRad,
    recovered,
    fallen: everFallen,
    stepsUsed: maxConsecutiveSteps,
    finalState,
  };
}

// ---------------------------------------------------------------------------
// Full matrix
// ---------------------------------------------------------------------------

export interface HarnessOptions {
  catchStepOverrides?: Partial<CatchStepConfig>;
  testFacingYaws?: boolean;
}

export interface HarnessResult {
  trials: TrialResult[];
  passCount: number;
  failCount: number;
  totalCount: number;
}

export function runHarness(options: HarnessOptions = {}): HarnessResult {
  const { catchStepOverrides, testFacingYaws = false } = options;
  const yaws = testFacingYaws ? FACING_YAWS : [0];
  const yawLabels = testFacingYaws ? FACING_YAW_LABELS : ["0"];

  const trials: TrialResult[] = [];

  for (let yi = 0; yi < yaws.length; yi++) {
    for (let di = 0; di < DIRECTION_VECTORS.length; di++) {
      for (const mag of MAGNITUDES) {
        const result = runTrial(yaws[yi], DIRECTION_VECTORS[di], mag.newtonSeconds, catchStepOverrides);
        result.direction = DIRECTION_LABELS[di];
        result.magnitude = mag.label;
        result.facingYawDeg = yawLabels[yi];
        trials.push(result);
      }
    }
  }

  const passCount = trials.filter((t) => t.recovered).length;
  const failCount = trials.length - passCount;

  return { trials, passCount, failCount, totalCount: trials.length };
}

// ---------------------------------------------------------------------------
// Scorecard printer
// ---------------------------------------------------------------------------

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

function padLeft(s: string, w: number): string {
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}

function printScorecard(result: HarnessResult): void {
  const { trials, passCount, failCount, totalCount } = result;

  const header = [
    pad("yaw", 5),
    pad("direction", 15),
    pad("magnitude", 10),
    padLeft("N*s", 6),
    padLeft("peakTilt", 10),
    padLeft("finalTilt", 10),
    padLeft("steps", 6),
    pad("state", 12),
    pad("result", 6),
  ].join("  ");

  console.log("");
  console.log("=".repeat(header.length));
  console.log("  SWS Impulse Recovery Scorecard");
  console.log("=".repeat(header.length));
  console.log(header);
  console.log("-".repeat(header.length));

  for (const t of trials) {
    const row = [
      pad(t.facingYawDeg, 5),
      pad(t.direction, 15),
      pad(t.magnitude, 10),
      padLeft(t.impulseNs.toString(), 6),
      padLeft(t.peakTiltRad.toFixed(3), 10),
      padLeft(t.finalTiltRad.toFixed(3), 10),
      padLeft(t.stepsUsed.toString(), 6),
      pad(t.finalState, 12),
      pad(t.recovered ? "PASS" : "FAIL", 6),
    ].join("  ");
    console.log(row);
  }

  console.log("-".repeat(header.length));
  console.log(`TOTAL: ${passCount}/${totalCount} passed, ${failCount} failed`);
  console.log("=".repeat(header.length));
  console.log("");
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  console.log("Initializing Rapier WASM...");
  await RAPIER.init();
  console.log("Rapier ready.");

  // Pass --yaw to also test 4 facing orientations
  const testYaw = process.argv.includes("--yaw");

  console.log(
    `Running ${DIRECTION_LABELS.length} directions x ${MAGNITUDES.length} magnitudes` +
      (testYaw ? ` x ${FACING_YAWS.length} facing yaws` : "") +
      "..."
  );

  const t0 = performance.now();
  const result = runHarness({ testFacingYaws: testYaw });
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);

  printScorecard(result);
  console.log(`Completed in ${elapsed}s`);

  process.exit(result.failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Harness failed:", err);
  process.exit(2);
});
