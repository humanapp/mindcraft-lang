import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { useBeforePhysicsStep, useRapier } from "@react-three/rapier";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { BalanceController } from "@/controllers/BalanceController";
import { q, v3 } from "@/lib/math";
import { RapierRig } from "@/physics/RapierRig";
import { RapierRigIO } from "@/physics/RapierRigIO";
import type { PartName } from "@/rig/RigDefinition";
import { RigDefinitionV0 } from "@/rig/RigDefinition.v0";
import { RigMeshes } from "./RigMeshes";

const _dragPlane = new THREE.Plane();
const _intersection = new THREE.Vector3();
const _offset = new THREE.Vector3();

const DEFAULT_SPAWN = v3(0, 1.15, 0);

export function CharacterRig(props: { spawn?: { x: number; y: number; z: number } }) {
  const { rapier, world } = useRapier();

  // Stabilize spawn so it only changes when values actually change.
  const spawnX = props.spawn?.x ?? DEFAULT_SPAWN.x;
  const spawnY = props.spawn?.y ?? DEFAULT_SPAWN.y;
  const spawnZ = props.spawn?.z ?? DEFAULT_SPAWN.z;

  const rigRef = useRef<RapierRig | null>(null);
  const ioRef = useRef<RapierRigIO | null>(null);
  const balanceRef = useRef<BalanceController | null>(null);
  const disposedRef = useRef(false);
  const [rig, setRig] = useState<RapierRig | null>(null);

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
    balanceRef.current = new BalanceController();
    setRig(newRig);

    return () => {
      disposedRef.current = true;
      ioRef.current = null;
      rigRef.current = null;
      balanceRef.current = null;
      setRig(null);

      // Guard against the world already being freed (StrictMode / HMR).
      try {
        newRig.dispose();
      } catch {
        // World was already freed by react-three-rapier; nothing to clean up.
      }
    };
  }, [rapier, world, spawnX, spawnY, spawnZ]);

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
    const balance = balanceRef.current;
    if (!io || !balance) return;

    // Use the fixed timestep from Rapier (typically 1/60)
    const dt = stepWorld.timestep;
    io.setDt(dt);

    // Balance controller drives all stance joints (torso, hips, knees, ankles).
    // It computes COM-over-support error and maps it to joint angle targets.
    balance.update(io, dt);
  });

  return rig ? (
    <group onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <RigMeshes rig={rig} />
    </group>
  ) : null;
}
