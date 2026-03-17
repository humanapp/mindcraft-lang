import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { Mesh } from "three";
import { Fog, PlaneGeometry, Vector3 } from "three";
import { useEditorStore } from "@/editor/editor-store";
import { createWaterMaterial } from "./waterMaterial";

const PLANE_SIZE = 2000;
const PLANE_SEGMENTS = 128;

const BASE_SUN_DIR = new Vector3(160, 180, 120).normalize();
const _rotatedSun = new Vector3();

interface OceanSurfaceProps {
  seaLevel: number;
}

export function OceanSurface({ seaLevel }: OceanSurfaceProps) {
  const meshRef = useRef<Mesh>(null);

  const geometry = useMemo(() => new PlaneGeometry(PLANE_SIZE, PLANE_SIZE, PLANE_SEGMENTS, PLANE_SEGMENTS), []);

  const material = useMemo(() => createWaterMaterial(), []);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(({ camera, clock, scene }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    mesh.position.x = camera.position.x;
    mesh.position.y = seaLevel;
    mesh.position.z = camera.position.z;

    material.uniforms.uTime.value = clock.elapsedTime;

    const angle = useEditorStore.getState().waterSunAngle * (Math.PI / 180);
    _rotatedSun
      .set(
        BASE_SUN_DIR.x * Math.cos(angle) - BASE_SUN_DIR.z * Math.sin(angle),
        BASE_SUN_DIR.y,
        BASE_SUN_DIR.x * Math.sin(angle) + BASE_SUN_DIR.z * Math.cos(angle)
      )
      .normalize();
    material.uniforms.uSunDirection.value.copy(_rotatedSun);

    if (scene.fog instanceof Fog) {
      material.uniforms.uFogColor.value.copy(scene.fog.color);
      material.uniforms.uFogNear.value = scene.fog.near;
      material.uniforms.uFogFar.value = scene.fog.far;
    }
  });

  return (
    <mesh ref={meshRef} geometry={geometry} material={material} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false} />
  );
}
