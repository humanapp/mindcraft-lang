import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry } from "three";
import type { ChunkData } from "@/world/terrain/types";
import { buildDensitySignPoints } from "./samplePositions";

interface ChunkDensitySignProps {
  chunk: ChunkData;
}

export function ChunkDensitySign({ chunk }: ChunkDensitySignProps) {
  const { coord } = chunk;

  // biome-ignore lint/correctness/useExhaustiveDependencies: chunk.field is mutable-in-place; chunk.version is its change signal
  const geometry = useMemo(() => {
    const { positions, colors } = buildDensitySignPoints(chunk.field, coord);
    if (positions.length === 0) return null;

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(positions, 3));
    geo.setAttribute("color", new BufferAttribute(colors, 3));
    return geo;
  }, [chunk.version, coord]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  if (!geometry) return null;

  return (
    <points geometry={geometry}>
      <pointsMaterial size={0.3} sizeAttenuation vertexColors />
    </points>
  );
}
