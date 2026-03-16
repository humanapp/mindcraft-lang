import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry } from "three";
import type { VoxelDebugMode } from "@/editor/editor-store";
import type { ChunkData } from "@/world/terrain/types";
import { buildActiveCellPoints, buildEdgeIntersectionPoints } from "./samplePositions";

type ActiveMode = Exclude<VoxelDebugMode, "off" | "density-sign">;

const POINT_COLOR: Record<ActiveMode, string> = {
  // amber: marks cells that straddle the surface -- should form a thin shell
  "active-cells": "#f59e0b",
  // cyan: exact iso-surface intersections via linear interp -- lies on the surface
  "edge-intersections": "#22d3ee",
  // green: post-relaxation Surface Nets vertices -- aligns with rendered mesh verts
  "surface-vertices": "#86efac",
};

const POINT_SIZE: Record<ActiveMode, number> = {
  "active-cells": 0.5,
  "edge-intersections": 0.3,
  "surface-vertices": 0.5,
};

interface ChunkDebugPointsProps {
  chunk: ChunkData;
  // Post-relaxation vertex positions from MeshData, shared with the render mesh.
  // Used directly for surface-vertices mode; copied into a new BufferAttribute
  // to avoid aliasing with the terrain mesh geometry.
  meshPositions: Float32Array;
  mode: ActiveMode;
}

export function ChunkDebugPoints({ chunk, meshPositions, mode }: ChunkDebugPointsProps) {
  const { coord } = chunk;

  // chunk.field is a Float32Array mutated in place by applyFieldValues; its
  // reference never changes so it cannot be a dep. chunk.version is the
  // explicit change counter incremented on every field edit and is the correct
  // dep for invalidating field-derived modes. meshPositions reference changes
  // on every remesh, covering mode 3.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chunk.field is mutable-in-place; chunk.version is its change signal
  const geometry = useMemo(() => {
    let positions: Float32Array;
    if (mode === "active-cells") {
      positions = buildActiveCellPoints(chunk.field, coord);
    } else if (mode === "edge-intersections") {
      positions = buildEdgeIntersectionPoints(chunk.field, coord);
    } else {
      // surface-vertices: the final (post-relaxation) positions already computed
      // by the mesher. Copy to avoid sharing ownership with the mesh geometry.
      positions = meshPositions.slice();
    }

    if (positions.length === 0) return null;

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(positions, 3));
    return geo;
  }, [mode, chunk.version, meshPositions, coord]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  if (!geometry) return null;

  return (
    <points geometry={geometry}>
      <pointsMaterial color={POINT_COLOR[mode]} size={POINT_SIZE[mode]} sizeAttenuation />
    </points>
  );
}
