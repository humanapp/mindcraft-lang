import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, DoubleSide } from "three";
import type { TerrainShadingMode } from "@/editor/editor-store";
import type { MeshData } from "@/world/terrain/types";

interface TerrainChunkMeshProps {
  chunkId: string;
  mesh: MeshData;
  wireframe?: boolean;
  shadingMode?: TerrainShadingMode;
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
}

export function TerrainChunkMesh({
  mesh,
  wireframe,
  shadingMode,
  onPointerDown,
  onPointerMove,
}: TerrainChunkMeshProps) {
  const geoRef = useRef<BufferGeometry>(null);

  const geometry = useMemo(() => {
    const geo = new BufferGeometry();
    if (mesh.vertexCount > 0 && mesh.indexCount > 0) {
      geo.setAttribute("position", new BufferAttribute(mesh.positions, 3));
      geo.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
      geo.setIndex(new BufferAttribute(mesh.indices, 1));

      if (shadingMode === "gradient-mag") {
        const colors = new Float32Array(mesh.vertexCount * 3);
        let minMag = Number.POSITIVE_INFINITY;
        let maxMag = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < mesh.vertexCount; i++) {
          const m = mesh.gradientMag[i];
          if (m < minMag) minMag = m;
          if (m > maxMag) maxMag = m;
        }
        const range = maxMag - minMag;
        const invRange = range > 1e-8 ? 1 / range : 0;
        for (let i = 0; i < mesh.vertexCount; i++) {
          const t = (mesh.gradientMag[i] - minMag) * invRange;
          colors[i * 3] = t;
          colors[i * 3 + 1] = t;
          colors[i * 3 + 2] = t;
        }
        geo.setAttribute("color", new BufferAttribute(colors, 3));
      }
    }
    return geo;
  }, [mesh, shadingMode]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  if (mesh.vertexCount === 0) return null;

  return (
    <mesh
      ref={geoRef as never}
      geometry={geometry}
      castShadow
      receiveShadow
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      {shadingMode === "normals" ? (
        <meshNormalMaterial wireframe={wireframe} />
      ) : shadingMode === "gradient-mag" ? (
        <meshBasicMaterial vertexColors wireframe={wireframe} />
      ) : (
        <meshStandardMaterial
          color={shadingMode === "plain" ? "#b0b0b0" : "#5a8f3c"}
          side={DoubleSide}
          flatShading={false}
          wireframe={wireframe}
        />
      )}
    </mesh>
  );
}
