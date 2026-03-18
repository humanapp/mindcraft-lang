import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { DoubleSide, MeshStandardMaterial } from "three";
import { useEditorStore } from "@/editor/editor-store";
import { applyTerrainShaderPatch } from "./terrainShaderPatch";
import { createTerrainUniforms, type TerrainUniformMap, type TerrainUniformValues } from "./terrainUniforms";

interface TerrainMaterialProps {
  lowColor?: string;
  highColor?: string;
  steepColor?: string;
  heightMin?: number;
  heightMax?: number;
  noiseScale?: number;
  noiseStrength?: number;
  roughnessBase?: number;
  roughnessVariation?: number;
  wireframe?: boolean;
}

export function TerrainMaterial({
  lowColor = "#4c8f3a",
  highColor = "#7fbf55",
  steepColor = "#3d6f2c",
  heightMin = -10,
  heightMax = 60,
  noiseScale = 0.08,
  noiseStrength = 0.08,
  roughnessBase = 0.85,
  roughnessVariation = 0.1,
  wireframe = false,
}: TerrainMaterialProps) {
  const uniformsRef = useRef<TerrainUniformMap | null>(null);

  // Material is created once; props are synced to uniforms via useFrame
  const material = useMemo(() => {
    const uniforms = createTerrainUniforms();
    uniformsRef.current = uniforms;

    const mat = new MeshStandardMaterial({
      side: DoubleSide,
      roughness: 1,
      metalness: 0,
    });

    mat.onBeforeCompile = (shader) => {
      applyTerrainShaderPatch(shader, uniforms);
    };

    return mat;
  }, []);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame(() => {
    const u = uniformsRef.current;
    if (!u) return;
    u.lowColor.value.set(lowColor);
    u.highColor.value.set(highColor);
    u.steepColor.value.set(steepColor);
    u.heightMin.value = heightMin;
    u.heightMax.value = heightMax;
    u.noiseScale.value = noiseScale;
    u.noiseStrength.value = noiseStrength;
    u.roughnessBase.value = roughnessBase;
    u.roughnessVariation.value = roughnessVariation;

    const { seaLevel, waterEnabled } = useEditorStore.getState();
    u.seaLevel.value = waterEnabled ? seaLevel : -9999;
    u.hazeStrength.value = waterEnabled ? 3 : 0.0;
  });

  return <primitive object={material} attach="material" wireframe={wireframe} />;
}
