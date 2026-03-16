import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Mesh } from "three";
import { SphereGeometry } from "three";
import { createGradientSkyboxMaterial } from "./gradientSkyboxMaterial";
import { type GradientStop, prepareStops } from "./gradientSkyboxUtils";

export type GradientSkyboxProps = {
  gradientStops?: GradientStop[];
  exponent?: number;
  offset?: number;
  radius?: number;
  followCamera?: boolean;
};

const DEFAULT_RADIUS = 500;
const GEO_SEGMENTS = 32;

export function GradientSkybox({
  gradientStops,
  exponent = 1.0,
  offset = 0.0,
  radius = DEFAULT_RADIUS,
  followCamera = true,
}: GradientSkyboxProps) {
  const meshRef = useRef<Mesh>(null);

  const stops = useMemo(() => prepareStops(gradientStops), [gradientStops]);

  const geometry = useMemo(() => new SphereGeometry(radius, GEO_SEGMENTS, GEO_SEGMENTS), [radius]);

  const material = useMemo(() => createGradientSkyboxMaterial(stops, exponent, offset), [stops, exponent, offset]);

  useFrame(({ camera }) => {
    if (followCamera && meshRef.current) {
      meshRef.current.position.copy(camera.position);
    }
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} renderOrder={-1000} frustumCulled={false} />;
}
