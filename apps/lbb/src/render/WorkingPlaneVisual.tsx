import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useEditorStore } from "@/editor/editor-store";
import { createInfinitePlaneMaterial } from "@/render/materials/workingPlane/infinitePlaneMaterial";
import { useSessionStore } from "@/session/session-store";

const PLANE_EXTENT = 4000;
const BEHIND_OPACITY = 0.3;
const FRONT_OPACITY = 0.6;
const NORMAL_COLOR = new THREE.Color(0xffffff);
const ACTIVE_COLOR = new THREE.Color(0xffffff);

const _cursor = new THREE.Vector3();

export function WorkingPlaneVisual() {
  const enabled = useEditorStore((s) => s.workingPlaneEnabled);
  const plane = useEditorStore((s) => s.workingPlane);
  const groupRef = useRef<THREE.Group>(null);

  const geometry = useMemo(() => {
    const geom = new THREE.PlaneGeometry(PLANE_EXTENT, PLANE_EXTENT, 1, 1);
    geom.rotateX(-Math.PI / 2);
    return geom;
  }, []);

  const behindMat = useMemo(() => createInfinitePlaneMaterial({ depthTest: false, opacityScale: BEHIND_OPACITY }), []);

  const frontMat = useMemo(() => createInfinitePlaneMaterial({ depthTest: true, opacityScale: FRONT_OPACITY }), []);

  useEffect(() => {
    return () => {
      geometry.dispose();
      behindMat.dispose();
      frontMat.dispose();
    };
  }, [geometry, behindMat, frontMat]);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;

    const { spaceHeld } = useEditorStore.getState();
    const { hoverWorldPos } = useSessionStore.getState();

    g.position.copy(plane.position);
    g.quaternion.copy(plane.quaternion);

    if (hoverWorldPos) {
      _cursor.set(hoverWorldPos[0], hoverWorldPos[1], hoverWorldPos[2]);
    } else {
      _cursor.set(1e6, 1e6, 1e6);
    }

    const color = spaceHeld ? ACTIVE_COLOR : NORMAL_COLOR;
    const radius = spaceHeld ? 500.0 : 60.0;

    for (const mat of [behindMat, frontMat]) {
      mat.uniforms.uCursorPos.value.copy(_cursor);
      mat.uniforms.uFalloffRadius.value = radius;
      mat.uniforms.uColor.value.copy(color);
    }
  });

  if (!enabled) return null;

  return (
    <group ref={groupRef}>
      <mesh renderOrder={10} geometry={geometry} material={behindMat} />
      <mesh renderOrder={11} geometry={geometry} material={frontMat} />
    </group>
  );
}
