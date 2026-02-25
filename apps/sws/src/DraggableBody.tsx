import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import type { RapierRigidBody } from "@react-three/rapier";
import { RigidBody } from "@react-three/rapier";
import { type ReactNode, useRef, useState } from "react";
import * as THREE from "three";

interface DraggableBodyProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  children: ReactNode;
}

const _plane = new THREE.Plane();
const _intersection = new THREE.Vector3();
const _offset = new THREE.Vector3();

/**
 * Wraps children in a dynamic RigidBody that can be clicked and dragged.
 *
 * While dragging the body switches to kinematicPosition so it tracks the
 * pointer without fighting gravity. On release it reverts to dynamic so
 * physics resume normally.
 */
export function DraggableBody({ position, rotation, children }: DraggableBodyProps) {
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { camera, controls } = useThree();

  function onPointerDown(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.nativeEvent.pointerId);

    const body = rigidBodyRef.current;
    if (!body) return;

    // Disable orbit controls while dragging
    if (controls) (controls as unknown as { enabled: boolean }).enabled = false;

    // Switch to kinematic so we control position directly
    body.setBodyType(2, true); // 2 = KinematicPositionBased
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);

    // Build a drag plane facing the camera through the hit point
    const cameraDir = camera.getWorldDirection(new THREE.Vector3());
    _plane.setFromNormalAndCoplanarPoint(cameraDir.negate(), e.point);

    // Remember the offset between the hit point and the body origin
    const pos = body.translation();
    _offset.set(pos.x, pos.y, pos.z).sub(e.point);

    setIsDragging(true);
  }

  function onPointerMove(e: ThreeEvent<PointerEvent>) {
    if (!isDragging) return;
    e.stopPropagation();

    const body = rigidBodyRef.current;
    if (!body) return;

    // Project the pointer ray onto the drag plane
    const ray = e.ray;
    if (!ray.intersectPlane(_plane, _intersection)) return;

    _intersection.add(_offset);
    body.setNextKinematicTranslation({
      x: _intersection.x,
      y: _intersection.y,
      z: _intersection.z,
    });
  }

  function onPointerUp(e: ThreeEvent<PointerEvent>) {
    if (!isDragging) return;
    e.stopPropagation();
    (e.target as HTMLElement).releasePointerCapture?.(e.nativeEvent.pointerId);

    const body = rigidBodyRef.current;
    if (body) {
      // Revert to dynamic so gravity and collisions resume
      body.setBodyType(0, true); // 0 = Dynamic
    }

    // Re-enable orbit controls
    if (controls) (controls as unknown as { enabled: boolean }).enabled = true;

    setIsDragging(false);
  }

  return (
    <RigidBody ref={rigidBodyRef} type="dynamic" colliders="cuboid" position={position} rotation={rotation}>
      <group onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        {children}
      </group>
    </RigidBody>
  );
}
