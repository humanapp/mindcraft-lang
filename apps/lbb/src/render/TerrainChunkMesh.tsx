import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, DoubleSide } from "three";
import type { MeshData } from "../world/terrain/types";

interface TerrainChunkMeshProps {
  chunkId: string;
  mesh: MeshData;
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
}

export function TerrainChunkMesh({ mesh, onPointerDown, onPointerMove }: TerrainChunkMeshProps) {
  const geoRef = useRef<BufferGeometry>(null);

  const geometry = useMemo(() => {
    const geo = new BufferGeometry();
    if (mesh.vertexCount > 0 && mesh.indexCount > 0) {
      geo.setAttribute("position", new BufferAttribute(mesh.positions, 3));
      geo.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
      geo.setIndex(new BufferAttribute(mesh.indices, 1));
    }
    return geo;
  }, [mesh]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  if (mesh.vertexCount === 0) return null;

  return (
    <mesh ref={geoRef as never} geometry={geometry} onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
      <meshStandardMaterial color="#5a8f3c" side={DoubleSide} flatShading={false} />
    </mesh>
  );
}
