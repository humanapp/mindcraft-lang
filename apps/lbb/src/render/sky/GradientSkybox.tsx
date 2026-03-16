import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { Mesh } from "three";
import { Color, Fog, SphereGeometry, Vector3 } from "three";
import { createGradientSkyboxMaterial } from "./gradientSkyboxMaterial";
import { evaluateGradient, type GradientStop, prepareStops } from "./gradientSkyboxUtils";

export type GradientSkyboxProps = {
  gradientStops?: GradientStop[];
  exponent?: number;
  offset?: number;
  radius?: number;
  followCamera?: boolean;
  fog?: { near: number; far: number };
};

const DEFAULT_RADIUS = 500;
const GEO_SEGMENTS = 32;

export function GradientSkybox({
  gradientStops,
  exponent = 1.0,
  offset = 0.0,
  radius = DEFAULT_RADIUS,
  followCamera = true,
  fog,
}: GradientSkyboxProps) {
  const meshRef = useRef<Mesh>(null);
  const scene = useThree((s) => s.scene);
  const fogColorRef = useRef(new Color());
  const lookDir = useRef(new Vector3());

  const stops = useMemo(() => prepareStops(gradientStops), [gradientStops]);

  useEffect(() => {
    if (fog) {
      scene.fog = new Fog(0x000000, fog.near, fog.far);
    } else {
      scene.fog = null;
    }
    return () => {
      scene.background = null;
      scene.fog = null;
    };
  }, [scene, fog]);

  const geometry = useMemo(() => new SphereGeometry(radius, GEO_SEGMENTS, GEO_SEGMENTS), [radius]);

  const material = useMemo(() => createGradientSkyboxMaterial(stops, exponent, offset), [stops, exponent, offset]);

  useFrame(({ camera }) => {
    if (followCamera && meshRef.current) {
      meshRef.current.position.copy(camera.position);
    }

    camera.getWorldDirection(lookDir.current);
    const biasedY = lookDir.current.y * 0.25;
    const h = biasedY * 0.5 + 0.5;
    evaluateGradient(stops, h, exponent, offset, fogColorRef.current);

    if (scene.fog) {
      (scene.fog as Fog).color.copy(fogColorRef.current);
    }
    scene.background = fogColorRef.current;
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} renderOrder={-1000} frustumCulled={false} />;
}
