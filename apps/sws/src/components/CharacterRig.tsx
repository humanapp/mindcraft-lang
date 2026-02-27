import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { useBeforePhysicsStep, useRapier } from "@react-three/rapier";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { BalanceDebug } from "@/controllers/BalanceController";
import { BalanceController } from "@/controllers/BalanceController";
import type { CatchStepDebug } from "@/controllers/CatchStepController";
import { CatchStepController } from "@/controllers/CatchStepController";
import { q, qFromAxisAngle, v3 } from "@/lib/math";
import { RapierRig } from "@/physics/RapierRig";
import { RapierRigIO } from "@/physics/RapierRigIO";
import type { PartName } from "@/rig/RigDefinition";
import { RigDefinitionV0 } from "@/rig/RigDefinition.v0";
import { RigDebugOverlay } from "./RigDebugOverlay";
import { RigMeshes } from "./RigMeshes";
import { TuningPanel } from "./TuningPanel";

const _dragPlane = new THREE.Plane();
const _intersection = new THREE.Vector3();
const _offset = new THREE.Vector3();

const DEFAULT_SPAWN = v3(0, 0.72, 0);

export function CharacterRig(props: { spawn?: { x: number; y: number; z: number } }) {
  const { rapier, world } = useRapier();

  // Stabilize spawn so it only changes when values actually change.
  const spawnX = props.spawn?.x ?? DEFAULT_SPAWN.x;
  const spawnY = props.spawn?.y ?? DEFAULT_SPAWN.y;
  const spawnZ = props.spawn?.z ?? DEFAULT_SPAWN.z;

  const rigRef = useRef<RapierRig | null>(null);
  const ioRef = useRef<RapierRigIO | null>(null);
  const catchStepRef = useRef<CatchStepController | null>(null);
  const disposedRef = useRef(false);
  const [rig, setRig] = useState<RapierRig | null>(null);
  const [io, setIo] = useState<RapierRigIO | null>(null);

  // Debug state refs -- written in physics step, read by overlay in useFrame
  const balanceDebugRef = useRef<BalanceDebug | null>(null);
  const catchStepDebugRef = useRef<CatchStepDebug | null>(null);

  // Facing yaw in radians. Changed via Q/E keys to test orientation independence.
  const facingYawRef = useRef(0);

  useEffect(() => {
    if (!world) return;

    disposedRef.current = false;

    const newRig = new RapierRig(rapier, world, RigDefinitionV0, {
      rootWorldPos: v3(spawnX, spawnY, spawnZ),
      rootWorldRot: q(0, 0, 0, 1),
    });

    const io = new RapierRigIO(rapier, world, newRig);

    rigRef.current = newRig;
    ioRef.current = io;
    catchStepRef.current = new CatchStepController(new BalanceController());
    setRig(newRig);
    setIo(io);

    return () => {
      disposedRef.current = true;
      ioRef.current = null;
      rigRef.current = null;
      catchStepRef.current = null;
      balanceDebugRef.current = null;
      catchStepDebugRef.current = null;
      setRig(null);
      setIo(null);

      // Guard against the world already being freed (StrictMode / HMR).
      try {
        newRig.dispose();
      } catch {
        // World was already freed by react-three-rapier; nothing to clean up.
      }
    };
  }, [rapier, world, spawnX, spawnY, spawnZ]);

  // ---------------------------------------------------------------------------
  // Keyboard: push impulses (1/2/3), reset (Space), rotate facing (Q/E)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const _fwd = new THREE.Vector3(0, 0, 1);
    const _right = new THREE.Vector3(1, 0, 0);
    const _q = new THREE.Quaternion();

    /** Reset rig to spawn with the current facing yaw and fresh controllers. */
    function resetRig(rig: RapierRig) {
      const yaw = facingYawRef.current;
      const rot = qFromAxisAngle(v3(0, 1, 0), yaw);
      rig.reset({
        rootWorldPos: v3(spawnX, spawnY, spawnZ),
        rootWorldRot: rot,
      });
      catchStepRef.current = new CatchStepController(new BalanceController());
      balanceDebugRef.current = null;
      catchStepDebugRef.current = null;

      const yawDeg = Math.round((yaw * 180) / Math.PI);
      console.log(`[Rig] reset -- facing ${yawDeg} deg`);
    }

    function onKeyDown(e: KeyboardEvent) {
      // Ignore when typing in an input, textarea, or contentEditable element.
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.code === "Space") {
        e.preventDefault();
        const rig = rigRef.current;
        if (!rig) return;
        resetRig(rig);
        return;
      }

      // Q/E -- rotate facing by 90 degrees and reset
      if (e.key === "q" || e.key === "Q" || e.key === "e" || e.key === "E") {
        const rig = rigRef.current;
        if (!rig) return;
        const delta = e.key === "q" || e.key === "Q" ? Math.PI / 4 : -Math.PI / 4;
        facingYawRef.current += delta;
        resetRig(rig);
        return;
      }

      const rig = rigRef.current;
      if (!rig) return;

      const root = rig.getBody("Root");
      const rot = root.rotation();
      _q.set(rot.x, rot.y, rot.z, rot.w);

      // Derive world-space forward and right from root orientation
      const fwd = _fwd.clone().set(0, 0, 1).applyQuaternion(_q);
      const right = _right.clone().set(1, 0, 0).applyQuaternion(_q);

      let impulse: { x: number; y: number; z: number } | null = null;

      const sign = e.shiftKey ? -1 : 1; // Hold Shift for opposite direction

      const forces = {
        small: 30,
        medium: 70,
        large: 120,
      };

      switch (e.key) {
        // 1 - Gentle forward nudge (~10 N*s on a ~34kg rig)
        case "1":
          impulse = { x: fwd.x * forces.small * sign, y: fwd.y * forces.small, z: fwd.z * forces.small * sign };
          break;
        // 2 - Side shove (~70 N*s rightward)
        case "2":
          impulse = {
            x: right.x * forces.medium * sign,
            y: right.y * forces.medium,
            z: right.z * forces.medium * sign,
          };
          break;
        // 3 - Hard forward shove (~100 N*s, should trigger catch step or topple)
        case "3":
          impulse = { x: fwd.x * forces.large * sign, y: fwd.y * forces.large, z: fwd.z * forces.large * sign };
          break;
      }

      if (impulse) {
        root.applyImpulse(impulse, true);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [spawnX, spawnY, spawnZ]);

  // ---------------------------------------------------------------------------
  // Drag state
  // ---------------------------------------------------------------------------
  const { camera, controls } = useThree();
  const dragPartRef = useRef<PartName | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const currentRig = rigRef.current;
      if (!currentRig) return;

      const partName = e.object?.userData?.partName as PartName | undefined;
      if (!partName || !currentRig.hasPart(partName)) return;

      (e.target as HTMLElement).setPointerCapture?.(e.nativeEvent.pointerId);

      // Disable orbit controls while dragging
      if (controls) (controls as unknown as { enabled: boolean }).enabled = false;

      const body = currentRig.getBody(partName);

      // Switch to kinematic so we control position directly
      body.setBodyType(2, true); // 2 = KinematicPositionBased
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);

      // Build a drag plane facing the camera through the hit point
      const cameraDir = camera.getWorldDirection(new THREE.Vector3());
      _dragPlane.setFromNormalAndCoplanarPoint(cameraDir.negate(), e.point);

      // Remember offset between hit point and body origin
      const pos = body.translation();
      _offset.set(pos.x, pos.y, pos.z).sub(e.point);

      dragPartRef.current = partName;
      setIsDragging(true);
    },
    [camera, controls]
  );

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!isDragging) return;
      e.stopPropagation();

      const currentRig = rigRef.current;
      const partName = dragPartRef.current;
      if (!currentRig || !partName) return;

      const body = currentRig.getBody(partName);

      // Project the pointer ray onto the drag plane
      if (!e.ray.intersectPlane(_dragPlane, _intersection)) return;

      _intersection.add(_offset);
      body.setNextKinematicTranslation({
        x: _intersection.x,
        y: _intersection.y,
        z: _intersection.z,
      });
    },
    [isDragging]
  );

  const onPointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!isDragging) return;
      e.stopPropagation();
      (e.target as HTMLElement).releasePointerCapture?.(e.nativeEvent.pointerId);

      const currentRig = rigRef.current;
      const partName = dragPartRef.current;
      if (currentRig && partName) {
        const body = currentRig.getBody(partName);
        // Revert to dynamic so gravity and collisions resume
        body.setBodyType(0, true); // 0 = Dynamic
      }

      // Re-enable orbit controls
      if (controls) (controls as unknown as { enabled: boolean }).enabled = true;

      dragPartRef.current = null;
      setIsDragging(false);
    },
    [isDragging, controls]
  );

  // ---------------------------------------------------------------------------
  // Physics step
  // ---------------------------------------------------------------------------

  useBeforePhysicsStep((stepWorld) => {
    if (disposedRef.current) return;
    const io = ioRef.current;
    const catchStep = catchStepRef.current;
    if (!io || !catchStep) return;

    // Use the fixed timestep from Rapier (typically 1/60)
    const dt = stepWorld.timestep;
    io.setDt(dt);

    // Balance controller drives all stance joints (torso, hips, knees, ankles).
    // It computes COM-over-support error and maps it to joint angle targets.
    catchStep.update(io, dt);

    // Snapshot debug state for the overlay (read in useFrame render loop)
    balanceDebugRef.current = catchStep.balance.debug;
    catchStepDebugRef.current = catchStep.debug;
  });

  return rig && io ? (
    <group onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <RigMeshes rig={rig} />
      <RigDebugOverlay rig={rig} io={io} balanceDebugRef={balanceDebugRef} catchStepDebugRef={catchStepDebugRef} />
      <TuningPanel catchStepRef={catchStepRef} />
    </group>
  ) : null;
}
