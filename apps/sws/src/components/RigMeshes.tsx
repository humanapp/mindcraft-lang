import type RAPIER from "@dimforge/rapier3d-compat";
import type { World as RapierWorld } from "@dimforge/rapier3d-compat";

import { useFrame } from "@react-three/fiber";
import React, { useMemo, useRef } from "react";
import type { Mesh } from "three";
import { Quaternion, Vector3 } from "three";
import type { RapierRig } from "../physics/RapierRig";
import type { CollisionShape, RigDefinition } from "../rig/RigDefinition";

type Props = {
  rig: RapierRig;
};

export function RigMeshes({ rig }: Props) {
  const parts = rig.def.parts;
  const world = rig.world;

  // Refs for meshes by part name
  const meshRefs = useRef<Record<string, Mesh | null>>({});

  const tmpPos = useMemo(() => new Vector3(), []);
  const tmpQuat = useMemo(() => new Quaternion(), []);

  useFrame(() => {
    for (const p of parts) {
      const rb = world.getRigidBody(rig.getBodyHandle(p.name));
      if (!rb) continue;

      const t = rb.translation();
      const r = rb.rotation();

      const mesh = meshRefs.current[p.name];
      if (!mesh) continue;

      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  });

  return (
    <>
      {parts.map((p) => (
        <PartMesh
          key={p.name}
          partName={p.name}
          collision={p.collision[0]}
          setRef={(m) => (meshRefs.current[p.name] = m)}
        />
      ))}
    </>
  );
}

function PartMesh(props: { partName: string; collision: CollisionShape; setRef: (m: Mesh | null) => void }) {
  const { collision, partName } = props;

  const setRefWithUserData = (m: Mesh | null) => {
    if (m) m.userData.partName = partName;
    props.setRef(m);
  };

  // Only render the first collider for v0.
  if (collision.kind === "box") {
    const hx = collision.halfExtents.x;
    const hy = collision.halfExtents.y;
    const hz = collision.halfExtents.z;
    return (
      <mesh ref={setRefWithUserData} castShadow>
        <boxGeometry args={[hx * 2, hy * 2, hz * 2]} />
        <meshStandardMaterial />
      </mesh>
    );
  }

  if (collision.kind === "capsule") {
    // Three's capsuleGeometry args: radius, length (cylinder length), capSegments, radialSegments
    const radius = collision.radius;
    const length = collision.halfHeight * 2;
    return (
      <mesh ref={setRefWithUserData} castShadow>
        <capsuleGeometry args={[radius, length, 8, 16]} />
        <meshStandardMaterial />
      </mesh>
    );
  }

  return null;
}
