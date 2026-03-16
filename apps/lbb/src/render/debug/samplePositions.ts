import type { ChunkCoord } from "@/world/terrain/types";
import {
  CORE_SAMPLES,
  chunkWorldOrigin,
  FIELD_PAD,
  localVoxelToSampleIndex,
  SAMPLES,
  SAMPLES_TOTAL,
  sampleIndex,
} from "@/world/terrain/types";

// Corner and edge definitions mirror the mesher exactly so debug geometry
// aligns with the extracted surface.
const CORNERS: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];

const CUBE_EDGES: [number, number][] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

// The mesher iterates CORE_SAMPLES^3 cells (CHUNK_SIZE+1 = 33 per axis).
// Cell (cx, cy, cz) occupies sample corners at [cx..cx+1, cy..cy+1, cz..cz+1].
// All corner indices fit within SAMPLES = CHUNK_SIZE+2 = 34.

// A cell is active when the iso surface passes through it: at least one corner
// has density > 0 (solid) and at least one has density <= 0 (air or surface).
// This matches the mesher's mask test: mask != 0 && mask != 0xff.
// The debug point is placed at the cell center in world space:
//   center = chunkOrigin + (cx + 0.5, cy + 0.5, cz + 0.5)
export function buildActiveCellPoints(field: Float32Array, coord: ChunkCoord): Float32Array {
  const [ox, oy, oz] = chunkWorldOrigin(coord);

  const pts: number[] = [];

  for (let cz = 0; cz < CORE_SAMPLES; cz++) {
    for (let cy = 0; cy < CORE_SAMPLES; cy++) {
      for (let cx = 0; cx < CORE_SAMPLES; cx++) {
        let hasPos = false;
        let hasNeg = false;
        for (let i = 0; i < 8; i++) {
          const [dx, dy, dz] = CORNERS[i];
          if (field[localVoxelToSampleIndex(cx + dx, cy + dy, cz + dz)] > 0) {
            hasPos = true;
          } else {
            hasNeg = true;
          }
          if (hasPos && hasNeg) break;
        }
        if (!hasPos || !hasNeg) continue;

        pts.push(ox + cx + 0.5, oy + cy + 0.5, oz + cz + 0.5);
      }
    }
  }

  return new Float32Array(pts);
}

// For each active cell, emit one world-space point per sign-changing edge.
// Position: p = cornerA + t * (cornerB - cornerA), t = dA / (dA - dB).
// These points lie exactly on the iso surface (density = 0) by linear
// interpolation along each edge.
export function buildEdgeIntersectionPoints(field: Float32Array, coord: ChunkCoord): Float32Array {
  const [ox, oy, oz] = chunkWorldOrigin(coord);

  const pts: number[] = [];

  for (let cz = 0; cz < CORE_SAMPLES; cz++) {
    for (let cy = 0; cy < CORE_SAMPLES; cy++) {
      for (let cx = 0; cx < CORE_SAMPLES; cx++) {
        const d: number[] = new Array(8);
        let mask = 0;
        for (let i = 0; i < 8; i++) {
          const [dx, dy, dz] = CORNERS[i];
          d[i] = field[localVoxelToSampleIndex(cx + dx, cy + dy, cz + dz)];
          if (d[i] > 0) mask |= 1 << i;
        }
        if (mask === 0 || mask === 0xff) continue;

        for (const [a, b] of CUBE_EDGES) {
          if (d[a] > 0 !== d[b] > 0) {
            const t = d[a] / (d[a] - d[b]);
            const [ax, ay, az] = CORNERS[a];
            const [bx, by, bz] = CORNERS[b];
            pts.push(ox + cx + ax + t * (bx - ax), oy + cy + ay + t * (by - ay), oz + cz + az + t * (bz - az));
          }
        }
      }
    }
  }

  return new Float32Array(pts);
}

export interface DensitySignData {
  positions: Float32Array;
  colors: Float32Array;
}

// Render every sample point in the chunk, colored by density sign.
// Blue (0,0.4,1) = density > 0 (solid), Red (1,0.2,0.1) = density <= 0 (air).
// All SAMPLES^3 points are included so the full lattice is visible.
export function buildDensitySignPoints(field: Float32Array, coord: ChunkCoord): DensitySignData {
  const positions = new Float32Array(SAMPLES_TOTAL * 3);
  const colors = new Float32Array(SAMPLES_TOTAL * 3);
  const [ox, oy, oz] = chunkWorldOrigin(coord);

  let i = 0;
  for (let sz = 0; sz < SAMPLES; sz++) {
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        positions[i] = ox + sx - FIELD_PAD;
        positions[i + 1] = oy + sy - FIELD_PAD;
        positions[i + 2] = oz + sz - FIELD_PAD;

        const d = field[sampleIndex(sx, sy, sz)];
        if (d > 0) {
          // solid -> blue
          colors[i] = 0;
          colors[i + 1] = 0.4;
          colors[i + 2] = 1;
        } else {
          // air/surface -> red
          colors[i] = 1;
          colors[i + 1] = 0.2;
          colors[i + 2] = 0.1;
        }
        i += 3;
      }
    }
  }

  return { positions, colors };
}
